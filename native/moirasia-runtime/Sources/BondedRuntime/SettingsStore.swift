import Foundation

public struct BondedStoredRule: Codable, Equatable, Sendable {
    public let id: String
    public let path: String
    public let displayName: String
    public let targetKind: String
    public let bundleIdentifier: String?
    public let selectedAt: String
}

public struct BondedSettings: Codable, Equatable, Sendable {
    public var version: Int = 3
    public var monitoringEnabled: Bool = true
    public var blockingEnabled: Bool = false
    public var applicationRules: [BondedStoredRule] = []
}

public final class BondedSettingsStore {
    public let path: URL
    public let backupPath: URL
    public init(directory: String) {
        let directory = URL(fileURLWithPath: directory, isDirectory: true)
        path = directory.appendingPathComponent("settings.json")
        backupPath = directory.appendingPathComponent("settings.backup.json")
    }

    public func load() -> BondedSettings {
        if let value = read(path) { return value }
        if let value = read(backupPath) { try? save(value); return value }
        return BondedSettings()
    }

    public func save(_ value: BondedSettings) throws {
        var validated = value; validated.version = 3
        let directory = path.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let temporary = directory.appendingPathComponent(".settings.\(getpid()).tmp")
        try JSONEncoder().encode(validated).write(to: temporary, options: .atomic)
        chmod(temporary.path, 0o600)
        if FileManager.default.fileExists(atPath: path.path) { try? FileManager.default.removeItem(at: backupPath); try FileManager.default.copyItem(at: path, to: backupPath); chmod(backupPath.path, 0o600) }
        try? FileManager.default.removeItem(at: path); try FileManager.default.moveItem(at: temporary, to: path); chmod(path.path, 0o600)
    }

    private func read(_ path: URL) -> BondedSettings? { guard let data = try? Data(contentsOf: path), let value = try? JSONDecoder().decode(BondedSettings.self, from: data), value.version == 3 else { return nil }; return value }
}
