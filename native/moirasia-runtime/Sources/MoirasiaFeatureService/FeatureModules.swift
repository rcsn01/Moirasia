import Foundation
import MoirasiaProtocol
import BondedRuntime
import ShoutRuntime
import AmoveRuntime

final class FeatureSettingsStore {
    private let path: URL
    private var values: [String: JSONValue] = [:]

    init(userData: String, feature: String) {
        let directory = URL(fileURLWithPath: userData, isDirectory: true).appendingPathComponent("features", isDirectory: true).appendingPathComponent(feature, isDirectory: true)
        path = directory.appendingPathComponent("settings.json")
        if let data = try? Data(contentsOf: path), let value = try? JSONDecoder().decode(JSONValue.self, from: data), case .object(let object) = value { values = object }
    }

    func bool(_ key: String, default value: Bool) -> Bool { values[key]?.boolValue ?? value }
    func int(_ key: String, default value: Int) -> Int { values[key]?.intValue ?? value }
    func string(_ key: String) -> String? { values[key]?.stringValue }
    func set(_ key: String, _ value: JSONValue) { values[key] = value; persist() }
    func setValues(_ values: [String: JSONValue]) { self.values = values; persist() }

    private func persist() {
        do {
            let directory = path.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let temporary = directory.appendingPathComponent(".settings.\(getpid()).tmp")
            try JSONEncoder().encode(JSONValue.object(values)).write(to: temporary, options: .atomic)
            chmod(temporary.path, 0o600)
            try? FileManager.default.removeItem(at: path)
            try FileManager.default.moveItem(at: temporary, to: path)
            chmod(path.path, 0o600)
        } catch { /* The caller retains the in-memory state and reports it on the next lifecycle request. */ }
    }
}

final class BondedModule: BasicFeatureModule {
    private let runtime: BondedRuntime

    init(userData: String, helperExecutable: String) {
        runtime = BondedRuntime(dataDirectory: URL(fileURLWithPath: userData, isDirectory: true).appendingPathComponent("features/bonded").path, helperExecutable: helperExecutable)
        super.init(id: "bonded")
        runtime.onSnapshot = { [weak self] _ in self?.publishHook?() }
    }

    override func start() throws {
        try super.start()
        runtime.start()
    }

    override func stop() { runtime.stop(); super.stop() }

    override func snapshot() -> JSONValue { runtime.snapshot() }

    override func handle(_ request: HostRequest) throws -> JSONValue {
        guard isRunning else { throw HostError(code: "feature_stopped", message: "Bonded is stopped.") }
        switch request.method {
        case "bonded.getSnapshot", "bonded.snapshot": return snapshot()
        case "bonded.setMonitoring":
            guard let value = request.params["enabled"]?.boolValue else { throw invalidParams() }
            return runtime.setMonitoring(value)
        case "bonded.installFirewallHelper": return try runtime.installFirewallHelper()
        case "bonded.uninstallFirewallHelper": return try runtime.uninstallFirewallHelper()
        case "bonded.setBlocking":
            guard let value = request.params["enabled"]?.boolValue else { throw invalidParams() }
            return try runtime.setBlocking(value)
        case "bonded.selectObservedApplication":
            guard let id = request.params["applicationId"]?.stringValue else { throw invalidParams() }
            return try runtime.selectObservedApplication(id)
        case "bonded.removeApplicationRule":
            guard let id = request.params["applicationRuleId"]?.stringValue else { throw invalidParams() }
            return try runtime.removeApplicationRule(id)
        case "bonded.restartMonitor": return runtime.restartMonitor()
        default: return try super.handle(request)
        }
    }

    private func invalidParams() -> HostError { HostError(code: "invalid_params", message: "Invalid Bonded request parameters.") }
}

final class ShoutModule: BasicFeatureModule {
    private let runtime: ShoutRuntime
    private let installer: DriverInstaller

    init(userData: String, driverSourceDirectory: String) {
        runtime = ShoutRuntime(dataDirectory: URL(fileURLWithPath: userData, isDirectory: true).appendingPathComponent("features/shout").path)
        let sourceDirectory = Self.resolveDriverSource(preferred: driverSourceDirectory)
        installer = DriverInstaller(sourceDirectory: sourceDirectory)
        super.init(id: "shout")
        runtime.onSnapshot = { [weak self] _ in self?.publishHook?() }
    }

