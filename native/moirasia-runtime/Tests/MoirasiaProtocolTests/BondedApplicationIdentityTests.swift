import Foundation
import XCTest
@testable import BondedRuntime

final class BondedApplicationIdentityTests: XCTestCase {
    func testIdentityKeyUsesNonEmptyBundleIdentifierAndExactFields() {
        let path = "/Applications/Browser.app"
        XCTAssertEqual(bondedApplicationRuleIdentity(path: path, bundleIdentifier: "com.example.browser"), "bundle:com.example.browser|path:\(path)")
        XCTAssertEqual(bondedApplicationRuleIdentity(path: path, bundleIdentifier: nil), "path:\(path)")
        XCTAssertEqual(bondedApplicationRuleIdentity(path: path, bundleIdentifier: ""), "path:\(path)")

        let caseChangedPath = "/applications/Browser.app"
        let caseChangedIdentifier = "com.example.Browser"
        let composedPath = "/Applications/Caf\u{00e9}.app"
        let decomposedPath = "/Applications/Cafe\u{0301}.app"
        XCTAssertNotEqual(bondedApplicationRuleIdentityData(path: path, bundleIdentifier: "com.example.browser"), bondedApplicationRuleIdentityData(path: caseChangedPath, bundleIdentifier: "com.example.browser"))
        XCTAssertNotEqual(bondedApplicationRuleIdentityData(path: path, bundleIdentifier: "com.example.browser"), bondedApplicationRuleIdentityData(path: path, bundleIdentifier: caseChangedIdentifier))
        XCTAssertNotEqual(bondedApplicationRuleIdentityData(path: composedPath, bundleIdentifier: "com.example.browser"), bondedApplicationRuleIdentityData(path: decomposedPath, bundleIdentifier: "com.example.browser"))
        XCTAssertNotEqual(bondedApplicationRuleIdentityData(path: path, bundleIdentifier: "com.example.caf\u{00e9}"), bondedApplicationRuleIdentityData(path: path, bundleIdentifier: "com.example.cafe\u{0301}"))
    }

    func testMatchingUsesBundleAndPathIdentityWithoutOneSidedFallback() {
        let path = "/Applications/Browser.app"
        let bundledTarget = target(path: path, bundleIdentifier: "com.example.browser")
        let pathOnlyTarget = target(path: path)
        let bundledRule = rule(path: path, bundleIdentifier: "com.example.browser")
        let pathOnlyRule = rule(path: path)

        XCTAssertTrue(bondedMatchesApplicationRule(target: bundledTarget, rule: bundledRule))
        XCTAssertFalse(bondedMatchesApplicationRule(target: bundledTarget, rule: pathOnlyRule))
        XCTAssertFalse(bondedMatchesApplicationRule(target: pathOnlyTarget, rule: bundledRule))
        XCTAssertFalse(bondedMatchesApplicationRule(target: bundledTarget, rule: rule(path: path, bundleIdentifier: "com.example.other")))
        XCTAssertFalse(bondedMatchesApplicationRule(target: bundledTarget, rule: rule(path: path, bundleIdentifier: "com.example.Browser")))
        XCTAssertFalse(bondedMatchesApplicationRule(target: bundledTarget, rule: rule(path: "/Applications/Other.app", bundleIdentifier: "com.example.browser")))
        XCTAssertTrue(bondedMatchesApplicationRule(target: pathOnlyTarget, rule: pathOnlyRule))
        XCTAssertTrue(bondedMatchesApplicationRule(target: bundledTarget, rule: rule(path: path, bundleIdentifier: "com.example.browser", targetKind: "executable")))
        XCTAssertTrue(bondedMatchesApplicationRule(target: pathOnlyTarget, rule: rule(path: path, targetKind: "executable")))
        XCTAssertFalse(bondedMatchesApplicationRule(target: target(path: "/Applications/café.app", bundleIdentifier: "com.example.browser"), rule: rule(path: "/Applications/cafe\u{0301}.app", bundleIdentifier: "com.example.browser")))
        XCTAssertFalse(bondedMatchesApplicationRule(target: target(path: path, bundleIdentifier: "com.example.café"), rule: rule(path: path, bundleIdentifier: "com.example.cafe\u{0301}")))
        XCTAssertFalse(bondedMatchesApplicationRule(target: target(path: "/Applications/browser.app", bundleIdentifier: "com.example.browser"), rule: bundledRule))
    }

