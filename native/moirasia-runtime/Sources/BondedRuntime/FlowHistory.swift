import CryptoKit
import Foundation

public struct BondedFlow: Codable, Equatable, Sendable {
    public let id: String
    public var timestamp: String
    public let address: String
    public var host: String
    public let port: Int
    public let proto: String
    public var blockedByRule: Bool
}

public struct BondedApplication: Equatable, Sendable {
    public let id: String
    public var target: BondedApplicationRuleTarget
    public var iconDataUrl: String?
    public var flows: [BondedFlow]
}

public final class FlowHistory {
    private struct InternalFlow {
        var id: String
        var key: String
        var numericTimestamp: Date
        var flow: BondedFlow
    }
    private struct InternalApplication {
        var target: BondedApplicationRuleTarget
        var iconDataUrl: String?
        var flows: [InternalFlow]
    }

    private var applications: [String: InternalApplication] = [:]
    public var maxAge: TimeInterval = 15 * 60
    public var globalCapacity = 2_000
    public var applicationCapacity = 200

    public init() {}

    public func add(targetId: String, target: BondedApplicationRuleTarget, sample: BondedNetworkSample, now: Date = Date(), host: String? = nil) -> (added: Bool, flowId: String) {
        expire(now: now)
        let key = "\(sample.pid)|\(sample.proto.rawValue)|\(sample.localAddress):\(sample.localPort)|\(sample.remoteAddress):\(sample.remotePort)"
        var application = applications[targetId] ?? InternalApplication(target: target, iconDataUrl: nil, flows: [])
        application.target = target
        let existing = application.flows.first { $0.key == key }
        if let existing {
            var updated = existing
            updated.numericTimestamp = now
            updated.flow.timestamp = ISO8601DateFormatter().string(from: now)
            updated.flow.host = host ?? sample.remoteAddress
            if let index = application.flows.firstIndex(where: { $0.id == existing.id }) { application.flows[index] = updated }
            application.flows.sort { $0.numericTimestamp > $1.numericTimestamp }
            applications[targetId] = application
            return (false, existing.id)
        }
        let id = bondedOpaqueId(prefix: "flow", value: "\(targetId)|\(key)|\(now.timeIntervalSince1970)")
        let flow = BondedFlow(id: id, timestamp: ISO8601DateFormatter().string(from: now), address: sample.remoteAddress, host: host ?? sample.remoteAddress, port: sample.remotePort, proto: sample.proto.rawValue, blockedByRule: false)
        application.flows.insert(InternalFlow(id: id, key: key, numericTimestamp: now, flow: flow), at: 0)
        if application.flows.count > applicationCapacity { application.flows.removeLast(application.flows.count - applicationCapacity) }
        applications[targetId] = application
        enforceGlobalCapacity(now: now)
        return (true, id)
    }

    public func target(_ applicationId: String) -> (id: String, target: BondedApplicationRuleTarget)? {
        expire()
        guard let application = applications[applicationId] else { return nil }
        return (applicationId, application.target)
    }

    public func addresses(_ applicationId: String) -> [String] {
        expire()
        return Array(Set(applications[applicationId]?.flows.map { $0.flow.address } ?? [])).sorted()
    }

    public func updateHost(_ applicationId: String, _ flowId: String, host: String) {
        guard var application = applications[applicationId], let index = application.flows.firstIndex(where: { $0.id == flowId }) else { return }
        application.flows[index].flow.host = host
        applications[applicationId] = application
    }

    public func setIcon(_ applicationId: String, iconDataUrl: String) {
        guard var application = applications[applicationId] else { return }
        application.iconDataUrl = iconDataUrl
        applications[applicationId] = application
    }

    public func snapshot(blocked: Set<String> = [], ruleIdForTarget: (BondedApplicationRuleTarget) -> String?) -> [BondedApplication] {
        expire()
        return applications.map { id, application -> (String, BondedApplication) in
            let selected = ruleIdForTarget(application.target) != nil
            let flows = application.flows.map { internalFlow -> BondedFlow in
                var flow = internalFlow.flow
                let target = try? DestinationTarget(flow.address)
                flow.blockedByRule = blocked.contains { entry in
                    guard let parsed = try? DestinationTarget(entry) else { return false }
                    return target?.family == parsed.family && target?.bytes == parsed.bytes
                }
                return flow
            }
            return (id, BondedApplication(id: id, target: application.target, iconDataUrl: application.iconDataUrl, flows: flows))
        }
        .sorted { $0.1.target.displayName.localizedStandardCompare($1.1.target.displayName) == .orderedAscending }
        .map { $0.1 }
    }

    public func clear() { applications.removeAll() }

    private func expire(now: Date = Date()) {
        let cutoff = now.addingTimeInterval(-maxAge)
        applications = applications.compactMapValues { application in
            let flows = application.flows.filter { $0.numericTimestamp >= cutoff }
            return flows.isEmpty ? nil : InternalApplication(target: application.target, iconDataUrl: application.iconDataUrl, flows: flows)
        }
    }

    private func enforceGlobalCapacity(now: Date) {
        let all = applications.flatMap { id, application in application.flows.map { (id, $0.numericTimestamp, $0.id) } }.sorted { $0.1 < $1.1 }
        let remove = max(0, all.count - globalCapacity)
        for item in all.prefix(remove) { applications[item.0]?.flows.removeAll { $0.id == item.2 } }
        applications = applications.filter { !$0.value.flows.isEmpty }
    }
}