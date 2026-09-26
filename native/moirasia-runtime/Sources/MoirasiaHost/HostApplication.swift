import AppKit
import Darwin
import Foundation
import MoirasiaProtocol
import Security

struct HostConfiguration {
    let applicationPath: String
    let iconPath: String
    let userData: String
    let featureServicePath: String
    let presence: String?
    let bondedHelperPath: String?
    let shoutDriverPath: String?
}

final class HostApplication: NSObject, NSApplicationDelegate {
    typealias SupervisorFactory = (@escaping FeatureServiceSupervisor.EventHandler, @escaping FeatureServiceSupervisor.HealthHandler) -> FeatureServiceSupervisorDriving

    private struct HostUiState: Equatable {
        var mainVisible = false
        var mainFocused = false
        var shelfVisible = false

        var params: [String: JSONValue] {
            [
                "mainVisible": .bool(mainVisible),
                "mainFocused": .bool(mainFocused),
                "shelfVisible": .bool(shelfVisible)
            ]
        }
    }

    private let configuration: HostConfiguration
    private let supervisorFactory: SupervisorFactory
    private let runtimeDirectory: URL
    private let tokenPath: String
    private let socketPath: String
    private let lockPath: String
    private var lockDescriptor: Int32 = -1
    private var token = ""
    private var server: ControlServer?
    private var supervisor: FeatureServiceSupervisorDriving?
    private var settings: ShellSettingsStore
    private var launcher: ElectronLauncher
    private var statusItem: StatusItemController?
    private var revision: UInt64 = 0
    private var serviceState: FeatureServiceSupervisor.HealthState = .starting
    private var serviceError: String?
    private var serviceRestartCount = 0
    private var hostUiState = HostUiState()
    private var activeGeneration: UInt64?
    private var generationTerminal = false
    private var initialSnapshotReceived = false
    private var initialReplayAttempted = false
    private var replayInFlightGeneration: UInt64?
    private var replayStateChanged = false
    private var shuttingDown = false
    private let stateQueue = DispatchQueue(label: "com.moirasia.host.state")

    init(configuration: HostConfiguration, supervisorFactory: SupervisorFactory? = nil) throws {
        self.configuration = configuration
        self.supervisorFactory = supervisorFactory ?? { eventHandler, healthHandler in
            FeatureServiceSupervisor(executablePath: configuration.featureServicePath, userData: configuration.userData, bondedHelperExecutable: configuration.bondedHelperPath, shoutDriverDirectory: configuration.shoutDriverPath, eventHandler: eventHandler, exitHandler: {}, healthHandler: healthHandler)
        }
        self.runtimeDirectory = URL(fileURLWithPath: configuration.userData, isDirectory: true).appendingPathComponent("runtime", isDirectory: true)
        self.tokenPath = runtimeDirectory.appendingPathComponent("client.token").path
        // The socket path must stay short (sockaddr_un.sun_path is ~104 bytes
        // on macOS); long userData paths broke endpoint publication entirely.
        self.socketPath = moirasiaHostSocketPath(userData: configuration.userData)
        self.lockPath = runtimeDirectory.appendingPathComponent("host.lock").path
        self.settings = ShellSettingsStore(userData: configuration.userData)
        self.launcher = ElectronLauncher(applicationPath: configuration.applicationPath)
        super.init()
    }

