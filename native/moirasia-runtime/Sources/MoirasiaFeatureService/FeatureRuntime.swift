import Foundation
import MoirasiaProtocol

final class FeatureRuntime {
    private let userData: String
    private var modules: [String: FeatureModule]
    private var installed: [String: Bool] = [:]
    private var revision: UInt64 = 0
    private var settings: [String: JSONValue] = [:]
    private var leases: [String: FeatureRuntimeLease] = [:]
    private var moduleErrors: [String: String] = [:]
    private var shellVisible = false
    private var shutdownErrors: [String]?
    private let emit: (HostEvent) -> Void

    init(userData: String, bondedHelperExecutable: String?, shoutDriverDirectory: String?, emit: @escaping (HostEvent) -> Void) {
        self.userData = userData
        self.emit = emit
        self.modules = ["bonded": BondedModule(userData: userData, helperExecutable: bondedHelperExecutable ?? ""), "shout": ShoutModule(userData: userData, driverSourceDirectory: shoutDriverDirectory ?? ""), "amove": AmoveModule(userData: userData)]
        for (id, module) in modules {
            module.publishHook = { [weak self] in self?.publishFeatureSnapshot(id: id) }
            module.eventHook = { [weak self] name in self?.emitFeatureEvent(id: id, name: name) }
        }
        loadSettings()
    }

    @discardableResult
    func stopAll() -> [String] {
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
        shutdownErrors = nil
        for id in modules.keys {
            let shouldStart = installed[id] ?? true
            installed[id] = shouldStart
            if shouldStart { start(id: id) }
        }
        publishSnapshot()
    }

    func handle(_ request: HostRequest) -> HostResponse {
        do {
            let result: JSONValue
            switch request.method {
            case "host.getSnapshot":
                result = snapshot()
            case "feature.setInstalled":
                result = try setInstalled(request)
            case "host.setUiState":
                // Amove uses UI focus for hotkey dispatch; Bonded uses visibility to pause sampling.
                if let amove = modules["amove"], amove.isRunning {
                    _ = try? amove.handle(HostRequest(id: request.id, method: "amove.setUiState", params: request.params))
                }
                if let value = request.params["mainVisible"] {
                    guard let visible = value.boolValue else { throw HostError(code: "invalid_params", message: "Window visibility must be a boolean.") }
                    shellVisible = visible
                    if let bonded = modules["bonded"], bonded.isRunning {
                        do {
                            _ = try bonded.handle(HostRequest(id: request.id, method: "bonded.setUiState", params: ["mainVisible": .bool(visible)]))
                            moduleErrors["bonded"] = nil
                        } catch {
                            moduleErrors["bonded"] = errorMessage(error)
                            publishSnapshot()
                            throw error
                        }
                    }
                }
                result = .object(["accepted": .bool(true)])
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

    private func publishFeatureSnapshot(id: String) {
        revision += 1
        emit(HostEvent(event: "\(id).snapshot", revision: revision, payload: modules[id]?.snapshot() ?? .object([:])))
    }

    private func emitFeatureEvent(id: String, name: String) {
        revision += 1
        emit(HostEvent(event: name, revision: revision, payload: .object(["feature": .string(id)])))
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
        do {
            try module.start()
            if id == "bonded" {
                _ = try module.handle(HostRequest(id: UUID().uuidString, method: "bonded.setUiState", params: ["mainVisible": .bool(shellVisible)]))
            }
            moduleErrors[id] = nil
        } catch {
            leases[id]?.release()
            leases[id] = nil
            throw error
        }
    }

    private var appDataDirectory: String {
        let url = URL(fileURLWithPath: userData, isDirectory: true)
        return url.lastPathComponent == "Moirasia" ? url.deletingLastPathComponent().path : userData
    }

    private func errorMessage(_ error: Error) -> String { error.localizedDescription }
}
