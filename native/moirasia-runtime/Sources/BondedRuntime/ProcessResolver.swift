import CryptoKit
import Darwin
import Foundation

private let procPidPathInfoMaxSize = 4_096

/// pid → application target resolution, mirroring the TypeScript ProcessResolver
/// semantics (path, containing application, bundle identifier, display name).
public struct BondedProcessTarget {
    public let id: String
    public let path: String
    public let displayName: String
    public let targetKind: String
    public let bundleIdentifier: String?
    public let classification: BondedApplicationClassification

    public init(id: String, path: String, displayName: String, targetKind: String, bundleIdentifier: String?, classification: BondedApplicationClassification) {
        self.id = id
        self.path = path
        self.displayName = displayName
        self.targetKind = targetKind
        self.bundleIdentifier = bundleIdentifier
        self.classification = classification
    }
}

public func bondedContainingApplication(_ executablePath: String) -> String? {
    guard let match = executablePath.range(of: "^(.+?\\.app)(?:/|$)", options: [.regularExpression, .caseInsensitive]) else { return nil }
    let value = String(executablePath[match.lowerBound ..< match.upperBound])
    return value.hasSuffix("/") ? String(value.dropLast()) : value
}

public func bondedOpaqueId(prefix: String, value: String) -> String {
    let digest = SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    return "\(prefix)_\(digest.prefix(16))"
}

public final class BondedProcessResolver: @unchecked Sendable {
    private struct CacheEntry { let target: BondedProcessTarget?; let expires: Date; let processName: String? }
    private var cache: [Int: CacheEntry] = [:]
    private let lock = NSLock()
    private let ttl: TimeInterval
    private let classifier: BondedApplicationClassifier

    public init(ttl: TimeInterval = 30, classifier: BondedApplicationClassifier = BondedApplicationClassifier()) {
        self.ttl = ttl
        self.classifier = classifier
    }

    public func resolve(pid: Int, processName: String? = nil, now: Date = Date()) -> BondedProcessTarget? {
        lock.lock()
        if let entry = cache[pid], entry.expires > now, processName == nil || entry.processName == processName {
            lock.unlock()
            return entry.target
        }
        lock.unlock()
        let target = perform(pid: pid, processName: processName)
        lock.lock()
        cache[pid] = CacheEntry(target: target, expires: now.addingTimeInterval(ttl), processName: processName)
        lock.unlock()
        return target
    }

    private func perform(pid: Int, processName: String?) -> BondedProcessTarget? {
        guard pid > 0 else { return nil }
        let buffer = UnsafeMutablePointer<CChar>.allocate(capacity: procPidPathInfoMaxSize)
        defer { buffer.deallocate() }
        guard proc_pidpath(Int32(pid), buffer, UInt32(procPidPathInfoMaxSize)) > 0 else { return nil }
        let path = String(cString: buffer)
        let application = bondedContainingApplication(path)
        let bundleIdentifier = application.flatMap(Self.readBundleIdentifier)
        let displayName = Self.displayName(path: path, application: application)
        let targetKind = application == nil ? "executable" : "application"
        let classification = classifier.classify(pid: pid, executablePath: path, applicationPath: application, bundleIdentifier: bundleIdentifier)
        let identity = bundleIdentifier.map { "bundle:\($0)|path:\(path)" } ?? "path:\(path)"
        return BondedProcessTarget(id: bondedOpaqueId(prefix: "app", value: identity), path: path, displayName: displayName, targetKind: targetKind, bundleIdentifier: bundleIdentifier, classification: classification)
    }

    static func readBundleIdentifier(_ applicationPath: String) -> String? {
        let infoURL = URL(fileURLWithPath: applicationPath).appendingPathComponent("Contents/Info.plist")
        guard let data = try? Data(contentsOf: infoURL), let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any], let identifier = plist["CFBundleIdentifier"] as? String, !identifier.isEmpty else { return nil }
        return identifier
    }

    static func displayName(path: String, application: String?) -> String {
        if let application {
            let bundle = URL(fileURLWithPath: application)
            if let plist = try? Data(contentsOf: bundle.appendingPathComponent("Contents/Info.plist")), let dictionary = try? PropertyListSerialization.propertyList(from: plist, options: [], format: nil) as? [String: Any] {
                for key in ["CFBundleDisplayName", "CFBundleName"] { if let name = dictionary[key] as? String, !name.isEmpty { return name } }
            }
            return bundle.deletingPathExtension().lastPathComponent
        }
        return URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
    }
}