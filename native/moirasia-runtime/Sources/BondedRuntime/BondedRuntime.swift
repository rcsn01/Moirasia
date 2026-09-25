import AppKit
import CoreGraphics
import Foundation
import MoirasiaProtocol

/// Full Bonded controller: nettop monitor, process/DNS/icon resolution, learned
/// destination blocking via the privileged helper, and snapshot parity with the
/// TypeScript BondedController (version 3).
public final class BondedRuntime {
    private static let queueKey = DispatchSpecificKey<UInt8>()
    private let queue = DispatchQueue(label: "com.moirasia.bonded.runtime")
    private let queueMarker: UInt8 = 7
    private let settingsStore: BondedSettingsStore
    private var settings = BondedSettings()
    private let classifier: BondedApplicationClassifier
    private let resolver: BondedProcessResolver
    private let dns = DNSResolver()
    private let history = FlowHistory()
    private let monitor: NetworkMonitor
    private let firewall: FirewallClient
    private let blocker = ObservedIpBlocker()
    private var excludedPids: Set<Int>
    private var ownApplicationPath: String?
    private var iconCache: [String: String] = [:]
    private var disposed = false
    private var uiVisible = false
    private let dataDirectory: URL

    /// Synchronous snapshot publisher; the feature service serializes replies.
    public var onSnapshot: ((JSONValue) -> Void)?
    public var ownPids: [Int] { excludedPids.sorted() }
    private var snapshotScheduled = false
    private var firewallSyncScheduled = false

    public init(dataDirectory: String, helperExecutable: String, legacyDataDirectories: [String] = [], networkMonitor: NetworkMonitor = NetworkMonitor(), firewallClient: FirewallClient? = nil) {
        self.dataDirectory = URL(fileURLWithPath: dataDirectory, isDirectory: true)
        settingsStore = BondedSettingsStore(directory: dataDirectory, legacyDataDirectories: legacyDataDirectories)
        classifier = BondedApplicationClassifier()
        resolver = BondedProcessResolver(classifier: classifier)
        monitor = networkMonitor
        firewall = firewallClient ?? FirewallClient(helperExecutable: helperExecutable)
        excludedPids = [Int(getpid())]
        ownApplicationPath = bondedContainingApplication(Bundle.main.executablePath ?? "")
        settings = settingsStore.load()
        queue.setSpecific(key: Self.queueKey, value: queueMarker)
        monitor.onStatus = { [weak self] _ in self?.scheduleSnapshot() }
        monitor.onSample = { [weak self] sample in self?.acceptSample(sample) }
        firewall.onStatus = { [weak self] _ in self?.acceptFirewallStatus() }
    }

    // MARK: Lifecycle

    public func start() throws {
        try queue.sync {
            disposed = false
            blocker.load(settings.applicationRules)
            if settings.blockingEnabled {
                settings.blockingEnabled = false
                try settingsStore.save(settings)
            }
            firewall.initialize()
            if firewall.status.state == "active" { try firewall.configure(enabled: false, targets: []) }
            try applyMonitorPolicy()
            publishSnapshot()
        }
    }

    public func stop() throws {
        try queue.sync {
            guard !disposed else { return }
            disposed = true
            var failures: [String] = []
            do { try monitor.stop() } catch { failures.append(error.localizedDescription) }
            settings.blockingEnabled = false
            do { try firewall.disconnect() } catch { failures.append(error.localizedDescription) }
            do { try settingsStore.save(settings) } catch { failures.append(error.localizedDescription) }
            blocker.clearLearned()
            if !failures.isEmpty { throw BondedRuntimeError(failures.joined(separator: "\n")) }
        }
    }

    // MARK: Commands (called on the feature-service request queue)

    public func setMonitoring(_ enabled: Bool) throws -> JSONValue {
        try queue.sync {
            settings.monitoringEnabled = enabled
            try settingsStore.save(settings)
            try applyMonitorPolicy()
            publishSnapshot()
            return snapshot()
        }
    }

    public func setMonitorWhenHidden(_ enabled: Bool) throws -> JSONValue {
        try queue.sync {
            settings.monitorWhenHidden = enabled
            try settingsStore.save(settings)
            try applyMonitorPolicy()
            publishSnapshot()
            return snapshot()
        }
    }

    public func setUiVisible(_ visible: Bool) throws {
        try queue.sync {
            guard uiVisible != visible else { return }
            uiVisible = visible
            try applyMonitorPolicy()
            publishSnapshot()
        }
    }

    public func installFirewallHelper() throws -> JSONValue {
        try queue.sync {
            try firewall.install()
            publishSnapshot()
            return snapshot()
        }
    }

