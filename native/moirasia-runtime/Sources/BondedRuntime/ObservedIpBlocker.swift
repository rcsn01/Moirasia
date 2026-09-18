import Foundation

/// Port of the TypeScript ObservedIpBlocker: per-rule learned destination
/// addresses with global reference counting, loopback filtering, and the
/// 4,096-address ceiling.
public struct BondedApplicationRuleTarget: Equatable, Sendable {
    public let path: String
    public let displayName: String
    public let targetKind: String
    public let bundleIdentifier: String?
}

public struct BondedRuleState {
    public let id: String
    public let path: String
    public let displayName: String
    public let targetKind: String
    public let bundleIdentifier: String?
    public let selectedAt: String
    public let learnedAddresses: [String]
    public let state: String
}

public enum BondedBlockerLimits {
    public static let applicationRules = 256
    public static let destinationRules = 4_096
}

public func bondedApplicationRuleIdentity(path: String, bundleIdentifier: String?) -> String {
    bundleIdentifier.map { "bundle:\($0)|path:\(path)" } ?? "path:\(path)"
}

public func bondedApplicationRuleForTarget(_ target: BondedApplicationRuleTarget, selectedAt: String = ISO8601DateFormatter().string(from: Date())) -> BondedStoredRule {
    let identity = bondedApplicationRuleIdentity(path: target.path, bundleIdentifier: target.bundleIdentifier)
    return BondedStoredRule(id: bondedOpaqueId(prefix: "app", value: identity), path: target.path, displayName: target.displayName, targetKind: target.targetKind, bundleIdentifier: target.bundleIdentifier, selectedAt: selectedAt)
}

public func bondedMatchesApplicationRule(target: BondedApplicationRuleTarget, rule: BondedStoredRule) -> Bool {
    if let bundleIdentifier = target.bundleIdentifier, let ruleBundle = rule.bundleIdentifier { return bundleIdentifier == ruleBundle && target.path == rule.path }
    return target.path == rule.path
}

func bondedIsLoopbackOrUnspecified(family: Int, bytes: [UInt8]) -> Bool {
    if bytes.allSatisfy({ $0 == 0 }) { return true }
    if family == 4 { return bytes[0] == 127 }
    if bytes[0...14].allSatisfy({ $0 == 0 }) && bytes[15] == 1 { return true }
    return bytes[0...9].allSatisfy({ $0 == 0 }) && bytes[10] == 0xff && bytes[11] == 0xff && bytes[12] == 127
}

public final class ObservedIpBlocker {
    struct RuntimeRule { var rule: BondedStoredRule; var addresses: Set<String> }
    private var rules: [String: RuntimeRule] = [:]
    private var addressReferences: [String: Int] = [:]
    private(set) var limitReached = false

    public init() {}

    public func load(_ rules: [BondedStoredRule]) {
        self.rules.removeAll(); addressReferences.removeAll(); limitReached = false
        for rule in rules {
            if self.rules.count >= BondedBlockerLimits.applicationRules { break }
            if self.rules.values.contains(where: { bondedApplicationRuleIdentity(path: $0.rule.path, bundleIdentifier: $0.rule.bundleIdentifier) == bondedApplicationRuleIdentity(path: rule.path, bundleIdentifier: rule.bundleIdentifier) }) { continue }
            self.rules[rule.id] = RuntimeRule(rule: rule, addresses: [])
        }
    }

    @discardableResult
    public func addRule(_ rule: BondedStoredRule, addresses: [String] = []) throws -> BondedStoredRule {
        if let existing = findRule(rule) {
            for address in addresses { _ = addAddress(existing, address) }
            return existing.rule
        }
        if rules.count >= BondedBlockerLimits.applicationRules { throw BondedBlockerError.tooManyApplications }
        let runtime = RuntimeRule(rule: rule, addresses: [])
        rules[rule.id] = runtime
        for address in addresses { _ = addAddress(runtime, address) }
        return rule
    }

    @discardableResult
    public func removeRule(_ ruleId: String) -> Bool {
        guard let runtime = rules.removeValue(forKey: ruleId) else { return false }
        for address in runtime.addresses { removeAddressReference(address) }
        if addressReferences.count < BondedBlockerLimits.destinationRules { limitReached = false }
        return true
    }

