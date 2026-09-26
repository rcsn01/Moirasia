import Foundation
import MoirasiaProtocol

final class FeatureRuntime {
    private let userData: String
    private let stateQueue: DispatchQueue
    private let modules: [String: FeatureModule]
    private var installed: [String: Bool] = [:]
    private var revision: UInt64 = 0
    private var emittedSnapshots: [String: JSONValue] = [:]
    private var settings: [String: JSONValue] = [:]
    private var leases: [String: FeatureRuntimeLease] = [:]
    private var moduleErrors: [String: String] = [:]
    private var hostUiState = HostUiState()
    private var shutdownErrors: [String]?
    private let emit: (HostEvent) -> Void
    private let stateQueueKey = DispatchSpecificKey<Bool>()

    convenience init(
        userData: String,
        stateQueue: DispatchQueue,
        bondedHelperExecutable: String?,
        shoutDriverDirectory: String?,
        emit: @escaping (HostEvent) -> Void
    ) {
        let modules: [String: FeatureModule] = [
            "bonded": BondedModule(userData: userData, helperExecutable: bondedHelperExecutable ?? ""),
            "shout": ShoutModule(userData: userData, driverSourceDirectory: shoutDriverDirectory ?? ""),
            "amove": AmoveModule(userData: userData)
        ]
        self.init(userData: userData, stateQueue: stateQueue, modules: modules, emit: emit)
    }

    init(
        userData: String,
        stateQueue: DispatchQueue,
        modules: [String: FeatureModule],
        emit: @escaping (HostEvent) -> Void
    ) {
        precondition(modules.allSatisfy { $0.key == $0.value.id }, "Feature module keys must match module ids")
        self.userData = userData
        self.stateQueue = stateQueue
        self.emit = emit
        self.modules = modules
        stateQueue.setSpecific(key: stateQueueKey, value: true)
        for (id, module) in modules {
            module.publishHook = { [weak self] in self?.enqueueFeatureSnapshot(id: id) }
            module.eventHook = { [weak self] name in self?.publishEventHook(id: id, name: name) }
        }
        loadSettings()
    }

    @discardableResult
    func stopAll() -> [String] {
        onStateQueue { stopAllOnStateQueue() }
    }

    private func stopAllOnStateQueue() -> [String] {
        if let shutdownErrors { return shutdownErrors }
        var failures: [String] = []
        for id in modules.keys.sorted() {
            guard let module = modules[id] else { continue }
            do { try module.stop(); moduleErrors[id] = nil }
            catch {
                let message = errorMessage(error)
                moduleErrors[id] = message
                failures.append("\(id): \(message)")
            }
        }
        for id in leases.keys.sorted() { leases[id]?.release(); leases[id] = nil }
        shutdownErrors = failures
        publishSnapshot()
        return failures
    }

    func startInstalled() {
        onStateQueue { startInstalledOnStateQueue() }
    }

    private func startInstalledOnStateQueue() {
        shutdownErrors = nil
        for id in modules.keys {
            let shouldStart = installed[id] ?? true
            installed[id] = shouldStart
            if shouldStart { start(id: id) }
        }
        publishSnapshot()
    }

    func handle(_ request: HostRequest) -> HostResponse {
        onStateQueue { handleOnStateQueue(request) }
    }

    private func handleOnStateQueue(_ request: HostRequest) -> HostResponse {
        do {
            let result: JSONValue
            switch request.method {
            case "host.getSnapshot":
                result = snapshot()
            case "feature.setInstalled":
                result = try setInstalled(request)
            case "host.setUiState":
                result = try setHostUiState(request)
            case "host.prepareToQuit":
                let failures = stopAll()
                result = .object(["cleanupErrors": .array(failures.map(JSONValue.string))])
            case "host.retryFeature":
                result = try retry(request)
            default:
                guard let id = request.method.split(separator: ".").first.map(String.init), let module = modules[id] else {
                    throw HostError(code: "unknown_method", message: "Unknown native feature method '\(request.method)'.")
                }
                result = try module.handle(request)
                if request.method != "\(id).getSnapshot" && request.method != "\(id).snapshot" {
                    // Modules emit semantic UI events through eventHook; request handling only publishes state.
                    publishFeatureSnapshot(id: id)
                }
            }
            return HostResponse(id: request.id, result: result)
        } catch let error as HostError {
            return HostResponse(id: request.id, error: error)
        } catch {
            return HostResponse(id: request.id, error: HostError(code: "feature_failed", message: error.localizedDescription))
        }
    }