    public func uninstallFirewallHelper() throws -> JSONValue {
        try queue.sync {
            if settings.blockingEnabled || firewall.status.state == "active" { try firewall.configure(enabled: false, targets: []) }
            settings.blockingEnabled = false
            try settingsStore.save(settings)
            try firewall.uninstall()
            publishSnapshot()
            return snapshot()
        }
    }

    public func setBlocking(_ enabled: Bool) throws -> JSONValue {
        try queue.sync {
            if enabled && settings.applicationRules.isEmpty { throw BondedRuntimeError("Select at least one application from Network Monitor before enabling Blocking.") }
            if enabled && blocker.targets().isEmpty { throw BondedRuntimeError("Wait for the selected application to make a connection before enabling Blocking.") }
            if enabled && !firewall.status.helperInstalled { throw BondedFirewallError.helperMissing }
            settings.blockingEnabled = enabled
            let previous = settings
            let previousTargets = enforcedTargets()
            var enforcementChanged = false
            do {
                enforcementChanged = previous.blockingEnabled || enabled
                if enforcementChanged { try firewall.configure(enabled: enabled, targets: enabled ? blocker.targets() : []) }
                try settingsStore.save(settings)
            } catch {
                if enforcementChanged {
                    try? firewall.configure(enabled: previous.blockingEnabled, targets: previous.blockingEnabled ? previousTargets : [])
                }
                settings = previous
                throw error
            }
            publishSnapshot()
            return snapshot()
        }
    }

    public func selectObservedApplication(_ applicationId: String) throws -> JSONValue {
        try queue.sync {
            guard bondedIsOpaqueApplicationId(applicationId), let resolved = history.target(applicationId) else { throw BondedRuntimeError("The observed application is no longer available") }
            let previousState = blocker.exportState()
            let previousTargets = enforcedTargets()
            let previousSettings = settings
            let existing = settings.applicationRules.first { bondedMatchesApplicationRule(target: resolved.target, rule: $0) }
            let rule = existing ?? bondedApplicationRuleForTarget(BondedApplicationRuleTarget(path: resolved.target.path, displayName: resolved.target.displayName, targetKind: resolved.target.targetKind, bundleIdentifier: resolved.target.bundleIdentifier, classification: resolved.target.classification))
            do {
                _ = try blocker.addRule(rule, addresses: history.addresses(applicationId))
                if existing == nil { settings.applicationRules.append(rule) }
                try syncEnforcement(previousTargets: previousTargets)
                try settingsStore.save(settings)
                publishSnapshot()
                return snapshot()
            } catch {
                blocker.restore(previousState)
                settings = previousSettings
                throw error
            }
        }
    }

    public func removeApplicationRule(_ ruleId: String) throws -> JSONValue {
        try queue.sync {
            guard let index = settings.applicationRules.firstIndex(where: { $0.id == ruleId }) else { throw BondedRuntimeError("Application rule not found") }
            let previousState = blocker.exportState()
            let previousTargets = enforcedTargets()
            let previousSettings = settings
            settings.applicationRules.remove(at: index)
            blocker.removeRule(ruleId)
            if settings.blockingEnabled && blocker.targets().isEmpty { settings.blockingEnabled = false }
            do {
                try syncEnforcement(previousTargets: previousTargets)
                try settingsStore.save(settings)
                publishSnapshot()
                return snapshot()
            } catch {
                blocker.restore(previousState)
                settings = previousSettings
                throw error
            }
        }
    }

    public func restartMonitor() throws -> JSONValue {
        try queue.sync {
            if !settings.monitoringEnabled { settings.monitoringEnabled = true; try settingsStore.save(settings) }
            if settings.monitoringEnabled && (uiVisible || settings.monitorWhenHidden) { try monitor.restart() }
            else { try monitor.stop() }
            publishSnapshot()
            return snapshot()
        }
    }

    public func snapshot() -> JSONValue {
        if DispatchQueue.getSpecific(key: Self.queueKey) == queueMarker { return snapshotLocked() }
        return queue.sync { snapshotLocked() }
    }

    // MARK: Internals

    private func acceptSample(_ sample: BondedNetworkSample) {
        guard !disposed, !excludedPids.contains(sample.pid), !(["bonded", "electron", "MoirasiaFeatureService", "MoirasiaHost"].contains { sample.processName.localizedCaseInsensitiveCompare($0) == .orderedSame }) else { return }
        guard let target = resolver.resolve(pid: sample.pid, processName: sample.processName), target.path != ownApplicationPath else { return }
        queue.async { [self] in
            guard !disposed else { return }
            let ruleTarget = BondedApplicationRuleTarget(path: target.path, displayName: target.displayName, targetKind: target.targetKind, bundleIdentifier: target.bundleIdentifier, classification: target.classification)
            let result = history.add(targetId: target.id, target: ruleTarget, sample: sample)
            let observed = blocker.observe(target: ruleTarget, rawAddress: sample.remoteAddress)
            if observed.added && settings.blockingEnabled { scheduleFirewallSync() }
            if result.added {
                if let icon = applicationIconDataURL(target.path) { history.setIcon(target.id, iconDataUrl: icon) }
                dns.resolve(sample.remoteAddress) { [weak self] host in
                    self?.queue.async { self?.history.updateHost(target.id, result.flowId, host: host); self?.scheduleSnapshot() }
                }
            }
            scheduleSnapshot()
        }
    }