    public func observe(target: BondedApplicationRuleTarget, rawAddress: String) -> (selected: Bool, added: Bool, address: String?, limitReached: Bool) {
        guard let runtime = ruleForTarget(target) else { return (false, false, nil, limitReached) }
        guard let address = normalize(rawAddress) else { return (true, false, nil, limitReached) }
        if runtime.addresses.contains(address) { return (true, false, address, limitReached) }
        let added = addAddress(runtime, address)
        return (true, added, address, limitReached)
    }

    public func ruleIdForTarget(_ target: BondedApplicationRuleTarget) -> String? { ruleForTarget(target)?.rule.id }

    public func targets() -> [String] { addressReferences.keys.sorted() }

    public func snapshot(blockingEnabled: Bool) -> [BondedRuleState] {
        rules.values.map { runtime in
            let learned = runtime.addresses.sorted()
            var state = "waiting-for-traffic"
            if !learned.isEmpty { state = blockingEnabled ? "blocking-observed-ips" : "learning" }
            return BondedRuleState(id: runtime.rule.id, path: runtime.rule.path, displayName: runtime.rule.displayName, targetKind: runtime.rule.targetKind, bundleIdentifier: runtime.rule.bundleIdentifier, selectedAt: runtime.rule.selectedAt, learnedAddresses: learned, state: state)
        }.sorted { $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending }
    }

    public var addressLimitReached: Bool { limitReached }

    public func clearLearned() {
        for id in rules.keys { rules[id]?.addresses = [] }
        addressReferences.removeAll()
        limitReached = false
    }

    public struct ExportedState { let rules: [RuntimeRule]; let limitReached: Bool }
    public func exportState() -> ExportedState { ExportedState(rules: Array(rules.values), limitReached: limitReached) }
    public func restore(_ state: ExportedState) {
        rules = [:]; addressReferences = [:]
        for runtime in state.rules {
            rules[runtime.rule.id] = runtime
            for address in runtime.addresses { addressReferences[address, default: 0] += 1 }
        }
        limitReached = state.limitReached
    }

    private func findRule(_ rule: BondedStoredRule) -> RuntimeRule? {
        rules[rule.id] ?? rules.values.first { bondedApplicationRuleIdentity(path: $0.rule.path, bundleIdentifier: $0.rule.bundleIdentifier) == bondedApplicationRuleIdentity(path: rule.path, bundleIdentifier: rule.bundleIdentifier) }
    }

    private func ruleForTarget(_ target: BondedApplicationRuleTarget) -> RuntimeRule? {
        rules.values.first { bondedMatches(target, $0.rule) }
    }

    private func bondedMatches(_ target: BondedApplicationRuleTarget, _ rule: BondedStoredRule) -> Bool {
        if let bundleIdentifier = target.bundleIdentifier, let ruleBundle = rule.bundleIdentifier { return bundleIdentifier == ruleBundle && target.path == rule.path }
        return target.path == rule.path
    }

    private func addAddress(_ runtime: RuntimeRule, _ rawAddress: String) -> Bool {
        guard var updated = rules[runtime.rule.id] else { return false }
        guard let address = normalize(rawAddress), !updated.addresses.contains(address) else { return false }
        let known = addressReferences[address] != nil
        if !known && addressReferences.count >= BondedBlockerLimits.destinationRules { limitReached = true; return false }
        updated.addresses.insert(address)
        addressReferences[address, default: 0] += 1
        rules[updated.rule.id] = updated
        return true
    }

    private func removeAddressReference(_ address: String) {
        guard let references = addressReferences[address] else { return }
        if references <= 1 { addressReferences.removeValue(forKey: address) } else { addressReferences[address] = references - 1 }
    }

    private func normalize(_ rawAddress: String) -> String? {
        let stripped = rawAddress.replacingOccurrences(of: "%[^%]+$", with: "", options: .regularExpression)
        guard let parsed = try? DestinationTarget(stripped), !bondedIsLoopbackOrUnspecified(family: parsed.family, bytes: parsed.bytes) else { return nil }
        return parsed.canonical
    }
}

public enum BondedBlockerError: Error, LocalizedError {
    case tooManyApplications
    public var errorDescription: String? { "At most \(BondedBlockerLimits.applicationRules) applications can be selected." }
}