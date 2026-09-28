import CryptoKit
import Foundation

public func bondedOpaqueId(prefix: String, value: String) -> String {
    let digest = SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    return "\(prefix)_\(digest.prefix(16))"
}
