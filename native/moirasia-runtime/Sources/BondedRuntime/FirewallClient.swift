import Foundation
import MoirasiaProtocol

/// Client for the privileged Bonded firewall helper: NDJSON over a per-UID unix
/// socket at /var/run/com.opense.Bonded.firewall.<uid>.sock. Mirrors the
/// TypeScript FirewallClient wire protocol ({id, version: 1, operation, ...}).
public struct BondedFirewallStatus: Equatable, Sendable {
    public var state: String
    public var message: String
    public var helperInstalled: Bool
    public var ruleCount: Int?
}

public func bondedFirewallMessage(_ state: String) -> String {
    switch state {
    case "not-installed": return "Install the local helper to enable observed-IP blocking."
    case "disabled": return "Blocking is off."
    case "active": return "Blocking new connections to learned destinations globally."
    case "error": return "The firewall state could not be verified; learned destinations may still be blocked."
    default: return "Blocking is off."
    }
}

public final class FirewallClient: @unchecked Sendable {
    public static let label = "com.opense.Bonded.firewall"
    public static let installedExecutable = "/Library/PrivilegedHelperTools/\(label)"

    private var socketFD: Int32 = -1
    private var buffer = ""
    private var nextId = 1
    private let lock = NSLock()
    private let statusLock = NSLock()
    private var currentStatus = BondedFirewallStatus(state: "not-installed", message: bondedFirewallMessage("not-installed"), helperInstalled: false, ruleCount: nil)
    private let helperExecutable: String
    public var onStatus: ((BondedFirewallStatus) -> Void)?

    public init(helperExecutable: String) { self.helperExecutable = helperExecutable }

    public var status: BondedFirewallStatus {
        statusLock.lock(); defer { statusLock.unlock() }
        return currentStatus
    }

    public func initialize() {
        do {
            try connect()
            let response = try request(operation: "status")
            guard response.ok else { throw BondedFirewallError.rejected(response.error ?? "The firewall helper rejected the request") }
            setStatus(response.enabled ?? false ? "active" : "disabled", installed: true, ruleCount: response.ruleCount)
        } catch {
            let installed = isInstalled()
            setStatus(installed ? "error" : "not-installed", installed: installed, ruleCount: nil)
        }
    }

    public func install() throws {
        let source = try helperSource()
        try runElevated(executable: source, operation: "--install")
        close()
        var lastError: Error?
        for _ in 0..<30 {
            Thread.sleep(forTimeInterval: 0.1)
            do {
                try connect()
                let response = try request(operation: "status")
                guard response.ok else { throw BondedFirewallError.rejected(response.error ?? "The firewall helper rejected the request") }
                setStatus(response.enabled ?? false ? "active" : "disabled", installed: true, ruleCount: response.ruleCount)
                return
            } catch { lastError = error }
        }
        setStatus("error", installed: true, ruleCount: nil)
        throw lastError ?? BondedFirewallError.helperDidNotStart
    }

    public func uninstall() throws {
        try? configure(enabled: false, targets: [])
        close()
        try runElevated(executable: isInstalled() ? Self.installedExecutable : try helperSource(), operation: "--uninstall")
        setStatus("not-installed", installed: false, ruleCount: nil)
    }

    public func configure(enabled: Bool, targets: [String]) throws {
        if enabled && targets.isEmpty { throw BondedFirewallError.noDestinations }
        if targets.count > BondedBlockerLimits.destinationRules { throw BondedFirewallError.tooManyDestinations }
        if socketFD == -1 { try connect() }
        let response = try request(operation: "configure", enabled: enabled, targets: targets)
        if !response.ok {
            setStatus("error", installed: true, ruleCount: response.ruleCount)
            throw BondedFirewallError.rejected(response.error ?? "The firewall helper rejected the request")
        }
        setStatus(response.enabled ?? false ? "active" : "disabled", installed: true, ruleCount: response.ruleCount)
    }

    public func disconnect() throws {
        var cleanupError: Error?
        if socketFD != -1 { do { try configure(enabled: false, targets: []) } catch { cleanupError = error } }
        close()
        if isInstalled() { setStatus(cleanupError == nil ? "disabled" : "error", installed: true, ruleCount: cleanupError == nil ? 0 : nil) }
        if let cleanupError { throw cleanupError }
    }

    // MARK: Socket plumbing

