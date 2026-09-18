import Foundation

public final class ShoutSettingsStore {
    public let path: URL
    public init(dataDirectory: String) { path = URL(fileURLWithPath: dataDirectory, isDirectory: true).appendingPathComponent("settings.json") }
    public func ensureDirectory() throws { try FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
}
