import Foundation

public struct AmoveSettings: Codable, Equatable, Sendable {
    public var schemaVersion = 1
    public var presenceMode = "background"
    public var shortcutsByPlatform: [String: [String: AmoveShortcutBinding]] = [:]
    public var migrations: [String: String] = ["macUserDefaultsV1": "pending"]

    public static func darwinDefaults() -> AmoveSettings {
        var settings = AmoveSettings()
        settings.shortcutsByPlatform["darwin"] = AmoveShortcutDefaults.bindings()
        return settings
    }
}

public final class AmoveSettingsStore {
    public let path: URL
    public init(dataDirectory: String) { path = URL(fileURLWithPath: dataDirectory, isDirectory: true).appendingPathComponent("settings.json") }
    public func load() -> AmoveSettings {
        guard let data = try? Data(contentsOf: path), let value = try? JSONDecoder().decode(AmoveSettings.self, from: data) else { return AmoveSettings() }
        return value
    }
    public func save(_ value: AmoveSettings) throws {
        let directory = path.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let temporary = directory.appendingPathComponent(".settings.\(getpid()).tmp")
        try JSONEncoder().encode(value).write(to: temporary, options: .atomic)
        chmod(temporary.path, 0o600)
        try FileManager.default.removeItem(at: path)
        try FileManager.default.moveItem(at: temporary, to: path)
        chmod(path.path, 0o600)
    }
}
