import Foundation
import Security

public enum BondedApplicationCategory: String, Codable, Sendable {
    case applePlatform = "apple-platform"
    case appleSigned = "apple-signed"
    case thirdParty = "third-party"
    case unknown
}

public enum BondedClassificationConfidence: String, Codable, Sendable {
    case verified
    case heuristic
}

public struct BondedApplicationClassification: Codable, Equatable, Sendable {
    public let category: BondedApplicationCategory
    public let confidence: BondedClassificationConfidence

    public init(category: BondedApplicationCategory, confidence: BondedClassificationConfidence) {
        self.category = category
        self.confidence = confidence
    }

    public static let unknown = BondedApplicationClassification(category: .unknown, confidence: .heuristic)
}

/// The small, validated subset of code-signing evidence used for categorisation.
/// Bundle identifiers and paths are inputs to the decision, not signing evidence.
public struct BondedSigningEvidence: Equatable, Sendable {
    public let isValid: Bool
    public let identifier: String?
    public let platformIdentifier: String?
    public let teamIdentifier: String?
    public let hasCertificates: Bool
    public let requirements: String?

    public init(isValid: Bool, identifier: String? = nil, platformIdentifier: String? = nil, teamIdentifier: String? = nil, hasCertificates: Bool = false, requirements: String? = nil) {
        self.isValid = isValid
        self.identifier = identifier
        self.platformIdentifier = platformIdentifier
        self.teamIdentifier = teamIdentifier
        self.hasCertificates = hasCertificates
        self.requirements = requirements
    }
}

/// Conservative application ownership classification backed by Security.framework.
/// Failed or ambiguous inspection is intentionally reported as unknown.
public final class BondedApplicationClassifier: @unchecked Sendable {
    private struct CachedClassification {
        let value: BondedApplicationClassification
        let expires: Date
    }

    private let cacheLock = NSLock()
    private var staticCache: [String: CachedClassification] = [:]
    private let cacheTTL: TimeInterval

    public init(cacheTTL: TimeInterval = 300) {
        self.cacheTTL = cacheTTL
    }

    /// Classifies a running process. Dynamic validation is attempted first; static
    /// inspection is only a fallback when the PID cannot be resolved by Security.framework.
    public func classify(pid: Int, executablePath: String, applicationPath: String?, bundleIdentifier: String?) -> BondedApplicationClassification {
        let targetPath = applicationPath ?? executablePath
        let evidence = dynamicEvidence(pid: pid) ?? staticEvidence(path: targetPath)
        return classify(path: targetPath, targetKind: applicationPath == nil ? "executable" : "application", bundleIdentifier: bundleIdentifier, evidence: evidence)
    }

    /// Classifies a persisted rule from its on-disk code signature.
    public func classify(path: String, targetKind: String, bundleIdentifier: String?) -> BondedApplicationClassification {
        let now = Date()
        let bundleKey = bundleIdentifier ?? ""
        let cacheKey = "\(path)\u{0}\(targetKind)\u{0}\(bundleKey)"
        cacheLock.lock()
        if let cached = staticCache[cacheKey], cached.expires > now {
            cacheLock.unlock()
            return cached.value
        }
        cacheLock.unlock()

        let value = classify(path: path, targetKind: targetKind, bundleIdentifier: bundleIdentifier, evidence: staticEvidence(path: path))
        cacheLock.lock()
        staticCache[cacheKey] = CachedClassification(value: value, expires: now.addingTimeInterval(cacheTTL))
        cacheLock.unlock()
        return value
    }

    /// Pure decision boundary exposed for tests and for callers that already have
    /// validated Security.framework evidence.
    public func classify(path: String, targetKind: String, bundleIdentifier: String?, evidence: BondedSigningEvidence?) -> BondedApplicationClassification {
        guard let evidence, evidence.isValid else { return .unknown }
        if let platformIdentifier = evidence.platformIdentifier, !platformIdentifier.isEmpty {
            return BondedApplicationClassification(category: .applePlatform, confidence: .verified)
        }

        let appleBundle = isAppleBundle(evidence.identifier ?? bundleIdentifier)
        let exactAppleAnchor = hasExactAppleAnchor(evidence.requirements)
        if appleBundle {
            guard exactAppleAnchor, evidence.hasCertificates else { return .unknown }
            return BondedApplicationClassification(category: .appleSigned, confidence: .verified)
        }
        // Exact Apple signing without an Apple bundle identity is ambiguous;
        // do not turn Apple-issued evidence into an ownership claim.
        if exactAppleAnchor { return .unknown }

        // A validated non-Apple-owned signature is external software. Require
        // both the developer team and a CMS certificate chain; ad-hoc or
        // otherwise ambiguous signatures remain unknown.
        if evidence.teamIdentifier != nil && evidence.hasCertificates {
            return BondedApplicationClassification(category: .thirdParty, confidence: .verified)
        }
        return .unknown
    }

