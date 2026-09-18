import CryptoKit
import Darwin
import Foundation

public let moirasiaProtocolVersion = 1
public let moirasiaMaximumMessageBytes = 1024 * 1024

/// Unix-socket endpoint for the host control server. A userData path plus
/// `runtime/host.sock` can exceed the ~104-byte `sockaddr_un.sun_path` limit
/// on macOS, which made the host fail to publish its endpoint at all
/// ("Socket path is too long"). The endpoint therefore lives in the per-user
/// temp directory keyed by a SHA-256 hash of the userData path, mirrored
/// exactly by `moirasiaHostSocketPath` in src/main/paths.ts.
public func moirasiaHostSocketPath(userData: String) -> String {
    let digest = SHA256.hash(data: Data(userData.utf8))
    let name = digest.prefix(8).map { String(format: "%02x", $0) }.joined()
    var base = ProcessInfo.processInfo.environment["TMPDIR"] ?? String(cString: hostDarwinUserTempDir())
    while base.hasSuffix("/") { base.removeLast() }
    return "\(base)/moirasia-host-\(name).sock"
}

private func hostDarwinUserTempDir() -> [CChar] {
    let length = confstr(_CS_DARWIN_USER_TEMP_DIR, nil, 0)
    var buffer = [CChar](repeating: 0, count: length)
    _ = confstr(_CS_DARWIN_USER_TEMP_DIR, &buffer, length)
    return buffer
}

public enum JSONValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int64.self) {
            self = .number(Double(value))
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.typeMismatch(JSONValue.self, .init(codingPath: decoder.codingPath, debugDescription: "Unsupported JSON value"))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    public subscript(key: String) -> JSONValue? {
        guard case .object(let object) = self else { return nil }
        return object[key]
    }

    public var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }

    public var boolValue: Bool? {
        guard case .bool(let value) = self else { return nil }
        return value
    }

    public var intValue: Int? {
        guard case .number(let value) = self, value.rounded() == value else { return nil }
        return Int(value)
    }

    public var numberValue: Double? {
        guard case .number(let value) = self else { return nil }
        return value
    }

    public var objectValue: [String: JSONValue]? {
        guard case .object(let value) = self else { return nil }
        return value
    }

    public var arrayValue: [JSONValue]? {
        guard case .array(let value) = self else { return nil }
        return value
    }
}

public struct HostRequest: Codable, Equatable, Sendable {
    public let version: Int
    public let id: String
    public let method: String
    public let params: [String: JSONValue]

    public init(id: String, method: String, params: [String: JSONValue] = [:], version: Int = moirasiaProtocolVersion) {
        self.version = version
        self.id = id
        self.method = method
        self.params = params
    }
}

public struct HostError: Codable, Equatable, Sendable, Error {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}

public struct HostResponse: Codable, Equatable, Sendable {
    public let version: Int
    public let id: String
    public let ok: Bool
    public let result: JSONValue?
    public let error: HostError?

    public init(id: String, result: JSONValue, version: Int = moirasiaProtocolVersion) {
        self.version = version
        self.id = id
        self.ok = true
        self.result = result
        self.error = nil
    }

    public init(id: String, error: HostError, version: Int = moirasiaProtocolVersion) {
        self.version = version
        self.id = id
        self.ok = false
        self.result = nil
        self.error = error
    }
}

public struct HostEvent: Codable, Equatable, Sendable {
    public let version: Int
    public let event: String
    public let revision: UInt64
    public let payload: JSONValue

    public init(event: String, revision: UInt64, payload: JSONValue, version: Int = moirasiaProtocolVersion) {
        self.version = version
        self.event = event
        self.revision = revision
        self.payload = payload
    }
}

public enum ProtocolError: Error, Equatable, CustomStringConvertible {
    case unsupportedVersion(Int)
    case malformedJSON
    case oversizedMessage
    case invalidEnvelope
    case duplicateRequest(String)
    case unauthenticated

    public var description: String {
        switch self {
        case .unsupportedVersion(let version): return "Unsupported native protocol version \(version)."
        case .malformedJSON: return "Malformed native protocol JSON."
        case .oversizedMessage: return "Native protocol message exceeds the 1 MiB limit."
        case .invalidEnvelope: return "Invalid native protocol envelope."
        case .duplicateRequest(let id): return "Duplicate native host request ID \(id)."
        case .unauthenticated: return "Native host client is not authenticated."
        }
    }
}

public enum HostMessage: Codable, Equatable, Sendable {
    case request(HostRequest)
    case response(HostResponse)
    case event(HostEvent)

    public init(data: Data) throws {
        guard data.count <= moirasiaMaximumMessageBytes else { throw ProtocolError.oversizedMessage }
        let decoder = JSONDecoder()
        let object = try decoder.decode([String: JSONValue].self, from: data)
        guard let version = object["version"]?.intValue else { throw ProtocolError.invalidEnvelope }
        guard version == moirasiaProtocolVersion else { throw ProtocolError.unsupportedVersion(version) }
        if object["method"] != nil {
            guard Set(object.keys).isSubset(of: ["version", "id", "method", "params"]), object["id"]?.stringValue != nil, object["method"]?.stringValue != nil, case .object = object["params"] else { throw ProtocolError.invalidEnvelope }
            self = .request(try decoder.decode(HostRequest.self, from: data))
        } else if object["event"] != nil {
            guard Set(object.keys).isSubset(of: ["version", "event", "revision", "payload"]), object["event"]?.stringValue != nil, object["revision"]?.intValue != nil, object["payload"] != nil else { throw ProtocolError.invalidEnvelope }
            self = .event(try decoder.decode(HostEvent.self, from: data))
        } else if object["ok"] != nil {
            guard Set(object.keys).isSubset(of: ["version", "id", "ok", "result", "error"]), object["id"]?.stringValue != nil, object["ok"]?.boolValue != nil else { throw ProtocolError.invalidEnvelope }
            if object["ok"]?.boolValue == true {
                guard object["result"] != nil, object["error"] == nil else { throw ProtocolError.invalidEnvelope }
            } else {
                guard object["error"] != nil, object["result"] == nil else { throw ProtocolError.invalidEnvelope }
            }
            self = .response(try decoder.decode(HostResponse.self, from: data))
        } else {
            throw ProtocolError.invalidEnvelope
        }
    }

