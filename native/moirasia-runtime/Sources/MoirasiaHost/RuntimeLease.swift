import Darwin
import Foundation

final class NativeRuntimeLease {
    private let path: String
    private var descriptor: Int32 = -1

    init(path: String) { self.path = path }

    func acquire() throws {
        let directory = URL(fileURLWithPath: path).deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let value = Darwin.open(path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard value >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        guard flock(value, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(value)
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(EWOULDBLOCK))
        }
        descriptor = value
        let record = "{\"pid\":\(getpid()),\"startedAt\":\"\(ISO8601DateFormatter().string(from: Date()))\"}\n"
        _ = ftruncate(value, 0)
        _ = record.withCString { Darwin.write(value, $0, strlen($0)) }
        _ = fsync(value)
        chmod(path, 0o600)
    }

    func release() {
        guard descriptor >= 0 else { return }
        _ = flock(descriptor, LOCK_UN)
        Darwin.close(descriptor)
        descriptor = -1
        try? FileManager.default.removeItem(atPath: path)
    }

    deinit { release() }
}