    private func acceptFirewallStatus() {
        queue.async { [self] in
            if firewall.status.state != "active" && settings.blockingEnabled {
                settings.blockingEnabled = false
                try? settingsStore.save(settings)
            }
            scheduleSnapshot()
        }
    }

    private func scheduleSnapshot() {
        guard !disposed, !snapshotScheduled else { return }
        snapshotScheduled = true
        queue.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            guard let self else { return }
            snapshotScheduled = false
            publishSnapshot()
        }
    }

    private func scheduleFirewallSync() {
        guard !disposed, !firewallSyncScheduled else { return }
        firewallSyncScheduled = true
        queue.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            guard let self else { return }
            firewallSyncScheduled = false
            guard !disposed, settings.blockingEnabled else { return }
            do { try firewall.configure(enabled: true, targets: blocker.targets()) }
            catch {
                try? firewall.configure(enabled: false, targets: [])
                settings.blockingEnabled = false
                try? settingsStore.save(settings)
            }
        }
    }

    private func applyMonitorPolicy() throws {
        if settings.monitoringEnabled && (uiVisible || settings.monitorWhenHidden) { monitor.start() }
        else { try monitor.stop() }
    }

    private func enforcedTargets() -> [String] {
        (settings.blockingEnabled && firewall.status.state == "active") ? blocker.targets() : []
    }

    private func syncEnforcement(previousTargets: [String]) throws {
        let enforcementChanged = settings.blockingEnabled || firewall.status.state == "active"
        if enforcementChanged { try firewall.configure(enabled: settings.blockingEnabled, targets: settings.blockingEnabled ? blocker.targets() : []) }
    }

    private func publishSnapshot() {
        queue.async { [weak self] in
            guard let self else { return }
            onSnapshot?(snapshotLocked())
        }
    }

    private func snapshotLocked() -> JSONValue {
        let firewallStatus = firewall.status
        let enforced = settings.blockingEnabled && firewallStatus.state == "active"
        let activeTargets = Set(enforced ? blocker.targets() : [])
        let applications = history.snapshot(blocked: activeTargets, ruleIdForTarget: { [blocker] target in blocker.ruleIdForTarget(target) })
        let learnedAddressCount = blocker.targets().count
        let rules = blocker.snapshot(blockingEnabled: enforced)
        let applicationsJSON: [JSONValue] = applications.filter { !$0.flows.isEmpty }.map { application in
            var value: [String: JSONValue] = [
                "id": .string(application.id),
                "displayName": .string(application.target.displayName),
                "recentFlowCount": .number(Double(application.flows.count)),
                "selected": .bool(blocker.ruleIdForTarget(application.target) != nil),
                "flows": .array(application.flows.map { flow in
                    .object(["id": .string(flow.id), "timestamp": .string(flow.timestamp), "address": .string(flow.address), "host": .string(flow.host), "port": .number(Double(flow.port)), "protocol": .string(flow.proto), "blockedByRule": .bool(flow.blockedByRule)])
                })
            ]
            if let iconDataUrl = application.iconDataUrl { value["iconDataUrl"] = .string(iconDataUrl) }
            if let classification = application.target.classification { value["classification"] = classificationJSON(classification) }
            return .object(value)
        }
        let rulesJSON: [JSONValue] = rules.map { rule in
            var value: [String: JSONValue] = ["id": .string(rule.id), "path": .string(rule.path), "displayName": .string(rule.displayName), "targetKind": .string(rule.targetKind), "selectedAt": .string(rule.selectedAt), "learnedAddresses": .array(rule.learnedAddresses.map { .string($0) }), "state": .string(rule.state)]
            if let bundleIdentifier = rule.bundleIdentifier { value["bundleIdentifier"] = .string(bundleIdentifier) }
            let classification = classifier.classify(path: rule.path, targetKind: rule.targetKind, bundleIdentifier: rule.bundleIdentifier)
            value["classification"] = classificationJSON(classification)
            if let iconDataUrl = applicationIconDataURL(rule.path) { value["iconDataUrl"] = .string(iconDataUrl) }
            return .object(value)
        }
        var statusObject: [String: JSONValue] = ["state": .string(monitor.status.state), "message": .string(monitor.status.message)]
        if let startedAt = monitor.status.startedAt { statusObject["startedAt"] = .string(startedAt) }
        if let retryAt = monitor.status.retryAt { statusObject["retryAt"] = .string(retryAt) }
        var firewallJSON: [String: JSONValue] = ["state": .string(firewallStatus.state), "message": .string(firewallStatus.message), "helperInstalled": .bool(firewallStatus.helperInstalled)]
        if let ruleCount = firewallStatus.ruleCount { firewallJSON["ruleCount"] = .number(Double(ruleCount)) }
        var result: [String: JSONValue] = [
            "version": .number(3),
            "monitoringEnabled": .bool(settings.monitoringEnabled),
            "monitorWhenHidden": .bool(settings.monitorWhenHidden),
            "blockingEnabled": .bool(enforced),
            "monitorStatus": .object(statusObject),
            "firewallStatus": .object(firewallJSON),
            "applications": .array(applicationsJSON),
            "applicationRules": .array(rulesJSON),
            "learnedAddressCount": .number(Double(learnedAddressCount)),
            "addressLimitReached": .bool(blocker.addressLimitReached),
            "capability": .object(["backend": .string("pf"), "scope": .string("system-destination"), "perApplication": .bool(false), "reason": .string("IP addresses learned from selected applications are blocked for every application while Bonded is running.")])
        ]
        if let migrationNotice = settingsStore.migrationNotice { result["migrationNotice"] = .string(migrationNotice) }
        enforceSnapshotBudget(&result)
        return .object(result)
    }

    private func classificationJSON(_ classification: BondedApplicationClassification) -> JSONValue {
        .object(["category": .string(classification.category.rawValue), "confidence": .string(classification.confidence.rawValue)])
    }

    private func enforceSnapshotBudget(_ result: inout [String: JSONValue]) {
        let budget = 768 * 1024
        guard case .array(let applications) = result["applications"] else { return }
        var flowLimit = 200
        while flowLimit > 0 {
            let bounded = applications.compactMap { value -> JSONValue? in
                guard case .object(var object) = value else { return nil }
                if case .array(let flows) = object["flows"], flows.count > flowLimit {
                    object["flows"] = .array(Array(flows.prefix(flowLimit)))
                    object["recentFlowCount"] = .number(Double(flowLimit))
                }
                return .object(object)
            }
            result["applications"] = .array(bounded)
            if let data = try? JSONEncoder().encode(JSONValue.object(result)), data.count <= budget { return }
            flowLimit /= 2
        }
        result["applications"] = .array([])
        guard let rules = result["applicationRules"], case .array(let ruleValues) = rules else { return }
        let rulesWithoutIcons = ruleValues.compactMap { value -> JSONValue? in
            guard case .object(var object) = value else { return nil }
            object.removeValue(forKey: "iconDataUrl")
            return .object(object)
        }
        result["applicationRules"] = .array(rulesWithoutIcons)
        if let data = try? JSONEncoder().encode(JSONValue.object(result)), data.count <= budget { return }
        var ruleLimit = rulesWithoutIcons.count
        while ruleLimit > 0 {
            result["applicationRules"] = .array(Array(rulesWithoutIcons.prefix(ruleLimit)))
            if let data = try? JSONEncoder().encode(JSONValue.object(result)), data.count <= budget { return }
            ruleLimit /= 2
        }
        result["applicationRules"] = .array([])
    }

    private func applicationIconDataURL(_ path: String) -> String? {
        if let cached = iconCache[path] { return cached }
        let image = NSWorkspace.shared.icon(forFile: bondedContainingApplication(path) ?? path)
        var rect = CGRect(x: 0, y: 0, width: 64, height: 64)
        guard let source = image.cgImage(forProposedRect: &rect, context: nil, hints: nil),
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: 64, height: 64, bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.clear(CGRect(x: 0, y: 0, width: 64, height: 64))
        context.draw(source, in: CGRect(x: 0, y: 0, width: 64, height: 64))
        guard let resized = context.makeImage(), let data = NSBitmapImageRep(cgImage: resized).representation(using: .png, properties: [:]), data.count <= 128 * 1024 else { return nil }
        let value = "data:image/png;base64,\(data.base64EncodedString())"
        iconCache[path] = value
        return value
    }
}

public func bondedIsOpaqueApplicationId(_ value: String) -> Bool {
    guard value.hasPrefix("app_"), value.count == "app_".count + 16 else { return false }
    return value.suffix(16).allSatisfy { $0.isHexDigit }
}

public struct BondedRuntimeError: Error, LocalizedError {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}