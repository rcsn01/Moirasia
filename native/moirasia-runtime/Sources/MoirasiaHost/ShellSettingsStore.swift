import Foundation
import MoirasiaProtocol

final class ShellSettingsStore {
    private let path: URL
    private let backup: URL
    private var document: [String: JSONValue] = [:]
    private let lock = NSLock()

    init(userData: String) {
        let directory = URL(fileURLWithPath: userData, isDirectory: true)
        self.path = directory.appendingPathComponent("settings.json")
        self.backup = directory.appendingPathComponent("settings.json.backup")
    }

    func load() {
        lock.lock()
        defer { lock.unlock() }
        let raw = read(path) ?? read(backup)
        document = normalized(raw)
        try? persistLocked(backupExisting: false)
    }

    func snapshot() -> JSONValue {
        lock.lock(); defer { lock.unlock() }
        return .object(document)
    }

    func setPresence(_ value: String) throws -> JSONValue {
        guard value == "dock" || value == "menu-bar" else { throw HostError(code: "invalid_params", message: "Presence must be dock or menu-bar.") }
        return try update { document in document["appPresence"] = .string(value) }
    }

    func setLaunchAtLogin(_ value: Bool) throws -> JSONValue {
        try update { document in document["launchAtLogin"] = .bool(value) }
    }

    func setFeatureInstalled(id: String, installed: Bool) throws -> JSONValue {
        guard ["bonded", "shout", "amove"].contains(id) else { throw HostError(code: "unknown_feature", message: "Unknown feature '\(id)'.") }
        var features = object(document["features"])
        features[id] = .bool(installed)
        return try update { document in document["features"] = .object(features) }
    }

    private func update(_ operation: (inout [String: JSONValue]) -> Void) throws -> JSONValue {
        lock.lock()
        defer { lock.unlock() }
        var next = document
        operation(&next)
        next["version"] = .number(4)
        if next["pendingLoginItems"] == nil { next["pendingLoginItems"] = .object([:]) }
        if next["features"] == nil { next["features"] = .object([:]) }
        let previous = document
        document = next
        do { try persistLocked(backupExisting: true) }
        catch { document = previous; throw error }
        return .object(document)
    }

    private func normalized(_ value: JSONValue?) -> [String: JSONValue] {
        let source = object(value)
        let version = source["version"]?.intValue
        let launchAtLogin = source["launchAtLogin"]?.boolValue ?? false
        let presence = source["appPresence"]?.stringValue == "menu-bar" ? "menu-bar" : "dock"
        var result: [String: JSONValue] = [
            "version": .number(4),
            "launchAtLogin": .bool(launchAtLogin),
            "appPresence": .string(presence),
            "pendingLoginItems": .object(validPending(source["pendingLoginItems"])),
            "features": .object(validFeatures(source["features"]))
        ]
        if version == nil, let legacy = object(source["autoStart"]) as [String: JSONValue]? {
            var pending: [String: JSONValue] = [:]
            for id in ["amove", "bonded", "shout"] where legacy[id]?.boolValue == true { pending[id] = .bool(true) }
            result["pendingLoginItems"] = .object(pending)
        }
        return result
    }

    private func validPending(_ value: JSONValue?) -> [String: JSONValue] {
        let source = object(value)
        return source.filter { ["amove", "bonded", "shout"].contains($0.key) && $0.value.boolValue == true }
    }

    private func validFeatures(_ value: JSONValue?) -> [String: JSONValue] {
        let source = object(value)
        let retired: Set<String> = ["exithibition", "orbis"]
        return source.filter { key, value in !retired.contains(key) && value.boolValue != nil }
    }

    private func read(_ url: URL) -> JSONValue? {
        guard let data = try? Data(contentsOf: url), let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return nil }
        return value
    }

    private func persistLocked(backupExisting: Bool) throws {
        let directory = path.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let data = try JSONEncoder().encode(JSONValue.object(document)) + Data([0x0a])
        let temporary = directory.appendingPathComponent(".settings.\(getpid()).\(UUID().uuidString).tmp")
        FileManager.default.createFile(atPath: temporary.path, contents: nil, attributes: [.posixPermissions: 0o600])
        defer { try? FileManager.default.removeItem(at: temporary) }
        try data.write(to: temporary, options: .atomic)
        chmod(temporary.path, 0o600)
        if backupExisting, FileManager.default.fileExists(atPath: path.path) {
            try? FileManager.default.removeItem(at: backup)
            try FileManager.default.copyItem(at: path, to: backup)
            chmod(backup.path, 0o600)
        }
        try? FileManager.default.removeItem(at: path)
        try FileManager.default.moveItem(at: temporary, to: path)
        chmod(path.path, 0o600)
    }

    private func object(_ value: JSONValue?) -> [String: JSONValue] {
        guard case .object(let object) = value else { return [:] }
        return object
    }
}
