import Darwin
import Foundation

public enum BondedNetworkProtocol: String, Codable, Sendable { case tcp = "TCP"; case udp = "UDP"; case quic = "QUIC" }
public struct BondedNetworkSample: Equatable, Sendable {
    public let pid: Int
    public let processName: String
    public let proto: BondedNetworkProtocol
    public let localAddress: String
    public let localPort: Int
    public let remoteAddress: String
    public let remotePort: Int
}

public final class NettopCSVParser: @unchecked Sendable {
    private var headers: [String]?
    private var process: (pid: Int, name: String)?

    public init() {}

    public func parse(_ line: String) -> BondedNetworkSample? {
        guard let fields = Self.csv(line), !fields.isEmpty else { return nil }
        let normalized = fields.map { $0.lowercased() }
        if normalized.contains("pid") && normalized.contains("protocol") { headers = normalized; return nil }
        if let headers {
            func value(_ name: String) -> String { guard let index = headers.firstIndex(of: name), fields.indices.contains(index) else { return "" }; return fields[index].trimmingCharacters(in: .whitespaces) }
            guard let pid = Int(value("pid")), pid > 0, let proto = Self.protocol(value("protocol")), let local = Self.endpoint(value("local")), let remote = Self.endpoint(value("remote")), !value("state").lowercased().contains("listen"), !Self.loopback(remote.address) else { return nil }
            return BondedNetworkSample(pid: pid, processName: value("process").isEmpty ? "Process \(pid)" : value("process"), proto: proto, localAddress: local.address, localPort: local.port, remoteAddress: remote.address, remotePort: remote.port)
        }
        if let connection = fields.first(where: { $0.contains("<->") }) {
            guard let current = process, !fields.contains(where: { $0.localizedCaseInsensitiveContains("listen") }), let proto = fields.compactMap(Self.protocol).first else { return nil }
            let pieces = connection.components(separatedBy: "<->")
            guard pieces.count == 2, let local = Self.endpoint(pieces[0].replacingOccurrences(of: "^\\s*(tcp|udp|quic)\\d*\\s+", with: "", options: .regularExpression)), let remote = Self.endpoint(pieces[1]), !Self.loopback(remote.address) else { return nil }
            return BondedNetworkSample(pid: current.pid, processName: current.name, proto: proto, localAddress: local.address, localPort: local.port, remoteAddress: remote.address, remotePort: remote.port)
        }
        if let match = fields.reversed().compactMap({ Self.processField($0) }).first {
            process = match
        }
        return nil
    }

    private static func csv(_ line: String) -> [String]? {
        var result: [String] = [], field = "", quoted = false
        var index = line.startIndex
        while index < line.endIndex {
            let character = line[index]
            if character == "\"" {
                let next = line.index(after: index)
                if quoted && next < line.endIndex && line[next] == "\"" { field.append("\""); index = next }
                else { quoted.toggle() }
            } else if character == "," && !quoted { result.append(field.trimmingCharacters(in: .whitespaces)); field = "" }
            else { field.append(character) }
            index = line.index(after: index)
        }
        guard !quoted else { return nil }
        result.append(field.trimmingCharacters(in: .whitespaces)); return result
    }

    private static func processField(_ value: String) -> (pid: Int, name: String)? {
        let pieces = value.split(separator: ".", omittingEmptySubsequences: false)
        guard pieces.count >= 2, let pid = Int(pieces.last!), pid > 0 else { return nil }
        let name = pieces.dropLast().joined(separator: ".")
        guard !name.isEmpty, !name.contains(":"), name.range(of: "^\\d{1,2}:\\d{2}:\\d{2}$", options: .regularExpression) == nil else { return nil }
        return (pid, name)
    }

    private static func endpoint(_ raw: String) -> (address: String, port: Int)? {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value != "*", value != "*:*" else { return nil }
        if value.first == "(" && value.last == ")" { value.removeFirst(); value.removeLast() }
        let address: String, portValue: Substring
        if value.first == "[", let closing = value.firstIndex(of: "]") {
            address = String(value[value.index(after: value.startIndex)..<closing])
            let separator = value.index(after: closing)
            guard separator < value.endIndex else { return nil }
            portValue = value[value.index(after: separator)...]
        } else if let colon = value.lastIndex(of: ":") {
            address = String(value[..<colon]); portValue = value[value.index(after: colon)...]
        } else if let dot = value.lastIndex(of: ".") {
            address = String(value[..<dot]); portValue = value[value.index(after: dot)...]
        } else { return nil }
        let unscoped = address.replacingOccurrences(of: "%.*$", with: "", options: .regularExpression)
        guard let port = Int(portValue), (1...65535).contains(port), Self.isIP(unscoped), unscoped != "0.0.0.0", unscoped != "::" else { return nil }
        return (address, port)
    }

    private static func isIP(_ value: String) -> Bool {
        var v4 = in_addr(); var v6 = in6_addr()
        return value.withCString { inet_pton(AF_INET, $0, &v4) == 1 || inet_pton(AF_INET6, $0, &v6) == 1 }
    }

    private static func `protocol`(_ value: String) -> BondedNetworkProtocol? {
        let value = value.lowercased()
        if value.contains("quic") { return .quic }
        if value.contains("tcp") { return .tcp }
        if value.contains("udp") { return .udp }
        return nil
    }

    private static func loopback(_ value: String) -> Bool {
        let value = value.replacingOccurrences(of: "%.*$", with: "", options: .regularExpression).lowercased()
        return value == "::1" || value.hasPrefix("127.") || value.hasPrefix("::ffff:127.")
    }
}