    func testDelimiterCollisionPreservesTheExistingEncodedKeyBehavior() {
        let first = target(path: "/Applications/B.app", bundleIdentifier: "com.example|path:/Applications/A.app")
        let second = rule(path: "/Applications/A.app|path:/Applications/B.app", bundleIdentifier: "com.example")

        XCTAssertEqual(bondedApplicationRuleIdentity(path: first.path, bundleIdentifier: first.bundleIdentifier), bondedApplicationRuleIdentity(path: second.path, bundleIdentifier: second.bundleIdentifier))
        XCTAssertEqual(bondedApplicationRuleIdentityData(path: first.path, bundleIdentifier: first.bundleIdentifier), bondedApplicationRuleIdentityData(path: second.path, bundleIdentifier: second.bundleIdentifier))
        XCTAssertTrue(bondedMatchesApplicationRule(target: first, rule: second))
        XCTAssertEqual(bondedApplicationRuleForTarget(first, selectedAt: "2026-09-20T00:00:00Z").id, bondedOpaqueId(prefix: "rule", value: bondedApplicationRuleIdentity(path: second.path, bundleIdentifier: second.bundleIdentifier)))
    }

    func testRuleConstructionAndObservedApplicationIdUseModeSpecificPrefixes() {
        let path = "/usr/local/bin/tool"
        let bundled = target(path: path, bundleIdentifier: "com.example.tool", targetKind: "executable")
        let firstRule = bondedApplicationRuleForTarget(bundled, selectedAt: "2026-09-20T00:00:00Z")
        let secondRule = bondedApplicationRuleForTarget(bundled, selectedAt: "2026-09-20T00:00:00Z")

        XCTAssertEqual(firstRule, secondRule)
        XCTAssertTrue(firstRule.id.hasPrefix("rule_"))
        XCTAssertEqual(firstRule.selectedAt, "2026-09-20T00:00:00Z")
        let emptyIdentifierRule = bondedApplicationRuleForTarget(target(path: path, bundleIdentifier: ""))
        XCTAssertNil(emptyIdentifierRule.bundleIdentifier)
        XCTAssertEqual(emptyIdentifierRule.id, bondedApplicationRuleForTarget(target(path: path)).id)
        XCTAssertNotEqual(firstRule.id, emptyIdentifierRule.id)
        XCTAssertEqual(bondedObservedApplicationId(path: path, bundleIdentifier: nil), "app_47a83b56a7abb73a")
        XCTAssertEqual(bondedObservedApplicationId(path: path, bundleIdentifier: "com.example.tool"), "app_23fadf8d429411bf")
        XCTAssertEqual(bondedOpaqueId(prefix: "flow", value: "abc"), "flow_ba7816bf8f01cfea")
    }

    func testContainingApplicationPreservesBundlePathRules() {
        XCTAssertEqual(bondedContainingApplication("/Applications/Browser.app/Contents/Frameworks/Browser Helper.app/Contents/MacOS/Helper"), "/Applications/Browser.app")
        XCTAssertNil(bondedContainingApplication("/usr/bin/curl"))
        XCTAssertEqual(bondedContainingApplication("Foo.app"), "Foo.app")
        XCTAssertEqual(bondedContainingApplication("/Applications/Foo.app/"), "/Applications/Foo.app")
        XCTAssertEqual(bondedContainingApplication("/Applications/Foo.APP/Contents/MacOS/Tool"), "/Applications/Foo.APP")
        XCTAssertNil(bondedContainingApplication("/Applications/Foo.appish/Contents/MacOS/Tool"))
    }