    override func start() throws { try super.start(); runtime.start(); if runtime.snapshot.boostEnabled && runtime.permission.authorizationStatus() == "granted" { runtime.setBoost(true) } }
    override func stop() { runtime.stop(); super.stop() }

    override func snapshot() -> JSONValue {
        let state = runtime.snapshot
        let driver = installer.status()
        var driverObject: [String: JSONValue] = ["state": .string(driver.state), "message": .string(driver.message)]
        if let sourcePath = driver.sourcePath { driverObject["sourcePath"] = .string(sourcePath) }
        var value: [String: JSONValue] = [
            "version": .number(1),
            "boostEnabled": .bool(state.boostEnabled),
            "boostActive": .bool(state.boostActive),
            "gainDb": .number(state.gainDb),
            "limiterEnabled": .bool(state.limiterEnabled),
            "makeDefaultInput": .bool(state.makeDefaultInput),
            "sourceMode": .string(state.sourceMode),
            "captureState": .string(state.captureState),
            "shoutMicPresent": .bool(state.shoutMicPresent || driver.state == "installed"),
            "driverStatus": .object(driverObject),
            "permissionState": .string(state.permissionState),
            "defaultInputIsShoutMic": .bool(state.defaultInputIsShoutMic),
            "devices": .array(state.devices.map { device -> JSONValue in
                var deviceObject: [String: JSONValue] = ["uid": .string(device.uid), "name": .string(device.name)]
                if let sampleRate = device.sampleRate { deviceObject["sampleRate"] = .number(sampleRate) }
                return .object(deviceObject)
            })
        ]
        if let uid = state.sourceUid { value["sourceUid"] = .string(uid) }
        if let uid = state.activeSourceUid { value["activeSourceUid"] = .string(uid) }
        if let name = state.activeSourceName { value["activeSourceName"] = .string(name) }
        if let uid = state.defaultInputUid { value["defaultInputUid"] = .string(uid) }
        if let peak = state.meterPeakDbfs { value["meterPeakDbfs"] = .number(peak) }
        if let error = state.error { value["error"] = .string(error) }
        return .object(value)
    }

    override func handle(_ request: HostRequest) throws -> JSONValue {
        guard isRunning else { throw HostError(code: "feature_stopped", message: "Shout is stopped.") }
        switch request.method {
        case "shout.getSnapshot", "shout.snapshot": return snapshot()
        case "shout.setBoost":
            guard let value = request.params["enabled"]?.boolValue else { throw invalidParams() }
            runtime.setBoost(value, requestPermission: value); return snapshot()
        case "shout.setGain":
            guard let value = request.params["db"]?.numberValue, value >= 0, value <= 30 else { throw invalidParams() }
            runtime.setGain(value); return snapshot()
        case "shout.setLimiter":
            guard let value = request.params["enabled"]?.boolValue else { throw invalidParams() }
            runtime.setLimiter(value); return snapshot()
        case "shout.setMakeDefaultInput":
            guard let value = request.params["enabled"]?.boolValue else { throw invalidParams() }
            runtime.setMakeDefaultInput(value); return snapshot()
        case "shout.setSource":
            guard let mode = request.params["mode"]?.stringValue, mode == "follow-default" || mode == "device" else { throw invalidParams() }
            runtime.setSource(mode: mode, uid: request.params["uid"]?.stringValue); return snapshot()
        case "shout.installDriver":
            try installer.install()
            return snapshot()
        default: return try super.handle(request)
        }
    }

    private static func resolveDriverSource(preferred: String) -> String {
        let candidate = URL(fileURLWithPath: preferred, isDirectory: true).appendingPathComponent(ShoutDriverLimits.bundleName).path
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: candidate, isDirectory: &isDirectory), isDirectory.boolValue { return candidate }
        return preferred
    }

    private func invalidParams() -> HostError { HostError(code: "invalid_params", message: "Invalid Shout request parameters.") }
}

final class AmoveModule: BasicFeatureModule {
    private let runtime: AmoveRuntime

    init(userData: String) {
        runtime = AmoveRuntime(dataDirectory: URL(fileURLWithPath: userData, isDirectory: true).appendingPathComponent("features/amove").path)
        super.init(id: "amove")
        runtime.onToggleShelf = { [weak self] in self?.eventHook?("ui.toggleShelf") }
        runtime.onSnapshotChanged = { [weak self] in self?.publishHook?() }
    }

    override func start() throws {
        try super.start()
        runtime.start()
    }
    override func stop() { runtime.stop(); super.stop() }

