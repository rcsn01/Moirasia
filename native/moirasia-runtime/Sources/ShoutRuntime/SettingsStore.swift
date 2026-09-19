import Foundation
import MoirasiaProtocol

public struct ShoutControlSettings: Codable, Equatable, Sendable {
    public var version: Int = 1
    public var boostEnabled = false
    public var gainDb = 0.0
    public var limiterEnabled = true
    public var makeDefaultInput = false
    public var sourceMode = "follow-default"
    public var sourceUid: String?

    public init() {}

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 1
        guard version == 1 else { throw DecodingError.dataCorruptedError(forKey: .version, in: container, debugDescription: "Unsupported Shout settings version.") }
        boostEnabled = try container.decodeIfPresent(Bool.self, forKey: .boostEnabled) ?? false
        gainDb = try container.decodeIfPresent(Double.self, forKey: .gainDb) ?? 0
        limiterEnabled = try container.decodeIfPresent(Bool.self, forKey: .limiterEnabled) ?? true
        makeDefaultInput = try container.decodeIfPresent(Bool.self, forKey: .makeDefaultInput) ?? false
        sourceMode = try container.decodeIfPresent(String.self, forKey: .sourceMode) ?? "follow-default"
        sourceUid = try container.decodeIfPresent(String.self, forKey: .sourceUid)
        guard gainDb.isFinite, gainDb >= 0, gainDb <= 30, sourceMode == "follow-default" || sourceMode == "device" else {
            throw DecodingError.dataCorruptedError(forKey: .sourceMode, in: container, debugDescription: "Invalid Shout settings.")
        }
        if sourceMode == "device" && (sourceUid == nil || sourceUid?.isEmpty == true) {
            throw DecodingError.dataCorruptedError(forKey: .sourceUid, in: container, debugDescription: "A device source requires a UID.")
        }
        if sourceMode != "device" { sourceUid = nil }
    }
}

public final class ShoutSettingsStore {
    public let path: URL
    public let backupPath: URL

    public init(dataDirectory: String) {
        path = URL(fileURLWithPath: dataDirectory, isDirectory: true).appendingPathComponent("settings.json")
        backupPath = URL(fileURLWithPath: dataDirectory, isDirectory: true).appendingPathComponent("settings.backup.json")
    }

    public func load() -> ShoutControlSettings {
        if let value = read(path) { return value }
        if let value = read(backupPath) {
            try? save(value, backupExisting: false)
            return value
        }
        return ShoutControlSettings()
    }

    public func save(_ value: ShoutControlSettings) throws { try save(value, backupExisting: true) }

    private func save(_ value: ShoutControlSettings, backupExisting: Bool) throws {
        let directory = path.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let temporary = directory.appendingPathComponent(".settings.\(getpid()).\(UUID().uuidString).tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        let data = try JSONEncoder().encode(value) + Data([0x0a])
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

    private func read(_ url: URL) -> ShoutControlSettings? {
        guard let data = try? Data(contentsOf: url), let value = try? JSONDecoder().decode(ShoutControlSettings.self, from: data) else { return nil }
        return value
    }
}
