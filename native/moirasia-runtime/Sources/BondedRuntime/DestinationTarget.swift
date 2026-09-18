import Darwin
import Foundation

public struct DestinationTarget: Codable, Equatable, Hashable, Sendable {
    public let canonical: String
    public let family: Int
    public let prefixLength: Int
    public let bytes: [UInt8]

    public init(_ input: String) throws {
        let pieces = input.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "/", omittingEmptySubsequences: false)
        guard pieces.count == 1 || pieces.count == 2, let address = pieces.first, !address.isEmpty else { throw DestinationTargetError.invalid(input) }
        var v4 = in_addr(); var v6 = in6_addr()
        if String(address).withCString({ inet_pton(AF_INET, $0, &v4) == 1 }) {
            let bytes = withUnsafeBytes(of: &v4) { Array($0) }
            let prefix = try Self.prefix(pieces.last, maximum: 32, input: input)
            let masked = Self.mask(bytes, prefix: prefix)
            canonical = "\(masked.map(String.init).joined(separator: "."))\(prefix == 32 ? "" : "/\(prefix)")"
            family = 4; prefixLength = prefix; self.bytes = masked; return
        }
        if String(address).withCString({ inet_pton(AF_INET6, $0, &v6) == 1 }) {
            let bytes = withUnsafeBytes(of: &v6) { Array($0) }
            let prefix = try Self.prefix(pieces.last, maximum: 128, input: input)
            let masked = Self.mask(bytes, prefix: prefix)
            canonical = "\(Self.format6(masked))\(prefix == 128 ? "" : "/\(prefix)")"
            family = 6; prefixLength = prefix; self.bytes = masked; return
        }
        throw DestinationTargetError.invalid(input)
    }

    public func contains(_ candidate: DestinationTarget) -> Bool {
        guard family == candidate.family else { return false }
        return Self.mask(candidate.bytes, prefix: prefixLength) == bytes
    }

    private static func prefix(_ value: Substring?, maximum: Int, input: String) throws -> Int {
        guard let value else { return maximum }
        guard let prefix = Int(value), (0...maximum).contains(prefix) else { throw DestinationTargetError.prefix(input) }
        return prefix
    }

    private static func mask(_ bytes: [UInt8], prefix: Int) -> [UInt8] {
        var output = bytes
        for index in output.indices {
            let remaining = prefix - index * 8
            if remaining <= 0 { output[index] = 0 }
            else if remaining < 8 { output[index] &= UInt8(0xff << (8 - remaining)) }
        }
        return output
    }

    private static func format6(_ bytes: [UInt8]) -> String {
        let groups = (0..<8).map { index in UInt16(bytes[index * 2]) << 8 | UInt16(bytes[index * 2 + 1]) }
        var bestStart = -1; var bestLength = 0; var index = 0
        while index < groups.count {
            if groups[index] != 0 { index += 1; continue }
            var end = index; while end < groups.count && groups[end] == 0 { end += 1 }
            if end - index > bestLength { bestStart = index; bestLength = end - index }
            index = end
        }
        guard bestLength >= 2 else { return groups.map { String($0, radix: 16) }.joined(separator: ":") }
        let left = groups[..<bestStart].map { String($0, radix: 16) }.joined(separator: ":")
        let right = groups[(bestStart + bestLength)...].map { String($0, radix: 16) }.joined(separator: ":")
        return "\(left)::\(right)"
    }
}

public enum DestinationTargetError: Error, LocalizedError, Equatable {
    case invalid(String)
    case prefix(String)
    public var errorDescription: String? { switch self { case .invalid(let value): return "Invalid destination target: \(value)"; case .prefix(let value): return "Invalid CIDR prefix: \(value)" } }
}
