import Foundation
import MoirasiaProtocol

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
    public let versionOneBackupPath: URL
    public let versionTwoBackupPath: URL
    private let legacyDataDirectories: [URL]
    private var migratedLegacyRuleIdentifiers = false
    public private(set) var migratedFromVersionOne = false
    public private(set) var migratedFromVersionTwo = false
    public private(set) var importedFromLegacyData = false

    public init(directory: String, legacyDataDirectories: [String] = []) {
        let directoryURL = URL(fileURLWithPath: directory, isDirectory: true)
        path = directoryURL.appendingPathComponent("settings.json")
        backupPath = directoryURL.appendingPathComponent("settings.backup.json")
        versionOneBackupPath = directoryURL.appendingPathComponent("settings.v1.json")
        versionTwoBackupPath = directoryURL.appendingPathComponent("settings.v2.json")
        self.legacyDataDirectories = legacyDataDirectories.map { URL(fileURLWithPath: $0, isDirectory: true) }
    }

    public var migrationNotice: String? {
        if importedFromLegacyData { return "Standalone Bonded settings were copied into Moirasia. Future changes stay separate in each app." }
        if migratedFromVersionTwo { return "Previous destination rules were backed up and cleared because they cannot be converted safely into application selections." }
        if migratedFromVersionOne { return "Previous application references were backed up and cleared because they did not contain safe application identities." }
        return nil
    }

    public func load() -> BondedSettings {
        migratedLegacyRuleIdentifiers = false
        migratedFromVersionOne = false
        migratedFromVersionTwo = false
        importedFromLegacyData = false
        let primaryExists = FileManager.default.fileExists(atPath: path.path)
        let backupExists = FileManager.default.fileExists(atPath: backupPath.path)
        if let value = read(path), let settings = migrateOrParse(value, source: path) {
            if migratedLegacyRuleIdentifiers { try? save(settings) }
            return settings
        }
        if let value = read(backupPath), let settings = migrateOrParse(value, source: backupPath) {
            try? save(settings, backupExisting: false)
            return settings
        }
        guard !primaryExists && !backupExists else { return BondedSettings() }
        for directory in legacyDataDirectories {
            for name in ["settings.json", "settings.backup.json"] {
                let source = directory.appendingPathComponent(name)
                guard let value = read(source), let settings = migrateOrParse(value, source: source) else { continue }
                var imported = settings
                imported.blockingEnabled = false
                importedFromLegacyData = true
                try? save(imported, backupExisting: false)
                return imported
            }
        }
        return BondedSettings()
    }

    public func save(_ value: BondedSettings) throws { try save(normalized(value), backupExisting: true) }

    private func save(_ value: BondedSettings, backupExisting: Bool) throws {
        let directory = path.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let temporary = directory.appendingPathComponent(".settings.\(getpid()).\(UUID().uuidString).tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        let data = try JSONEncoder().encode(normalized(value)) + Data([0x0a])
        try data.write(to: temporary, options: .atomic)
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

    private func migrateOrParse(_ value: JSONValue, source: URL) -> BondedSettings? {
        guard case .object(let object) = value, let version = object["version"]?.intValue else { return nil }
        guard let monitoring = object["monitoringEnabled"]?.boolValue else { return nil }
        if version == 3 {
            guard let rules = parseRules(object["applicationRules"]) else { return nil }
            let blocking = (object["blockingEnabled"]?.boolValue ?? false) && !rules.isEmpty
            return BondedSettings(version: 3, monitoringEnabled: monitoring, blockingEnabled: blocking, applicationRules: rules)
        }
        guard version == 1 || version == 2 else { return nil }
        let migrated = BondedSettings(version: 3, monitoringEnabled: monitoring, blockingEnabled: false, applicationRules: [])
        do {
            let backup = version == 1 ? versionOneBackupPath : versionTwoBackupPath
            try? FileManager.default.removeItem(at: backup)
            try FileManager.default.copyItem(at: source, to: backup)
        } catch { /* Migration still clears unsafe rules if the backup cannot be copied. */ }
        if version == 1 { migratedFromVersionOne = true } else { migratedFromVersionTwo = true }
        try? save(migrated, backupExisting: false)
        return migrated
    }

    private func parseRules(_ value: JSONValue?) -> [BondedStoredRule]? {
        guard case .array(let values) = value else { return nil }
        var result: [BondedStoredRule] = []
        var ids = Set<String>()
        var identities = Set<String>()
        let formatter = ISO8601DateFormatter()
        for item in values {
            guard result.count < 256, case .object(let object) = item,
                  let rawId = object["id"]?.stringValue, validOpaqueId(rawId),
                  let path = object["path"]?.stringValue, !path.isEmpty, path.count <= 4096,
                  let displayName = object["displayName"]?.stringValue, !displayName.isEmpty, displayName.count <= 512,
                  let targetKind = object["targetKind"]?.stringValue, targetKind == "application" || targetKind == "executable",
                  let selectedAt = object["selectedAt"]?.stringValue, formatter.date(from: selectedAt) != nil else { continue }
            let bundle = object["bundleIdentifier"]?.stringValue
            if object["bundleIdentifier"] != nil && (bundle == nil || bundle!.isEmpty || bundle!.count > 512) { continue }
            let identity = bondedApplicationRuleIdentity(path: path, bundleIdentifier: bundle)
            let id = canonicalRuleIdentifier(rawId, identity: identity)
            guard !ids.contains(id), !identities.contains(identity) else { continue }
            result.append(BondedStoredRule(id: id, path: path, displayName: displayName, targetKind: targetKind, bundleIdentifier: bundle, selectedAt: selectedAt))
            ids.insert(id); identities.insert(identity)
        }
        return result
    }

    private func normalized(_ value: BondedSettings) -> BondedSettings {
        var result = value
        result.version = 3
        result.applicationRules = Array(value.applicationRules.prefix(256))
        result.blockingEnabled = value.blockingEnabled && !result.applicationRules.isEmpty
        return result
    }

    private func validOpaqueId(_ value: String) -> Bool {
        guard let prefix = ["app_", "rule_"].first(where: { value.hasPrefix($0) }), value.count == prefix.count + 16 else { return false }
        return value.dropFirst(prefix.count).allSatisfy { $0.isHexDigit }
    }

    private func canonicalRuleIdentifier(_ value: String, identity: String) -> String {
        guard value.hasPrefix("app_") else { return value }
        migratedLegacyRuleIdentifiers = true
        return bondedOpaqueId(prefix: "rule", value: identity)
    }

    private func read(_ url: URL) -> JSONValue? {
        guard let data = try? Data(contentsOf: url), let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return nil }
        return value
    }
}