    override func snapshot() -> JSONValue {
        let values = runtime.snapshotValues()
        let granted = values.accessibilityGranted
        return .object([
            "hostMode": .string("suite"),
            "platform": .string("darwin"),
            "settings": .object([
                "schemaVersion": .number(Double(values.settings.schemaVersion)),
                "presenceMode": .string(values.settings.presenceMode),
                "shortcutsByPlatform": .object(values.settings.shortcutsByPlatform.mapValues { shortcuts in
                    .object(shortcuts.mapValues { binding in encodedValue(binding) ?? .object([:]) })
                }),
                "migrations": .object(values.settings.migrations.mapValues { .string($0) })
            ]),
            "statusMessage": .string(values.statusMessage),
            "lastActionMessage": .string(values.lastActionMessage),
            "shelfVisible": .bool(false),
            "accessibility": .object(["required": .bool(true), "granted": .bool(granted), "label": .string(granted ? "Granted" : "Not granted")]),
            "shortcutIssues": .array(runtime.shortcutIssues.compactMap { encodedValue($0) })
        ])
    }

    override func handle(_ request: HostRequest) throws -> JSONValue {
        guard isRunning else { throw HostError(code: "feature_stopped", message: "Amove is stopped.") }
        switch request.method {
        case "amove.getSnapshot", "amove.snapshot": return snapshot()
        case "amove.performAction":
            guard let action = request.params["action"]?.stringValue else { throw invalidParams() }
            return performResult(runtime.perform(action: action))
        case "amove.setShortcutRecording":
            runtime.setRecording(request.params["active"]?.boolValue ?? false)
            return commandResult()
        case "amove.recordShortcut":
            guard let action = request.params["action"]?.stringValue, let binding = request.params["binding"]?.objectValue else { throw invalidParams() }
            let issues = runtime.recordShortcut(action: action, binding: decodeBinding(.object(binding)))
            return .object(["ok": .bool(true), "value": .null, "message": .string(issues.isEmpty ? "Shortcut recorded for \(action)." : issues.first?.message ?? "Shortcut recorded."), "issues": .array(issues.compactMap { encodedValue($0) })])
        case "amove.resetShortcut":
            _ = runtime.resetShortcut(action: request.params["action"]?.stringValue)
            return commandResult()
        case "amove.setPresence":
            guard let mode = request.params["mode"]?.stringValue else { throw invalidParams() }
            runtime.setPresence(mode)
            return commandResult()
        case "amove.setUiState":
            runtime.setHotkeyPolicy(appFocused: request.params["mainFocused"]?.boolValue ?? false, shelfVisible: request.params["shelfVisible"]?.boolValue ?? false)
            return commandResult()
        case "amove.refreshAccessibility": return accessibilityResult()
        case "amove.requestAccessibility":
            runtime.mover.accessibility.isTrusted(prompt: true)
            return accessibilityResult()
        case "amove.openAccessibilitySettings":
            runtime.mover.accessibility.openSettings()
            return commandResult()
        default: return try super.handle(request)
        }
    }

    private func performResult(_ result: AmoveActionResult) -> JSONValue {
        .object(["ok": .bool(result.ok), "value": .null, "message": .string(result.message), "code": result.code.map { .string($0) } ?? .null])
    }

    private func decodeBinding(_ value: JSONValue) -> AmoveShortcutBinding {
        guard let data = try? JSONEncoder().encode(value), let binding = try? JSONDecoder().decode(AmoveShortcutBinding.self, from: data) else {
            return AmoveShortcutBinding(key: AmoveShortcutKey(), modifiers: [])
        }
        return binding
    }

    private func encodedValue<T: Encodable>(_ value: T) -> JSONValue? {
        guard let data = try? JSONEncoder().encode(value), let object = try? JSONDecoder().decode(JSONValue.self, from: data) else { return nil }
        return object
    }

    private func commandResult() -> JSONValue { .object(["ok": .bool(true), "value": .null, "message": .string(runtime.statusMessageValue)]) }
    private func accessibilityResult() -> JSONValue {
        let granted = runtime.mover.accessibility.isTrusted()
        return .object(["ok": .bool(true), "value": .object(["required": .bool(true), "granted": .bool(granted), "label": .string(granted ? "Granted" : "Not granted")])])
    }
    private func invalidParams() -> HostError { HostError(code: "invalid_params", message: "Invalid Amove request parameters.") }
}

private extension JSONValue {
    var numberValue: Double? { guard case .number(let value) = self else { return nil }; return value }
}