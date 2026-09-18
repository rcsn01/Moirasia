import Darwin
import Foundation

public final class DNSResolver {
    private let queue = DispatchQueue(label: "com.moirasia.bonded.dns", attributes: .concurrent)
    private var cache: [String: (host: String, expires: Date)] = [:]
    private let lock = NSLock()
    public var ttl: TimeInterval = 15 * 60

    public init() {}

    public func resolve(_ address: String, completion: @escaping (String) -> Void) {
        lock.lock()
        if let entry = cache[address], entry.expires > Date() { lock.unlock(); completion(entry.host); return }
        lock.unlock()
        queue.async { [weak self] in
            let host = self?.lookup(address) ?? address
            self?.lock.lock(); self?.cache[address] = (host, Date().addingTimeInterval(self?.ttl ?? 900)); self?.lock.unlock()
            completion(host)
        }
    }

    private func lookup(_ address: String) -> String {
        var storage = sockaddr_storage()
        var length: socklen_t
        if address.contains(":") {
            var value = in6_addr()
            guard address.withCString({ inet_pton(AF_INET6, $0, &value) == 1 }) else { return address }
            memcpy(&storage, &value, MemoryLayout<in6_addr>.size); storage.ss_family = sa_family_t(AF_INET6); length = socklen_t(MemoryLayout<sockaddr_in6>.size)
        } else {
            var value = in_addr()
            guard address.withCString({ inet_pton(AF_INET, $0, &value) == 1 }) else { return address }
            memcpy(&storage, &value, MemoryLayout<in_addr>.size); storage.ss_family = sa_family_t(AF_INET); length = socklen_t(MemoryLayout<sockaddr_in>.size)
        }
        var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        let result = withUnsafePointer(to: &storage) { pointer in pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { getnameinfo($0, length, &buffer, socklen_t(buffer.count), nil, 0, NI_NAMEREQD) } }
        return result == 0 ? String(cString: buffer) : address
    }
}