    public func encodedLine() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = []
        let data: Data
        switch self {
        case .request(let value): data = try encoder.encode(value)
        case .response(let value): data = try encoder.encode(value)
        case .event(let value): data = try encoder.encode(value)
        }
        guard data.count <= moirasiaMaximumMessageBytes else { throw ProtocolError.oversizedMessage }
        return data + Data([0x0a])
    }
}

public final class LineDecoder: @unchecked Sendable {
    private var buffer = Data()

    public init() {}

    public func append(_ data: Data) throws -> [HostMessage] {
        buffer.append(data)
        guard buffer.count <= moirasiaMaximumMessageBytes * 2 else { throw ProtocolError.oversizedMessage }
        var messages: [HostMessage] = []
        while let newline = buffer.firstIndex(of: 0x0a) {
            let line = buffer.prefix(upTo: newline)
            buffer.removeSubrange(...newline)
            if line.isEmpty { continue }
            messages.append(try HostMessage(data: Data(line)))
        }
        return messages
    }
}

public final class FramedWriter: @unchecked Sendable {
    private let lock = NSLock()
    private let handle: FileHandle

    public init(handle: FileHandle) { self.handle = handle }

    public func send(_ message: HostMessage) throws {
        let data = try message.encodedLine()
        lock.lock()
        defer { lock.unlock() }
        try SafeIO.write(descriptor: handle.fileDescriptor, data)
    }
}

/// POSIX file I/O for event-driven IPC. Foundation's FileHandle read/write
/// APIs raise uncatchable Objective-C exceptions at EOF or on a broken pipe
/// (observed on macOS 26), which aborts the whole runtime; every socket and
/// pipe in the runtime therefore goes through these POSIX wrappers, where EOF
/// is a return value and write failures are catchable Swift errors.
public enum SafeIO {
    public enum ReadOutcome {
        case data(Data)
        case endOfStream
        /// Nothing readable right now (EAGAIN/EINTR): keep the handler armed.
        case drained
    }

    public static func makeNonBlocking(_ descriptor: Int32) {
        let flags = fcntl(descriptor, F_GETFL)
        guard flags >= 0 else { return }
        _ = fcntl(descriptor, F_SETFL, flags | O_NONBLOCK)
    }

    /// One POSIX read with EINTR retry; `capacity` caps a single chunk.
    public static func read(descriptor: Int32, capacity: Int = 65_536) -> ReadOutcome {
        var buffer = [UInt8](repeating: 0, count: capacity)
        var count = Darwin.read(descriptor, &buffer, capacity)
        while count < 0 && errno == EINTR { count = Darwin.read(descriptor, &buffer, capacity) }
        if count > 0 { return .data(Data(buffer.prefix(count))) }
        if count == 0 { return .endOfStream }
        if errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR { return .drained }
        return .endOfStream
    }

    /// Consumes everything currently readable so an edge-triggered
    /// readability handler cannot miss bytes. Returns nil when only EAGAIN
    /// occurred (no data to process, keep waiting); `ended` marks EOF or a
    /// permanent error so callers can close the endpoint cleanly.
    public static func drain(descriptor: Int32, capacity: Int = 65_536) -> (data: Data, ended: Bool)? {
        var accumulated = Data()
        while true {
            switch read(descriptor: descriptor, capacity: capacity) {
            case .data(let chunk): accumulated.append(chunk)
            case .endOfStream: return (accumulated, true)
            case .drained:
                return accumulated.isEmpty ? nil : (accumulated, false)
            }
        }
    }

    /// Blocking read of everything up to EOF. Only for descriptors whose
    /// writer has exited (post-exit stderr capture); blocks until then.
    public static func readToEnd(descriptor: Int32, capacity: Int = 65_536) -> Data {
        var accumulated = Data()
        while true {
            var buffer = [UInt8](repeating: 0, count: capacity)
            var count = Darwin.read(descriptor, &buffer, capacity)
            while count < 0 && errno == EINTR { count = Darwin.read(descriptor, &buffer, capacity) }
            if count > 0 { accumulated.append(contentsOf: buffer[0..<count]) }
            else if count == 0 || errno != EAGAIN { return accumulated }
        }
    }

    /// POSIX write that treats EOF-adjacent failures as catchable Swift
    /// errors instead of raising; waits for writability on EAGAIN.
    public static func write(descriptor: Int32, _ data: Data) throws {
        var offset = 0
        while offset < data.count {
            let written = data.withUnsafeBytes { raw -> Int in
                guard let base = raw.baseAddress else { return -1 }
                return Darwin.write(descriptor, base.advanced(by: offset), data.count - offset)
            }
            if written > 0 { offset += written; continue }
            if written == 0 { throw NSError(domain: NSPOSIXErrorDomain, code: Int(EIO)) }
            let code = errno
            if code == EINTR { continue }
            if code == EAGAIN || code == EWOULDBLOCK {
                var pending = pollfd(fd: descriptor, events: Int16(POLLOUT), revents: 0)
                _ = poll(&pending, 1, 1_000)
                continue
            }
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(code))
        }
    }
}

public func jsonObject(_ values: [(String, JSONValue)]) -> JSONValue {
    .object(Dictionary(uniqueKeysWithValues: values))
}
