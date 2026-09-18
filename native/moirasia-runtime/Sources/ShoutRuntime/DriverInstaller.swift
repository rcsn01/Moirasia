import Foundation
import MoirasiaProtocol

/// Driver status shape (mirrors Shout shared contracts DriverStatus).
public struct ShoutDriverStatus: Codable, Equatable, Sendable {
    public var state: String
    public var message: String
    public var sourcePath: String?
}

public enum ShoutDriverLimits {
    public static let bundleName = "ShoutMic.driver"
    public static let halInstallPath = "/Library/Audio/Plug-Ins/HAL/ShoutMic.driver"
    public static let version = "1.0.0"
}

/// Installs the ShoutMic HAL driver into /Library/Audio/Plug-Ins/HAL via an
/// administrator-privileged shell script, then restarts coreaudiod.
public final class DriverInstaller {
    private let sourceDirectory: String

    public init(sourceDirectory: String) { self.sourceDirectory = sourceDirectory }

    public func status() -> ShoutDriverStatus {
        let installPath = ShoutDriverLimits.halInstallPath
        guard FileManager.default.fileExists(atPath: installPath) else {
            var value = ShoutDriverStatus(state: "not-installed", message: Self.message("not-installed"), sourcePath: nil)
            if let source = source() { value.sourcePath = source }
            return value
        }
        let installedVersion = Self.installedVersion(at: installPath)
        if installedVersion != ShoutDriverLimits.version {
            var value = ShoutDriverStatus(state: "stale", message: Self.message("stale"), sourcePath: nil)
            if let source = source() { value.sourcePath = source }
            return value
        }
        return ShoutDriverStatus(state: "installed", message: Self.message("installed"), sourcePath: source())
    }

    public func install() throws {
        func shellQuote(_ value: String) -> String { "'" + value.replacingOccurrences(of: "'", with: "'\"'\"'") + "'" }
        func appleScriptString(_ value: String) -> String { "\"" + value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\"" }
        let installPath = ShoutDriverLimits.halInstallPath
        let command = "mkdir -p '/Library/Audio/Plug-Ins/HAL' && rm -rf \(shellQuote(installPath)) && cp -R \(shellQuote(sourceDirectory)) \(shellQuote(installPath)) && killall coreaudiod || true"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", "do shell script \(appleScriptString(command)) with administrator privileges"]
        let errorPipe = Pipe()
        process.standardError = errorPipe
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let text = String(decoding: SafeIO.readToEnd(descriptor: errorPipe.fileHandleForReading.fileDescriptor), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            throw ShoutRuntimeError.engine(text.isEmpty ? "The Shout Mic driver install was cancelled." : text)
        }
        if Self.installedVersion(at: installPath) != ShoutDriverLimits.version {
            throw ShoutRuntimeError.engine("The Shout Mic driver was installed but did not report the expected version")
        }
    }

    public func driverSourcePath() -> String { sourceDirectory }

    private func source() -> String? {
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: sourceDirectory, isDirectory: &isDirectory) ? sourceDirectory : nil
    }

    static func installedVersion(at installPath: String) -> String? {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: installPath).appendingPathComponent("Contents/Info.plist")), let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any], let value = plist["CFBundleVersion"] as? String else { return nil }
        return value
    }

    static func message(_ state: String) -> String {
        switch state {
        case "not-installed": return "Install the Shout Mic driver to make the boosted input available everywhere."
        case "installed": return "The Shout Mic driver is installed."
        case "stale": return "The installed Shout Mic driver is from another build; reinstall it to update."
        case "error": return "The installed Shout Mic driver could not be verified."
        default: return "The Shout Mic driver is not installed."
        }
    }
}