    private func dynamicEvidence(pid: Int) -> BondedSigningEvidence? {
        guard pid > 0 else { return nil }
        var code: SecCode?
        let attributes: [String: Any] = [kSecGuestAttributePid as String: NSNumber(value: pid)]
        guard SecCodeCopyGuestWithAttributes(nil, attributes as CFDictionary, SecCSFlags(), &code) == errSecSuccess, let code else { return nil }
        let validity = SecCodeCheckValidity(code, SecCSFlags(), nil)
        return signingEvidence(code: code, isValid: validity == errSecSuccess)
    }

    private func staticEvidence(path: String) -> BondedSigningEvidence? {
        guard !path.isEmpty else { return nil }
        var code: SecStaticCode?
        let url = URL(fileURLWithPath: path) as CFURL
        guard SecStaticCodeCreateWithPath(url, SecCSFlags(), &code) == errSecSuccess, let code else { return nil }
        let validity = SecStaticCodeCheckValidity(code, SecCSFlags(), nil)
        return signingEvidence(code: code, isValid: validity == errSecSuccess)
    }

    private func signingEvidence(code: SecCode, isValid: Bool) -> BondedSigningEvidence {
        var staticCode: SecStaticCode?
        let codeForInformation: SecStaticCode?
        if SecCodeCopyStaticCode(code, SecCSFlags(), &staticCode) == errSecSuccess {
            codeForInformation = staticCode
        } else {
            codeForInformation = nil
        }
        return signingEvidence(code: codeForInformation, isValid: isValid)
    }

    private func signingEvidence(code: SecStaticCode?, isValid: Bool) -> BondedSigningEvidence {
        guard let code else { return BondedSigningEvidence(isValid: isValid) }
        var rawInformation: CFDictionary?
        let flags = SecCSFlags(rawValue: kSecCSSigningInformation | kSecCSRequirementInformation)
        guard SecCodeCopySigningInformation(code, flags, &rawInformation) == errSecSuccess, let rawInformation else {
            return BondedSigningEvidence(isValid: isValid)
        }
        let information = rawInformation as NSDictionary
        let identifier = (information[kSecCodeInfoIdentifier] as? NSString).map(String.init)
        let platformIdentifier = (information[kSecCodeInfoPlatformIdentifier] as? NSString).map(String.init)
        let teamIdentifier = (information[kSecCodeInfoTeamIdentifier] as? NSString).map(String.init)
        let requirements = (information[kSecCodeInfoRequirements] as? NSString).map(String.init)
        let certificates = information[kSecCodeInfoCertificates] as? NSArray
        return BondedSigningEvidence(isValid: isValid, identifier: identifier, platformIdentifier: platformIdentifier, teamIdentifier: teamIdentifier, hasCertificates: certificates?.count ?? 0 > 0, requirements: requirements)
    }

    private func isAppleBundle(_ bundleIdentifier: String?) -> Bool {
        guard let bundleIdentifier else { return false }
        return bundleIdentifier == "com.apple" || bundleIdentifier.hasPrefix("com.apple.")
    }

    /// Do not treat `anchor apple generic` as Apple ownership: it also covers
    /// Apple-issued chains used by external Developer ID/App Store software.
    private func hasExactAppleAnchor(_ requirements: String?) -> Bool {
        guard let requirements else { return false }
        let tokens = requirements.split { character in
            character == " " || character == "\t" || character == "\n" || character == "(" || character == ")"
        }
        for index in tokens.indices where tokens[index] == "anchor" {
            let next = tokens.index(after: index)
            guard next < tokens.endIndex, tokens[next] == "apple" else { continue }
            let afterApple = tokens.index(after: next)
            if afterApple == tokens.endIndex || tokens[afterApple] != "generic" { return true }
        }
        return false
    }
}