    func testBlockerUsesIdentityMatchingAndByteExactDeduplication() throws {
        let path = "/Applications/Browser.app"
        let pathOnlyBlocker = ObservedIpBlocker()
        pathOnlyBlocker.load([rule(path: path)])
        XCTAssertFalse(pathOnlyBlocker.observe(target: target(path: path, bundleIdentifier: "com.example.browser"), rawAddress: "203.0.113.8").selected)

        let bundledBlocker = ObservedIpBlocker()
        bundledBlocker.load([rule(path: path, bundleIdentifier: "com.example.browser")])
        XCTAssertFalse(bundledBlocker.observe(target: target(path: path), rawAddress: "203.0.113.8").selected)
        XCTAssertTrue(bundledBlocker.observe(target: target(path: path, bundleIdentifier: "com.example.browser"), rawAddress: "203.0.113.8").selected)
        XCTAssertFalse(bundledBlocker.observe(target: target(path: path, bundleIdentifier: ""), rawAddress: "203.0.113.8").selected)

        let emptyAndMissingBlocker = ObservedIpBlocker()
        emptyAndMissingBlocker.load([rule(path: path, bundleIdentifier: "")])
        XCTAssertTrue(emptyAndMissingBlocker.observe(target: target(path: path), rawAddress: "203.0.113.8").selected)
        XCTAssertTrue(emptyAndMissingBlocker.observe(target: target(path: path, bundleIdentifier: ""), rawAddress: "203.0.113.8").selected)

        let composedPath = "/Applications/Caf\u{00e9}.app"
        let decomposedPath = "/Applications/Cafe\u{0301}.app"
        let composed = rule(path: composedPath, bundleIdentifier: "com.example.browser", id: "rule_0000000000000001")
        let decomposed = rule(path: decomposedPath, bundleIdentifier: "com.example.browser", id: "rule_0000000000000002")
        let blocker = ObservedIpBlocker()
        blocker.load([composed, decomposed])
        XCTAssertEqual(blocker.snapshot(blockingEnabled: false).count, 2)
        XCTAssertEqual(blocker.ruleIdForTarget(target(path: decomposedPath, bundleIdentifier: "com.example.browser")), decomposed.id)

        let added = ObservedIpBlocker()
        _ = try added.addRule(composed)
        XCTAssertEqual(try added.addRule(decomposed), decomposed)
        XCTAssertEqual(added.snapshot(blockingEnabled: false).count, 2)

        let composedIdentifier = "com.example.caf\u{00e9}"
        let decomposedIdentifier = "com.example.cafe\u{0301}"
        let composedIdentifierRule = rule(path: path, bundleIdentifier: composedIdentifier, id: "rule_0000000000000003")
        let decomposedIdentifierRule = rule(path: path, bundleIdentifier: decomposedIdentifier, id: "rule_0000000000000004")
        let identifierBlocker = ObservedIpBlocker()
        identifierBlocker.load([composedIdentifierRule, decomposedIdentifierRule])
        XCTAssertEqual(identifierBlocker.snapshot(blockingEnabled: false).count, 2)
        XCTAssertEqual(identifierBlocker.ruleIdForTarget(target(path: path, bundleIdentifier: decomposedIdentifier)), decomposedIdentifierRule.id)

        let identifierAdded = ObservedIpBlocker()
        _ = try identifierAdded.addRule(composedIdentifierRule)
        XCTAssertEqual(try identifierAdded.addRule(decomposedIdentifierRule), decomposedIdentifierRule)
        XCTAssertEqual(identifierAdded.snapshot(blockingEnabled: false).count, 2)
    }

    func testSettingsKeepByteDistinctUnicodeRulesAndRejectExplicitEmptyIdentifier() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = BondedSettingsStore(directory: directory.path)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let composed = rule(path: "/Applications/Caf\u{00e9}.app", bundleIdentifier: "com.example.browser", id: "rule_0000000000000001")
        let decomposed = rule(path: "/Applications/Cafe\u{0301}.app", bundleIdentifier: "com.example.browser", id: "rule_0000000000000002")
        let composedIdentifier = rule(path: "/Applications/Browser.app", bundleIdentifier: "com.example.caf\u{00e9}", id: "rule_0000000000000003")
        let decomposedIdentifier = rule(path: "/Applications/Browser.app", bundleIdentifier: "com.example.cafe\u{0301}", id: "rule_0000000000000004")
        try JSONEncoder().encode(BondedSettings(version: 3, applicationRules: [composed, decomposed, composedIdentifier, decomposedIdentifier])).write(to: store.path)
        XCTAssertEqual(store.load().applicationRules.map(\.id), [composed.id, decomposed.id, composedIdentifier.id, decomposedIdentifier.id])

        let emptyIdentifier = rule(path: "/Applications/Empty.app", bundleIdentifier: "", id: "rule_0000000000000005")
        try JSONEncoder().encode(BondedSettings(version: 3, applicationRules: [emptyIdentifier])).write(to: store.path)
        XCTAssertTrue(store.load().applicationRules.isEmpty)
    }
}

private func target(path: String, bundleIdentifier: String? = nil, targetKind: String = "application") -> BondedApplicationRuleTarget {
    BondedApplicationRuleTarget(path: path, displayName: "Target", targetKind: targetKind, bundleIdentifier: bundleIdentifier)
}

private func rule(path: String, bundleIdentifier: String? = nil, targetKind: String = "application", id: String = "rule_0000000000000001") -> BondedStoredRule {
    BondedStoredRule(id: id, path: path, displayName: "Target", targetKind: targetKind, bundleIdentifier: bundleIdentifier, selectedAt: "2026-09-20T00:00:00Z")
}

private func temporaryDirectory() -> URL {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true).appendingPathComponent("bonded-identity-test-\(UUID().uuidString)", isDirectory: true)
    try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
}
