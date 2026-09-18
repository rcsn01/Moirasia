import Darwin
import Foundation

struct FeatureLeaseOwner: Codable, Equatable {
    var version: Int = 1
    let pid: Int32
    let host: String
    let token: String
    let acquiredAt: String
}

final class FeatureRuntimeLease {
    let path: URL
    let owner: FeatureLeaseOwner
    private var held = false

    init(appData: String, lockName: String, host: String) throws {
        let directory = URL(fileURLWithPath: appData, isDirectory: true).appendingPathComponent("Moirasia", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        path = directory.appendingPathComponent(lockName, isDirectory: true)
        owner = FeatureLeaseOwner(pid: getpid(), host: host, token: UUID().uuidString, acquiredAt: ISO8601DateFormatter().string(from: Date()))
        try acquire()
    }

    func release() {
        guard held else { return }
        guard let current = readOwner(), current.token == owner.token else { held = false; return }
        try? FileManager.default.removeItem(at: path)
        held = false
    }

    deinit { release() }

    private func acquire() throws {
        do {
            try FileManager.default.createDirectory(at: path, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            let data = try JSONEncoder().encode(owner) + Data([0x0a])
            let ownerPath = path.appendingPathComponent("owner.json")
            try data.write(to: ownerPath, options: [.atomic])
            chmod(ownerPath.path, 0o600)
            held = true
            return
        } catch let error as NSError where error.domain == NSCocoaErrorDomain && (error.code == CocoaError.fileWriteFileExists.rawValue || error.code == CocoaError.fileWriteFileExists.rawValue + 1) {
            guard let current = readOwner() else { try? FileManager.default.removeItem(at: path); return try acquire() }
            do { kill(current.pid, 0); throw FeatureLeaseError.inUse(current) }
            catch let leaseError as FeatureLeaseError { throw leaseError }
            catch { try? FileManager.default.removeItem(at: path); return try acquire() }
        }
    }

    private func readOwner() -> FeatureLeaseOwner? {
        guard let data = try? Data(contentsOf: path.appendingPathComponent("owner.json")), let value = try? JSONDecoder().decode(FeatureLeaseOwner.self, from: data) else { return nil }
        return value
    }
}

enum FeatureLeaseError: Error, LocalizedError {
    case inUse(FeatureLeaseOwner)
    var errorDescription: String? {
        switch self { case .inUse(let owner): return "Feature runtime is already owned by \(owner.host) (pid \(owner.pid))." }
    }
}