    func start() throws {
        do {
            try FileManager.default.createDirectory(at: runtimeDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try acquireLock()
            settings.load()
            try writeToken()
            let server = ControlServer(path: socketPath, handler: { [weak self] client, request in self?.handle(client: client, request: request) }, disconnected: { _ in })
            try server.start()
            self.server = server
            let supervisor = supervisorFactory({ [weak self] event, generation in self?.receive(event, generation: generation) }, { [weak self] state, error, restartCount, generation in self?.receiveHealth(state: state, error: error, restartCount: restartCount, generation: generation) })
            self.supervisor = supervisor
            try supervisor.start()
            launcher.onApplicationExit = { [weak self] in self?.desktopApplicationExited() }
            launcher.observeTermination()
        } catch {
            cleanup()
            throw error
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let requested = configuration.presence
        let visible = requested == "menu-bar" || settings.snapshot()["appPresence"]?.stringValue == "menu-bar"
        let status = StatusItemController(iconPath: configuration.iconPath, show: { [weak self] in self?.showShell() }, quit: { [weak self] in self?.shutdown() })
        status.install(visible: visible)
        statusItem = status
    }

    func applicationWillTerminate(_ notification: Notification) {
        cleanup()
    }

    func showShell() { launcher.show(arguments: ["--moirasia-open=shell"]) }

    private func handle(client: ClientConnection, request: HostRequest) {
        stateQueue.async { [weak self, weak client] in
            guard let self, let client else { return }
            guard client.isAuthenticated() || request.method == "host.authenticate" else {
                client.send(.response(HostResponse(id: request.id, error: HostError(code: "unauthenticated", message: "Authenticate before sending requests."))))
                return
            }
            if request.method == "host.authenticate" {
                let supplied = request.params["token"]?.stringValue ?? ""
                if client.authenticate(token: supplied, expected: self.token) {
                    client.send(.response(HostResponse(id: request.id, result: jsonObject([( "authenticated", .bool(true) ), ("protocol", .number(Double(moirasiaProtocolVersion))) ]))))
                } else {
                    client.send(.response(HostResponse(id: request.id, error: HostError(code: "authentication_failed", message: "Invalid native host token."))))
                    client.close()
                }
                return
            }
            self.handleAuthenticated(client: client, request: request)
        }
    }

    private func handleAuthenticated(client: ClientConnection, request: HostRequest) {
        switch request.method {
        case "host.getSnapshot":
            forward(request) { [weak self] response in
                guard let self else { return }
                client.send(.response(self.injectSettings(response)))
            }
        case "host.setPresence":
            do {
                let value = try settings.setPresence(request.params["mode"]?.stringValue ?? "")
                updateStatusItem(mode: value["appPresence"]?.stringValue)
                client.send(.response(HostResponse(id: request.id, result: value)))
                publishSnapshotChanged()
            } catch { client.send(.response(errorResponse(request.id, error))) }
        case "host.setLaunchAtLogin":
            do {
                let value = try settings.setLaunchAtLogin(request.params["enabled"]?.boolValue ?? false)
                client.send(.response(HostResponse(id: request.id, result: value)))
                publishSnapshotChanged()
            } catch { client.send(.response(errorResponse(request.id, error))) }
        case "host.setFeatureInstalled":
            guard let id = request.params["id"]?.stringValue, let installed = request.params["installed"]?.boolValue else {
                client.send(.response(HostResponse(id: request.id, error: HostError(code: "invalid_params", message: "Feature id and installed flag are required."))))
                return
            }
            let forwarded = HostRequest(id: request.id, method: "feature.setInstalled", params: ["id": .string(id), "installed": .bool(installed)])
            forward(forwarded) { [weak self] response in
                guard let self else { return }
                guard response.ok else { client.send(.response(response)); return }
                do {
                    let value = try self.settings.setFeatureInstalled(id: id, installed: installed)
                    client.send(.response(HostResponse(id: request.id, result: value)))
                    self.publishSnapshotChanged()
                } catch { client.send(.response(self.errorResponse(request.id, error))) }
            }
        case "host.retryFeature":
            forward(request) { response in client.send(.response(response)) }
        case "host.setUiState":
            mergeHostUiState(request.params)
            forward(request) { [weak self, weak client] response in
                guard let self else { return }
                self.stateQueue.async {
                    guard let client else { return }
                    client.send(.response(response))
                    guard response.ok else { return }
                    self.revision += 1
                    self.server?.broadcast(HostEvent(event: "host.uiStateChanged", revision: self.revision, payload: .object(request.params)))
                }
            }
        case "host.quitSuite":
            shutdown(replyTo: client, requestId: request.id)
        default:
            forward(request) { response in client.send(.response(response)) }
        }
    }

    private func forward(_ request: HostRequest, completion: @escaping (HostResponse) -> Void) {
        forwardTagged(request) { response, _ in completion(response) }
    }

    private func forwardTagged(_ request: HostRequest, completion: @escaping (HostResponse, UInt64) -> Void) {
        guard let supervisor else {
            completion(HostResponse(id: request.id, error: HostError(code: "feature_service_unavailable", message: "MoirasiaFeatureService is not running.")), activeGeneration ?? 0)
            return
        }
        supervisor.request(request, completion: completion)
    }

    private func injectSettings(_ response: HostResponse) -> HostResponse {
        guard response.ok, case .object(var object) = response.result else { return response }
        object["settings"] = settings.snapshot()
        return HostResponse(id: response.id, result: .object(object), version: response.version)
    }

    private func receive(_ event: HostEvent, generation: UInt64) {
        stateQueue.async { [weak self] in
            guard let self, self.activeGeneration == generation, !self.generationTerminal else { return }
            if event.event == "host.snapshotChanged", !self.initialSnapshotReceived, self.isFullSnapshot(event.payload) {
                self.initialSnapshotReceived = true
                if !self.initialReplayAttempted {
                    self.initialReplayAttempted = true
                    self.sendUiStateReplay(generation: generation)
                }
            }
            self.revision = max(self.revision + 1, event.revision)
            let payload = event.event == "host.snapshotChanged" ? self.withSettings(event.payload) : event.payload
            let rewritten = HostEvent(event: event.event, revision: self.revision, payload: payload)
            self.server?.broadcast(rewritten)
            if event.event == "ui.openShell" { self.launcher.show(arguments: ["--moirasia-open=shell"]) }
            if event.event == "ui.toggleShelf", self.server?.hasAuthenticatedClient() != true { self.launcher.show(arguments: ["--moirasia-open=shelf"]) }
        }
    }

    private func receiveHealth(state: FeatureServiceSupervisor.HealthState, error: String?, restartCount: Int, generation: UInt64) {
        stateQueue.async { [weak self] in
            guard let self else { return }
            if state == .starting {
                if let activeGeneration = self.activeGeneration, generation <= activeGeneration { return }
                self.activeGeneration = generation
                self.generationTerminal = false
                self.initialSnapshotReceived = false
                self.initialReplayAttempted = false
                self.replayInFlightGeneration = nil
                self.replayStateChanged = false
            } else {
                guard self.activeGeneration == generation, !self.generationTerminal else { return }
                if state == .error || state == .stopped {
                    self.generationTerminal = true
                    self.replayInFlightGeneration = nil
                    self.replayStateChanged = false
                }
            }
            self.serviceState = state
            self.serviceError = error
            self.serviceRestartCount = restartCount
            self.revision += 1
            self.server?.broadcast(HostEvent(event: "host.snapshotChanged", revision: self.revision, payload: self.healthPayload()))
        }
    }

    func desktopApplicationExited() {
        // The UI is gone; global hotkeys must dispatch again.
        stateQueue.async { [weak self] in
            guard let self else { return }
            let params: [String: JSONValue] = ["mainVisible": .bool(false), "mainFocused": .bool(false), "shelfVisible": .bool(false)]
            self.mergeHostUiState(params)
            let request = HostRequest(id: UUID().uuidString, method: "host.setUiState", params: params)
            self.forward(request) { _ in }
        }
    }

    private func mergeHostUiState(_ params: [String: JSONValue]) {
        var updates: [String: Bool] = [:]
        for key in ["mainVisible", "mainFocused", "shelfVisible"] {
            guard let value = params[key] else { continue }
            guard let boolean = value.boolValue else { return }
            updates[key] = boolean
        }

        var next = hostUiState
        if let value = updates["mainVisible"] { next.mainVisible = value }
        if let value = updates["mainFocused"] { next.mainFocused = value }
        if let value = updates["shelfVisible"] { next.shelfVisible = value }
        guard next != hostUiState else { return }
        hostUiState = next
        if replayInFlightGeneration != nil { replayStateChanged = true }
    }

    private func isFullSnapshot(_ payload: JSONValue) -> Bool {
        guard let object = payload.objectValue,
              object["version"]?.numberValue == 1,
              object["revision"]?.numberValue != nil,
              object["settings"]?.objectValue != nil,
              object["features"]?.arrayValue != nil else { return false }
        return true
    }

    private func sendUiStateReplay(generation: UInt64) {
        guard activeGeneration == generation, !generationTerminal else { return }
        let request = HostRequest(id: UUID().uuidString, method: "host.setUiState", params: hostUiState.params)
        replayStateChanged = false
        replayInFlightGeneration = generation
        forwardTagged(request) { [weak self] response, requestGeneration in
            guard let self else { return }
            self.stateQueue.async {
                self.completeUiStateReplay(response, generation: requestGeneration)
            }
        }
    }

    private func completeUiStateReplay(_ response: HostResponse, generation: UInt64) {
        guard activeGeneration == generation,
              !generationTerminal,
              replayInFlightGeneration == generation else { return }
        replayInFlightGeneration = nil

        let transportFailure = ["feature_service_crashed", "feature_service_unavailable"].contains(response.error?.code ?? "")
        if transportFailure {
            replayStateChanged = false
            return
        }
        if replayStateChanged {
            replayStateChanged = false
            sendUiStateReplay(generation: generation)
            return
        }
        guard response.ok else { return }

        revision += 1
        server?.broadcast(HostEvent(event: "host.uiStateChanged", revision: revision, payload: .object(hostUiState.params)))
    }

    private func publishSnapshotChanged() {
        let request = HostRequest(id: UUID().uuidString, method: "host.getSnapshot")
        forward(request) { [weak self] response in
            guard let self else { return }
            self.stateQueue.async {
                guard response.ok, let result = response.result else { return }
                self.revision += 1
                self.server?.broadcast(HostEvent(event: "host.snapshotChanged", revision: self.revision, payload: self.withSettings(result)))
            }
        }
    }

    private func withSettings(_ value: JSONValue) -> JSONValue {
        guard case .object(var object) = value else { return value }
        if object["featureService"] != nil && object["features"] == nil { return value }
        object["settings"] = settings.snapshot()
        return .object(object)
    }

    private func healthPayload() -> JSONValue {
        var health: [String: JSONValue] = [
            "state": .string(serviceState.rawValue),
            "restartCount": .number(Double(serviceRestartCount))
        ]
        if let serviceError { health["error"] = .string(serviceError) }
        return .object(["featureService": .object(health)])
    }

    private func updateStatusItem(mode: String?) {
        let visible = mode == "menu-bar"
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.statusItem?.remove()
            self.statusItem?.install(visible: visible)
        }
    }

    private func writeToken() throws {
        var bytes = Data(count: 32)
        _ = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        token = bytes.base64EncodedString()
        FileManager.default.createFile(atPath: tokenPath, contents: Data((token + "\n").utf8), attributes: [.posixPermissions: 0o600])
        chmod(tokenPath, 0o600)
    }

    private func acquireLock() throws {
        let value = Darwin.open(lockPath, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard value >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        guard flock(value, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(value)
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(EWOULDBLOCK))
        }
        lockDescriptor = value
        chmod(lockPath, 0o600)
    }

    func shutdown() { shutdown(replyTo: nil, requestId: nil) }

    private func shutdown(replyTo client: ClientConnection?, requestId: String?) {
        stateQueue.async { [weak self, weak client] in
            guard let self, !self.shuttingDown else { return }
            self.shuttingDown = true
            let request = HostRequest(id: UUID().uuidString, method: "host.prepareToQuit")
            self.forward(request) { [weak self, weak client] response in
                guard let self else { return }
                let failures = self.cleanupFailures(from: response)
                if !failures.isEmpty {
                    let message = failures.joined(separator: "\n")
                    fputs("Moirasia shutdown cleanup failed: \(message)\n", stderr)
                    if let client, let requestId {
                        client.send(.response(HostResponse(id: requestId, error: HostError(code: "cleanup_failed", message: message))))
                    }
                } else if let client, let requestId {
                    client.send(.response(HostResponse(id: requestId, result: .object(["accepted": .bool(true)]))))
                }
                self.stateQueue.async { [weak self] in self?.finishShutdown() }
            }
        }
    }

    private func cleanupFailures(from response: HostResponse) -> [String] {
        guard response.ok else { return [response.error?.localizedDescription ?? "MoirasiaFeatureService could not prepare to quit."] }
        guard case .object(let result) = response.result, case .array(let values) = result["cleanupErrors"] else { return [] }
        return values.compactMap(\.stringValue)
    }

    private func finishShutdown() {
        revision += 1
        server?.broadcast(HostEvent(event: "host.willQuit", revision: revision, payload: .object([:])))
        supervisor?.stop()
        launcher.terminate()
        server?.stop()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { NSApplication.shared.terminate(nil) }
    }

    private func cleanup() {
        supervisor?.stop()
        server?.stop()
        if lockDescriptor >= 0 { _ = flock(lockDescriptor, LOCK_UN); Darwin.close(lockDescriptor); lockDescriptor = -1 }
        try? FileManager.default.removeItem(atPath: tokenPath)
        try? FileManager.default.removeItem(atPath: socketPath)
    }

    private func errorResponse(_ id: String, _ error: Error) -> HostResponse {
        if let hostError = error as? HostError { return HostResponse(id: id, error: hostError) }
        return HostResponse(id: id, error: HostError(code: "request_failed", message: error.localizedDescription))
    }
}