    private func setInstalled(_ request: HostRequest) throws -> JSONValue {
        guard let id = request.params["id"]?.stringValue, modules[id] != nil, let value = request.params["installed"]?.boolValue else {
            throw HostError(code: "invalid_params", message: "A known feature id and installed flag are required.")
        }
        if value {
            do { try startOrThrow(id: id); installed[id] = true }
            catch {
                installed[id] = false
                moduleErrors[id] = errorMessage(error)
                publishSnapshot()
                throw HostError(code: "feature_start_failed", message: errorMessage(error))
            }
        } else {
            do { try modules[id]?.stop() }
            catch {
                let message = errorMessage(error)
                moduleErrors[id] = message
                publishSnapshot()
                throw HostError(code: "feature_stop_failed", message: message)
            }
            leases[id]?.release(); leases[id] = nil
            moduleErrors[id] = nil
            installed[id] = false
        }
        publishSnapshot()
        return status(id: id)
    }

    private func retry(_ request: HostRequest) throws -> JSONValue {
        guard let id = request.params["id"]?.stringValue, modules[id] != nil else {
            throw HostError(code: "invalid_params", message: "A known feature id is required.")
        }
        do { try startOrThrow(id: id); installed[id] = true; publishSnapshot(); return status(id: id) }
        catch {
            moduleErrors[id] = errorMessage(error)
            publishSnapshot()
            throw HostError(code: "feature_start_failed", message: errorMessage(error))
        }
    }

    private func status(id: String) -> JSONValue {
        guard let module = modules[id] else { return .object([:]) }
        let error = moduleErrors[id] ?? module.error
        var object: [String: JSONValue] = ["id": .string(id), "installed": .bool(installed[id] ?? false), "state": .string(error == nil ? (module.isRunning ? "running" : "stopped") : "error")]
        if let error { object["error"] = .string(error) }
        return .object(object)
    }

    private func snapshot() -> JSONValue {
        let features = modules.keys.sorted().map { status(id: $0) }
        var value: [String: JSONValue] = [
            "version": .number(1),
            "revision": .number(Double(revision)),
            "settings": .object(settings),
            "features": .array(features)
        ]
        for id in modules.keys { value[id] = modules[id]?.snapshot() }
        return .object(value)
    }

    private func publishSnapshot() {
        revision += 1
        emit(HostEvent(event: "host.snapshotChanged", revision: revision, payload: snapshot()))
        for id in modules.keys.sorted() { publishFeatureSnapshot(id: id) }
    }

    private func enqueueFeatureSnapshot(id: String) {
        stateQueue.async { [weak self] in
            guard let self, self.shutdownErrors == nil else { return }
            self.publishFeatureSnapshot(id: id)
        }
    }

    private func publishEventHook(id: String, name: String) {
        if isOnStateQueue {
            guard shutdownErrors == nil else { return }
            emitFeatureEvent(id: id, name: name)
        } else {
            stateQueue.async { [weak self] in
                guard let self, self.shutdownErrors == nil else { return }
                self.emitFeatureEvent(id: id, name: name)
            }
        }
    }

    private func publishFeatureSnapshot(id: String) {
        let payload = modules[id]?.snapshot() ?? .object([:])
        guard emittedSnapshots[id] != payload else { return }
        emittedSnapshots[id] = payload
        revision += 1
        emit(HostEvent(event: "\(id).snapshot", revision: revision, payload: payload))
    }

    private func emitFeatureEvent(id: String, name: String) {
        guard shutdownErrors == nil else { return }
        revision += 1
        emit(HostEvent(event: name, revision: revision, payload: .object(["feature": .string(id)])))
    }

    private var isOnStateQueue: Bool { DispatchQueue.getSpecific(key: stateQueueKey) == true }

    private func onStateQueue<T>(_ work: () throws -> T) rethrows -> T {
        if isOnStateQueue { return try work() }
        return try stateQueue.sync(execute: work)
    }

    private func loadSettings() {
        let path = URL(fileURLWithPath: userData, isDirectory: true).appendingPathComponent("settings.json")
        guard let data = try? Data(contentsOf: path), let value = try? JSONDecoder().decode(JSONValue.self, from: data), case .object(let object) = value else {
            settings = ["version": .number(4), "launchAtLogin": .bool(false), "appPresence": .string("dock"), "pendingLoginItems": .object([:]), "features": .object([:])]
            return
        }
        settings = object
        if case .object(let featureFlags) = object["features"] {
            for id in modules.keys { installed[id] = featureFlags[id]?.boolValue ?? true }
        }
    }