    private func connect() throws {
        if socketFD != -1 { return }
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw BondedFirewallError.unavailable("The firewall helper is available only on macOS") }
        let path = Self.socketPath()
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(path.utf8)
        guard pathBytes.count < MemoryLayout.size(ofValue: address.sun_path) else { Darwin.close(fd); throw BondedFirewallError.unavailable("The firewall socket path is too long") }
        withUnsafeMutableBytes(of: &address.sun_path) { destination in
            destination.copyBytes(from: pathBytes)
        }
        let result = withUnsafePointer(to: &address) { pointer -> Int32 in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                Darwin.connect(fd, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard result == 0 else { Darwin.close(fd); throw BondedFirewallError.unavailable("The firewall helper is not running") }
        // Keep recv() interruptible so the response deadline is honored.
        var timeout = timeval(tv_sec: 1, tv_usec: 0)
        _ = setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        lock.lock(); socketFD = fd; buffer = ""; lock.unlock()
    }

    static func socketPath() -> String { "/var/run/\(label).\(getuid()).sock" }

    private func request(operation: String, enabled: Bool? = nil, targets: [String]? = nil) throws -> HelperResponse {
        lock.lock()
        let fd = socketFD
        guard fd != -1 else { lock.unlock(); throw BondedFirewallError.notConnected }
        let id = nextId
        nextId += 1
        var object: [String: Any] = ["id": id, "version": 1, "operation": operation]
        if let enabled { object["enabled"] = enabled }
        if let targets { object["targets"] = targets }
        lock.unlock()
        guard let payload = try? JSONSerialization.data(withJSONObject: object) else { throw BondedFirewallError.encode }
        var line = payload
        line.append(0x0A)
        let sent = line.withUnsafeBytes { raw -> Int in
            write(fd, raw.baseAddress, raw.count)
        }
        guard sent == line.count else { close(); throw BondedFirewallError.notConnected }
        let response = try waitForResponse(id: id, fd: fd)
        return response
    }

    private func waitForResponse(id: Int, fd: Int32) throws -> HelperResponse {
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            lock.lock()
            let pending = buffer
            lock.unlock()
            if let line = Self.extractResponse(id: id, buffer: pending) {
                lock.lock()
                buffer = line.remainder
                lock.unlock()
                if let response = line.response { return response }
                throw BondedFirewallError.rejected("The firewall helper returned an unreadable response")
            }
            var chunk = [UInt8](repeating: 0, count: 65_536)
            let received = recv(fd, &chunk, chunk.count, 0)
            if received <= 0 {
                if errno == EAGAIN || errno == EWOULDBLOCK { continue }
                close()
                throw BondedFirewallError.notConnected
            }
            lock.lock(); buffer += String(decoding: chunk[..<received], as: UTF8.self); lock.unlock()
        }
        close()
        throw BondedFirewallError.timeout
    }

    private static func extractResponse(id: Int, buffer: String) -> (response: HelperResponse?, remainder: String)? {
        guard let range = buffer.range(of: "\n") else { return nil }
        let line = String(buffer[..<range.lowerBound])
        let remainder = String(buffer[range.upperBound...])
        guard let data = line.data(using: .utf8), let response = try? JSONDecoder().decode(HelperResponse.self, from: data), response.id == id else {
            return (nil, remainder)
        }
        return (response, remainder)
    }

    private func close() {
        lock.lock()
        if socketFD != -1 { Darwin.close(socketFD); socketFD = -1 }
        buffer = ""
        lock.unlock()
    }

    struct HelperResponse: Decodable { let id: Int; let ok: Bool; let enabled: Bool?; let ruleCount: Int?; let error: String? }

    private func helperSource() throws -> String {
        guard FileManager.default.fileExists(atPath: helperExecutable) else { throw BondedFirewallError.helperMissing }
        return helperExecutable
    }

    public func isInstalled() -> Bool { FileManager.default.fileExists(atPath: Self.installedExecutable) }

    private func runElevated(executable: String, operation: String) throws {
        func shellQuote(_ value: String) -> String { "'" + value.replacingOccurrences(of: "'", with: "'\"'\"'") + "'" }
        func appleScriptString(_ value: String) -> String { "\"" + value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\"" }
        let command = "\(shellQuote(executable)) \(operation) \(getuid())"
        let script = "do shell script \(appleScriptString(command)) with administrator privileges"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        let errorPipe = Pipe()
        process.standardError = errorPipe
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let message = String(decoding: SafeIO.readToEnd(descriptor: errorPipe.fileHandleForReading.fileDescriptor), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            throw BondedFirewallError.elevationFailed(message.isEmpty ? "The firewall helper install was cancelled." : message)
        }
    }

    private func setStatus(_ state: String, installed: Bool, ruleCount: Int?) {
        statusLock.lock()
        currentStatus = BondedFirewallStatus(state: state, message: bondedFirewallMessage(state), helperInstalled: installed, ruleCount: ruleCount)
        let snapshot = currentStatus
        statusLock.unlock()
        onStatus?(snapshot)
    }
}

public enum BondedFirewallError: Error, LocalizedError {
    case noDestinations
    case tooManyDestinations
    case notConnected
    case timeout
    case encode
    case helperDidNotStart
    case helperMissing
    case rejected(String)
    case unavailable(String)
    case elevationFailed(String)

    public var errorDescription: String? {
        switch self {
        case .noDestinations: return "Observe at least one destination before enabling Blocking."
        case .tooManyDestinations: return "At most \(BondedBlockerLimits.destinationRules) destination rules are supported."
        case .notConnected: return "The firewall helper is not connected"
        case .timeout: return "The firewall helper did not respond"
        case .encode: return "The firewall helper request could not be encoded"
        case .helperDidNotStart: return "The firewall helper did not start"
        case .helperMissing: return "Build the native firewall helper before installing it"
        case .rejected(let message): return message
        case .unavailable(let message): return message
        case .elevationFailed(let message): return message
        }
    }
}