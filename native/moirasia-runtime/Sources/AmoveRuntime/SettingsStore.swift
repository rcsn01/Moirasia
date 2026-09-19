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

    public init() {}

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        presenceMode = try container.decodeIfPresent(String.self, forKey: .presenceMode) ?? "background"
        shortcutsByPlatform = try container.decodeIfPresent([String: [String: AmoveShortcutBinding]].self, forKey: .shortcutsByPlatform) ?? [:]
        migrations = try container.decodeIfPresent([String: String].self, forKey: .migrations) ?? ["macUserDefaultsV1": "pending"]
        guard schemaVersion == 1, ["background", "taskbar"].contains(presenceMode) else {
            throw DecodingError.dataCorruptedError(forKey: .schemaVersion, in: container, debugDescription: "Unsupported Amove settings.")
        }
    }
}

public final class AmoveSettingsStore {
    public let path: URL
    public let backupPath: URL
    private let legacyDirectories: [URL]
    public private(set) var warning: String?

    public init(dataDirectory: String, legacyDataDirectories: [String] = []) {
        path = URL(fileURLWithPath: dataDirectory, isDirectory: true).appendingPathComponent("settings.json")
        backupPath = URL(fileURLWithPath: dataDirectory, isDirectory: true).appendingPathComponent("settings.backup.json")
        legacyDirectories = legacyDataDirectories.map { URL(fileURLWithPath: $0, isDirectory: true) }
    }

    public func load() -> AmoveSettings {
        warning = nil
        if let value = read(path) {
            let normalized = withDefaults(value)
            if normalized.migrations["macUserDefaultsV1"] == "pending" { return migrate(normalized) }
            return normalized
        }
        if let value = read(backupPath) {
            warning = "Settings were recovered from the last known good copy."
            let normalized = withDefaults(value)
            if normalized.migrations["macUserDefaultsV1"] == "pending" { return migrate(normalized) }
            try? save(normalized, backupExisting: false)
            return normalized
        }
        for directory in legacyDirectories {
            for name in ["settings.json", "settings.backup.json"] {
                if let value = read(directory.appendingPathComponent(name)) {
                    warning = "Standalone Amove settings were copied into Moirasia. Future changes stay separate in each app."
                    let imported = withDefaults(value)
                    try? save(imported, backupExisting: false)
                    return imported.migrations["macUserDefaultsV1"] == "pending" ? migrate(imported) : imported
                }
            }
        }
        return migrate(AmoveSettings.darwinDefaults())
    }

    public func save(_ value: AmoveSettings) throws { try save(withDefaults(value), backupExisting: true) }

    private func migrate(_ current: AmoveSettings) -> AmoveSettings {
        let result = AmoveLegacyMigration.migrateMacUserDefaults(AmoveLegacyMigration.readLegacyPreferences())
        let merged = merge(current: current, migrated: result.settings)
        if !result.warnings.isEmpty { warning = result.warnings.joined(separator: " ") }
        try? save(merged, backupExisting: true)
        return merged
    }

    private func merge(current: AmoveSettings, migrated: AmoveSettings) -> AmoveSettings {
        let defaults = AmoveSettings.darwinDefaults()
        var result = current
        if result.presenceMode == defaults.presenceMode { result.presenceMode = migrated.presenceMode }
        var bindings = result.shortcutsByPlatform["darwin"] ?? defaults.shortcutsByPlatform["darwin"] ?? [:]
        let migratedBindings = migrated.shortcutsByPlatform["darwin"] ?? [:]
        for action in AmoveShortcutDefaults.bindings().keys {
            if bindings[action] == defaults.shortcutsByPlatform["darwin"]?[action], let binding = migratedBindings[action] { bindings[action] = binding }
        }
        result.shortcutsByPlatform["darwin"] = bindings
        result.migrations = migrated.migrations
        return result
    }

    private func withDefaults(_ value: AmoveSettings) -> AmoveSettings {
        var result = value
        let defaults = AmoveSettings.darwinDefaults()
        result.schemaVersion = 1
        result.shortcutsByPlatform["darwin"] = (defaults.shortcutsByPlatform["darwin"] ?? [:]).merging(result.shortcutsByPlatform["darwin"] ?? [:]) { _, current in current }
        if result.migrations["macUserDefaultsV1"] == nil { result.migrations["macUserDefaultsV1"] = "completed" }
        return result
    }

    private func save(_ value: AmoveSettings, backupExisting: Bool) throws {
        let directory = path.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let temporary = directory.appendingPathComponent(".settings.\(getpid()).\(UUID().uuidString).tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        try JSONEncoder().encode(value).write(to: temporary, options: .atomic)
        chmod(temporary.path, 0o600)
        if backupExisting, FileManager.default.fileExists(atPath: path.path) {
            try? FileManager.default.removeItem(at: backupPath)
            try FileManager.default.copyItem(at: path, to: backupPath)
            chmod(backupPath.path, 0o600)
        }
        try? FileManager.default.removeItem(at: path)
        try FileManager.default.moveItem(at: temporary, to: path)
        chmod(path.path, 0o600)
    }

    private func read(_ url: URL) -> AmoveSettings? {
        guard let data = try? Data(contentsOf: url), let value = try? JSONDecoder().decode(AmoveSettings.self, from: data) else { return nil }
        return value
    }
}