    private func start(id: String) {
        do { try startOrThrow(id: id) }
        catch { moduleErrors[id] = errorMessage(error) }
    }

    private func startOrThrow(id: String) throws {
        guard let module = modules[id] else { throw HostError(code: "unknown_feature", message: "Unknown feature '\(id)'.") }
        if leases[id] == nil {
            let lockName = id == "bonded" ? "bonded-runtime.lock" : id == "shout" ? "shout-runtime.lock" : "amove-runtime.lock"
            leases[id] = try FeatureRuntimeLease(appData: appDataDirectory, lockName: lockName, host: "Moirasia")
        }
        var didStart = false
        do {
            try module.start()
            didStart = true
            try applyHostUiState(to: id, requestID: UUID().uuidString)
            moduleErrors[id] = nil
        } catch {
            if didStart {
                do { try module.stop() }
                catch { fputs("MoirasiaFeatureService failed to stop \(id) after UI-state replay error: \(error)\n", stderr) }
            }
            leases[id]?.release()
            leases[id] = nil
            throw error
        }
    }

    private var appDataDirectory: String {
        let url = URL(fileURLWithPath: userData, isDirectory: true)
        return url.lastPathComponent == "Moirasia" ? url.deletingLastPathComponent().path : userData
    }

    private struct HostUiState {
        var mainVisible = false
        var mainFocused = false
        var shelfVisible = false
    }

    private func setHostUiState(_ request: HostRequest) throws -> JSONValue {
        var updatedState = hostUiState
        var updatesAmove = false
        var updatesBonded = false

        if let value = request.params["mainVisible"] {
            guard let visible = value.boolValue else {
                throw HostError(code: "invalid_params", message: "mainVisible must be a boolean.")
            }
            updatedState.mainVisible = visible
            updatesBonded = true
        }
        if let value = request.params["mainFocused"] {
            guard let focused = value.boolValue else {
                throw HostError(code: "invalid_params", message: "mainFocused must be a boolean.")
            }
            updatedState.mainFocused = focused
            updatesAmove = true
        }
        if let value = request.params["shelfVisible"] {
            guard let visible = value.boolValue else {
                throw HostError(code: "invalid_params", message: "shelfVisible must be a boolean.")
            }
            updatedState.shelfVisible = visible
            updatesAmove = true
        }

        hostUiState = updatedState
        var changedErrors = false
        var firstError: Error?

        if updatesAmove, let amove = modules["amove"], amove.isRunning {
            do {
                try applyHostUiState(to: "amove", requestID: request.id)
                if moduleErrors.removeValue(forKey: "amove") != nil { changedErrors = true }
            } catch {
                if moduleErrors["amove"] != errorMessage(error) { changedErrors = true }
                moduleErrors["amove"] = errorMessage(error)
                firstError = error
            }
        }
        if updatesBonded, let bonded = modules["bonded"], bonded.isRunning {
            do {
                try applyHostUiState(to: "bonded", requestID: request.id)
                if moduleErrors.removeValue(forKey: "bonded") != nil { changedErrors = true }
            } catch {
                if moduleErrors["bonded"] != errorMessage(error) { changedErrors = true }
                moduleErrors["bonded"] = errorMessage(error)
                if firstError == nil { firstError = error }
            }
        }

        if changedErrors { publishSnapshot() }
        if let firstError { throw firstError }
        return .object(["accepted": .bool(true)])
    }

    private func applyHostUiState(to id: String, requestID: String) throws {
        guard let module = modules[id] else { return }
        let request: HostRequest
        switch id {
        case "amove":
            request = HostRequest(id: requestID, method: "amove.setUiState", params: [
                "mainFocused": .bool(hostUiState.mainFocused),
                "shelfVisible": .bool(hostUiState.shelfVisible)
            ])
        case "bonded":
            request = HostRequest(id: requestID, method: "bonded.setUiState", params: ["mainVisible": .bool(hostUiState.mainVisible)])
        default:
            return
        }
        _ = try module.handle(request)
    }

    private func errorMessage(_ error: Error) -> String {
        if let error = error as? HostError { return error.message }
        return error.localizedDescription
    }
}
