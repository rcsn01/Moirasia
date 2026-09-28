import Foundation

public func bondedApplicationRuleIdentity(path: String, bundleIdentifier: String?) -> String {
    if let bundleIdentifier, !bundleIdentifier.isEmpty {
        return "bundle:\(bundleIdentifier)|path:\(path)"
    }
    return "path:\(path)"
}

func bondedApplicationRuleIdentityData(path: String, bundleIdentifier: String?) -> Data {
    Data(bondedApplicationRuleIdentity(path: path, bundleIdentifier: bundleIdentifier).utf8)
}

public func bondedApplicationRuleForTarget(_ target: BondedApplicationRuleTarget, selectedAt: String = ISO8601DateFormatter().string(from: Date())) -> BondedStoredRule {
    let bundleIdentifier = target.bundleIdentifier.flatMap { $0.isEmpty ? nil : $0 }
    let identity = bondedApplicationRuleIdentity(path: target.path, bundleIdentifier: bundleIdentifier)
    return BondedStoredRule(id: bondedOpaqueId(prefix: "rule", value: identity), path: target.path, displayName: target.displayName, targetKind: target.targetKind, bundleIdentifier: bundleIdentifier, selectedAt: selectedAt)
}

public func bondedMatchesApplicationRule(target: BondedApplicationRuleTarget, rule: BondedStoredRule) -> Bool {
    bondedApplicationRuleIdentityData(path: target.path, bundleIdentifier: target.bundleIdentifier)
        == bondedApplicationRuleIdentityData(path: rule.path, bundleIdentifier: rule.bundleIdentifier)
}

public func bondedContainingApplication(_ executablePath: String) -> String? {
    guard let match = executablePath.range(of: "^(.+?\\.app)(?:/|$)", options: [.regularExpression, .caseInsensitive]) else { return nil }
    let value = String(executablePath[match.lowerBound ..< match.upperBound])
    return value.hasSuffix("/") ? String(value.dropLast()) : value
}

func bondedObservedApplicationId(path: String, bundleIdentifier: String?) -> String {
    bondedOpaqueId(prefix: "app", value: bondedApplicationRuleIdentity(path: path, bundleIdentifier: bundleIdentifier))
}
