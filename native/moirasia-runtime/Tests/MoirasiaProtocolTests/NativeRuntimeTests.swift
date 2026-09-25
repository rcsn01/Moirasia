import XCTest
import Foundation
import Darwin
import MoirasiaProtocol
import ShoutAudioCore
@testable import AmoveRuntime
@testable import BondedRuntime
@testable import ShoutRuntime

final class NativeRuntimeTests: XCTestCase {
    func testHostSocketPathStaysShortAndMirrorsTypeScript() {
        // Pinned cross-language hash: sha256("abc") starts ba7816bf8f01cfea.
        XCTAssertEqual(moirasiaHostSocketPath(userData: "abc").hasSuffix("moirasia-host-ba7816bf8f01cfea.sock"), true)
        let longUserData = String(repeating: "deep/", count: 12) + "moirasia-user-data-with-a-very-long-path-segment"
        let path = moirasiaHostSocketPath(userData: longUserData)
        XCTAssertTrue(path.utf8.count + 1 <= 104, "socket path exceeds sockaddr_un.sun_path: \(path)")
        XCTAssertNotEqual(moirasiaHostSocketPath(userData: "/tmp/one"), moirasiaHostSocketPath(userData: "/tmp/two"))
    }
    func testAmoveGeometryMatchesSuitePolicy() {
        let displays = [AmoveRect(x: 0, y: 0, width: 100, height: 100), AmoveRect(x: 100, y: 20, width: 100, height: 100)]
        XCTAssertEqual(adjacentDisplay(displays: displays, source: 0, direction: .right), 1)
        XCTAssertEqual(preserveNormalizedTopLeft(window: AmoveRect(x: 25, y: 50, width: 60, height: 70), source: AmoveRect(x: 0, y: 0, width: 100, height: 200), target: AmoveRect(x: 100, y: -200, width: 200, height: 400)), AmoveRect(x: 150, y: -100, width: 60, height: 70))
    }

    func testBondedParserReadsHeaderRowsAndIgnoresLoopback() {
        let parser = NettopCSVParser()
        XCTAssertNil(parser.parse("pid,process,protocol,local,remote,state"))
        XCTAssertNotNil(parser.parse("42,Demo,tcp,192.168.1.2:1234,8.8.8.8:443,Established"))
        XCTAssertNil(parser.parse("42,Demo,tcp,127.0.0.1:1234,127.0.0.1:443,Established"))
    }

    func testBondedNativeRulesUseNativeRuleIdentifiers() {
        let target = BondedApplicationRuleTarget(path: "/Applications/Mail.app", displayName: "Mail", targetKind: "application", bundleIdentifier: "com.apple.mail")
        XCTAssertTrue(bondedApplicationRuleForTarget(target).id.hasPrefix("rule_"))
    }

    func testBondedApplicationClassifierRequiresValidatedAppleEvidence() {
        let classifier = BondedApplicationClassifier()
        let platform = classifier.classify(path: "/usr/libexec/demo", targetKind: "executable", bundleIdentifier: nil, evidence: BondedSigningEvidence(isValid: true, platformIdentifier: "macOS-15", hasCertificates: true, requirements: "anchor apple"))
        XCTAssertEqual(platform.category, .applePlatform)
        XCTAssertEqual(platform.confidence, .verified)

        let appleApp = classifier.classify(path: "/Applications/Mail.app", targetKind: "application", bundleIdentifier: "com.apple.mail", evidence: BondedSigningEvidence(isValid: true, hasCertificates: true, requirements: "identifier \"com.apple.mail\" and anchor apple"))
        XCTAssertEqual(appleApp.category, .appleSigned)

        let ambiguousAppleSigner = classifier.classify(path: "/Applications/Unknown.app", targetKind: "application", bundleIdentifier: "com.example.unknown", evidence: BondedSigningEvidence(isValid: true, hasCertificates: true, requirements: "anchor apple"))
        XCTAssertEqual(ambiguousAppleSigner.category, .unknown)

        let external = classifier.classify(path: "/Applications/Browser.app", targetKind: "application", bundleIdentifier: "com.example.browser", evidence: BondedSigningEvidence(isValid: true, teamIdentifier: "TEAM123", hasCertificates: true, requirements: "anchor apple generic"))
        XCTAssertEqual(external.category, .thirdParty)

        let spoofedAppleIdentifier = classifier.classify(path: "/Applications/Fake.app", targetKind: "application", bundleIdentifier: "com.apple.fake", evidence: BondedSigningEvidence(isValid: true, teamIdentifier: "TEAM123", hasCertificates: true, requirements: "anchor apple generic"))
        XCTAssertEqual(spoofedAppleIdentifier.category, .unknown)

        let unsigned = classifier.classify(path: "/tmp/demo", targetKind: "executable", bundleIdentifier: nil, evidence: BondedSigningEvidence(isValid: false))
        XCTAssertEqual(unsigned.category, .unknown)
    }

    func testBondedApplicationIconLookupCanUseTheContainingBundle() {
        XCTAssertEqual(bondedContainingApplication("/Applications/Mail.app/Contents/MacOS/Mail"), "/Applications/Mail.app")
        XCTAssertNil(bondedContainingApplication("/usr/bin/curl"))
    }

    func testBondedDestinationTargetAcceptsBareAddressesAndPartialCidrs() throws {
        XCTAssertEqual(try DestinationTarget("100.116.6.9").canonical, "100.116.6.9")
        XCTAssertEqual(try DestinationTarget("2001:db8::1").canonical, "2001:db8::1")
        XCTAssertEqual(try DestinationTarget("100.116.6.9/25").canonical, "100.116.6.0/25")
    }

    func testBondedBlockerLearnsBareDestinationAddresses() throws {
        let target = BondedApplicationRuleTarget(path: "/Applications/Mail.app", displayName: "Mail", targetKind: "application", bundleIdentifier: "com.apple.mail")
        let blocker = ObservedIpBlocker()
        let rule = bondedApplicationRuleForTarget(target)
        try blocker.addRule(rule, addresses: ["100.116.6.9"])
        XCTAssertEqual(blocker.targets(), ["100.116.6.9"])
    }

    func testBondedSettingsMigrateLegacyApplicationRuleIdentifiers() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let target = BondedApplicationRuleTarget(path: "/Applications/Mail.app", displayName: "Mail", targetKind: "application", bundleIdentifier: "com.apple.mail")
        let rule = BondedStoredRule(id: bondedOpaqueId(prefix: "app", value: bondedApplicationRuleIdentity(path: target.path, bundleIdentifier: target.bundleIdentifier)), path: target.path, displayName: target.displayName, targetKind: target.targetKind, bundleIdentifier: target.bundleIdentifier, selectedAt: "2026-09-20T00:00:00Z")
        let store = BondedSettingsStore(directory: directory.path)
        try JSONEncoder().encode(BondedSettings(version: 3, monitoringEnabled: true, blockingEnabled: false, applicationRules: [rule])).write(to: store.path)
        let loaded = store.load()
        XCTAssertTrue(loaded.applicationRules[0].id.hasPrefix("rule_"))
        let persisted = String(decoding: try Data(contentsOf: store.path), as: UTF8.self)
        XCTAssertFalse(persisted.contains("\"id\":\"app_"))
    }

    func testBondedFirewallDisconnectReopensConnectionForConfirmedCleanup() throws {
        let socketPath = "/tmp/bonded-fw-\(UUID().uuidString).sock"
        defer { try? FileManager.default.removeItem(atPath: socketPath) }
        let listener = socket(AF_UNIX, SOCK_STREAM, 0)
        XCTAssertGreaterThanOrEqual(listener, 0)
        defer { Darwin.close(listener) }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(socketPath.utf8) + [0]
        XCTAssertLessThan(pathBytes.count, MemoryLayout.size(ofValue: address.sun_path))
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: pathBytes) }
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(listener, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        XCTAssertEqual(bound, 0)
        XCTAssertEqual(listen(listener, 2), 0)

        let recorder = FirewallOperationRecorder()
        let serverFinished = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            defer { serverFinished.signal() }
            var cleanupCount = 0
            for _ in 0..<4 {
                let connection = accept(listener, nil, nil)
                guard connection >= 0 else { return }
                defer { Darwin.close(connection) }
                var bytes = Data()
                var chunk = [UInt8](repeating: 0, count: 4096)
                while !bytes.contains(0x0a) {
                    let count = recv(connection, &chunk, chunk.count, 0)
                    guard count > 0 else { return }
                    bytes.append(contentsOf: chunk.prefix(count))
                }
                guard let request = try? JSONSerialization.jsonObject(with: bytes.prefix(upTo: bytes.firstIndex(of: 0x0a)!)) as? [String: Any],
                      let id = request["id"] as? Int,
                      let operation = request["operation"] as? String else { return }
                recorder.append(operation)
                if operation == "configure" { cleanupCount += 1 }
                let accepted = operation != "configure" || cleanupCount == 1
                var responseObject: [String: Any] = ["id": id, "ok": accepted, "enabled": false, "ruleCount": 0]
                if !accepted { responseObject["error"] = "PF cleanup rejected" }
                guard var response = try? JSONSerialization.data(withJSONObject: responseObject) else { return }
                response.append(0x0a)
                response.withUnsafeBytes { raw in
                    if let base = raw.baseAddress { _ = Darwin.write(connection, base, raw.count) }
                }
            }
        }

        let client = FirewallClient(helperExecutable: "/missing/helper", socketPath: { socketPath }, isInstalled: { true })
        client.initialize()
        XCTAssertEqual(client.status.state, "disabled")
        XCTAssertNoThrow(try client.disconnect())
        XCTAssertEqual(client.status.state, "disabled")

        let rejectedClient = FirewallClient(helperExecutable: "/missing/helper", socketPath: { socketPath }, isInstalled: { true })
        rejectedClient.initialize()
        XCTAssertThrowsError(try rejectedClient.disconnect()) { XCTAssertTrue($0.localizedDescription.contains("PF cleanup rejected")) }
        XCTAssertEqual(rejectedClient.status.state, "error")

        XCTAssertEqual(serverFinished.wait(timeout: .now() + 5), .success)
        XCTAssertEqual(recorder.operations, ["status", "configure", "status", "configure"])
    }

    func testBondedRuntimePausesSamplingWhenHiddenAndHonorsBackgroundOptIn() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let settingsURL = directory.appendingPathComponent("settings.json")
        let originalSettings = Data("{\"version\":3,\"monitoringEnabled\":true,\"blockingEnabled\":false,\"applicationRules\":[]}".utf8)
        try originalSettings.write(to: settingsURL)
        let monitor = NetworkMonitor(executablePath: "/bin/sleep", arguments: ["30"], sampleInterval: 1, stopTimeout: 1)
        let firewall = FirewallClient(helperExecutable: "/missing/BondedFirewallHelper", socketPath: { "/tmp/bonded-missing-\(UUID().uuidString).sock" }, isInstalled: { false })
        let runtime = BondedRuntime(dataDirectory: directory.path, helperExecutable: "/missing/BondedFirewallHelper", networkMonitor: monitor, firewallClient: firewall)

        try runtime.start()
        XCTAssertEqual(monitor.status.state, "stopped")
        try runtime.setUiVisible(true)
        XCTAssertEqual(monitor.status.state, "running")
        try runtime.setUiVisible(false)
        XCTAssertEqual(monitor.status.state, "stopped")
        XCTAssertEqual(try Data(contentsOf: settingsURL), originalSettings)
        _ = try runtime.setMonitorWhenHidden(true)
        XCTAssertEqual(monitor.status.state, "running")
        _ = try runtime.setMonitorWhenHidden(false)
        XCTAssertEqual(monitor.status.state, "stopped")
        try runtime.stop()
        try runtime.stop()

        let saved = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: settingsURL))
        XCTAssertEqual(saved["monitoringEnabled"]?.boolValue, true)
        XCTAssertEqual(saved["monitorWhenHidden"]?.boolValue, false)
    }

    func testBondedMonitorKeepsSuccessfulBoundedProcessRunning() {
        let runningAgain = expectation(description: "successful bounded monitor cycle")
        var runningUpdates = 0
        var retried = false
        let monitor = NetworkMonitor(executablePath: "/usr/bin/true", arguments: [], sampleInterval: 0.02)
        monitor.onStatus = { status in
            if status.state == "retrying" { retried = true }
            guard status.state == "running" else { return }
            runningUpdates += 1
            if runningUpdates == 2 { runningAgain.fulfill() }
        }
        monitor.start()
        wait(for: [runningAgain], timeout: 0.75)
        try? monitor.stop()
        XCTAssertFalse(retried)
    }

    func testShoutRuntimeDoesNotEnableBoostWithoutExplicitPermissionRequest() {
        let provider = TestPermissionProvider(status: "not-determined")
        let runtime = ShoutRuntime(dataDirectory: NSTemporaryDirectory() + UUID().uuidString, permission: provider)
        runtime.setBoost(true)
        XCTAssertFalse(runtime.snapshot.boostActive)
        XCTAssertEqual(provider.requestCount, 0)
    }

    func testShoutSettingsUseLocalDefaultsAndRecoverFromBackup() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = ShoutSettingsStore(dataDirectory: directory.path)
        var first = ShoutControlSettings()
        first.gainDb = 7
        try store.save(first)
        var second = first
        second.gainDb = 11
        try store.save(second)
        XCTAssertEqual(store.load().gainDb, 11)
        try Data("{broken".utf8).write(to: store.path)
        XCTAssertEqual(store.load().gainDb, 7)
        XCTAssertEqual(store.load().makeDefaultInput, false)
    }

    func testBondedSettingsMigrateUnsafeRulesToVersionThree() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = BondedSettingsStore(directory: directory.path)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let legacy = "{\"version\":2,\"monitoringEnabled\":false,\"blockingEnabled\":true,\"rules\":[{\"target\":\"192.0.2.1\"}]}"
        try Data(legacy.utf8).write(to: store.path)
        let settings = store.load()
        XCTAssertEqual(settings.version, 3)
        XCTAssertFalse(settings.blockingEnabled)
        XCTAssertTrue(settings.applicationRules.isEmpty)
        XCTAssertTrue(store.migratedFromVersionTwo)
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.versionTwoBackupPath.path))
    }

    func testAmoveFirstSaveDoesNotRequireAnExistingFile() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = AmoveSettingsStore(dataDirectory: directory.path)
        let settings = store.load()
        try store.save(settings)
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.path.path))
    }

    func testShoutEnginePublishesInitialDeviceList() {
        let devicesPublished = expectation(description: "initial device list")
        let engine = ShoutEngine(dataDirectory: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString)) { event in
            if event.event == "devices-changed" { devicesPublished.fulfill() }
        }
        engine.start()
        wait(for: [devicesPublished], timeout: 2)
        engine.shutdown()
    }

    func testShoutEngineDeviceListOmitsOutputOnlyDevices() {
        let engine = ShoutEngine(dataDirectory: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString)) { _ in }
        engine.devices = [
            AudioDeviceSnapshot(uid: "speaker", name: "Speakers", hasInputStream: false, isShoutMic: false),
            AudioDeviceSnapshot(uid: "mic", name: "Microphone", hasInputStream: true, isShoutMic: false),
            AudioDeviceSnapshot(uid: "shout", name: "Shout Mic", hasInputStream: false, isShoutMic: true)
        ]
        XCTAssertEqual(engine.helperDevices().map(\.uid), ["mic", "shout"])
    }

    func testAmovePhysicalKeyCodesMatchUIAdapterTable() {
        XCTAssertEqual(AmovePhysicalKeyCodes.carbonCodeForPhysical("KeyA"), 0)
        XCTAssertEqual(AmovePhysicalKeyCodes.carbonCodeForPhysical("KeyS"), 1)
        XCTAssertEqual(AmovePhysicalKeyCodes.carbonCodeForPhysical("ArrowLeft"), 123)
        XCTAssertEqual(AmovePhysicalKeyCodes.carbonCodeForPhysical("ArrowUp"), 126)
        // Physical layout: Digit5 and Digit6 are intentionally swapped.
        XCTAssertEqual(AmovePhysicalKeyCodes.carbonCodeForPhysical("Digit5"), 23)
        XCTAssertEqual(AmovePhysicalKeyCodes.carbonCodeForPhysical("Digit6"), 22)
        XCTAssertEqual(AmovePhysicalKeyCodes.physicalCodeForCarbon(1), "KeyS")
        XCTAssertNil(AmovePhysicalKeyCodes.carbonCodeForPhysical("F13"))
    }

    func testAmoveDefaultBindingsCoverAllActionsWithModifiers() {
        let bindings = AmoveShortcutDefaults.bindings()
        XCTAssertEqual(Set(bindings.keys), Set(AmoveShortcutDefaults.actions))
        for action in AmoveShortcutDefaults.actions {
            let binding = bindings[action]!
            XCTAssertEqual(binding.modifiers, ["control", "alt", "meta"])
            XCTAssertNotEqual(binding.carbonModifierMask, 0)
            XCTAssertNotNil(binding.carbonKeyCode)
        }
        XCTAssertEqual(bindings["toggleShelf"]?.carbonKeyCode, 1)
        XCTAssertEqual(bindings["moveDisplayLeft"]?.carbonKeyCode, 123)
    }

    func testAmoveToggleActionPublishesOneShelfRequest() {
        let runtime = AmoveRuntime(dataDirectory: NSTemporaryDirectory() + UUID().uuidString)
        var toggleRequests = 0
        runtime.onToggleShelf = { toggleRequests += 1 }

        let result = runtime.perform(action: "toggleShelf")

        XCTAssertTrue(result.ok)
        XCTAssertEqual(toggleRequests, 1)
    }

    func testAmoveHotkeyRegistryValidatesAndDispatches() {
        let registry = HotkeyRegistry()
        var registered: [UInt32: UInt32] = [:]
        registry.registrar = { keyCode, mask in registered[mask | keyCode] = keyCode; return (true, Int64(registered.count)) }
        var bindings: [String: AmoveShortcutBinding] = [
            "moveDisplayLeft": AmoveShortcutBinding(key: AmoveShortcutKey(code: "ArrowLeft"), modifiers: ["control", "alt", "meta"]),
            "moveDisplayRight": AmoveShortcutBinding(key: AmoveShortcutKey(code: "ArrowRight"), modifiers: ["control", "alt", "meta"]),
            "toggleShelf": AmoveShortcutBinding(key: AmoveShortcutKey(code: "KeyS"), modifiers: ["control", "alt", "meta"]),
            "moveDisplayUp": AmoveShortcutBinding(key: AmoveShortcutKey(code: "ArrowUp"), modifiers: ["control", "alt", "meta"])
        ]
        // Same chord as moveDisplayUp → duplicate.
        bindings["moveDisplayDown"] = AmoveShortcutBinding(key: AmoveShortcutKey(code: "ArrowUp"), modifiers: ["control", "alt", "meta"])
        let issues = registry.register(bindings)
        XCTAssertEqual(issues.map(\.action), ["moveDisplayUp"])
        XCTAssertEqual(issues.first?.code, "duplicate")
        XCTAssertEqual(registered.count, 4)

        var dispatched: [String] = []
        registry.onAction = { dispatched.append($0) }
        registry.setHotkeyPolicy(appFocused: false, shelfVisible: false)
        XCTAssertTrue(registry.shouldDispatch(action: "moveDisplayLeft"))
        registry.setHotkeyPolicy(appFocused: true, shelfVisible: true)
        XCTAssertFalse(registry.shouldDispatch(action: "moveDisplayLeft"))
        XCTAssertTrue(registry.shouldDispatch(action: "toggleShelf"))
        registry.setRecording(true)
        XCTAssertFalse(registry.shouldDispatch(action: "toggleShelf"))
        registry.setRecording(false)
        XCTAssertTrue(registry.shouldDispatch(action: "toggleShelf"))
        XCTAssertTrue(dispatched.isEmpty, "Hotkeys must dispatch only through the Carbon event path.")
    }

    func testAmoveLegacyMigrationImportsShortcutsAndPresence() {
        // Legacy document: {"toggleShelf":{"keyCode":49,"modifiers":1},"previousDisplay":{"keyCode":123,"modifiers":{"rawValue":4}}}
        let document = "{\"toggleShelf\":{\"keyCode\":49,\"modifiers\":1},\"previousDisplay\":{\"keyCode\":123,\"modifiers\":{\"rawValue\":4}}}"
        let encoded = Data(document.utf8).base64EncodedString()
        let values: [String: JSONValue] = [
            "Amove.shortcuts.v2": .string(encoded),
            "Amove.showsMenuBar": .bool(false),
            "Amove.showsDockIconWhenNoWindowOpen": .bool(true)
        ]
        let result = AmoveLegacyMigration.migrateMacUserDefaults(values)
        let bindings = result.settings.shortcutsByPlatform["darwin"] ?? [:]
        XCTAssertEqual(bindings["toggleShelf"]?.key.code, "Space")
        XCTAssertEqual(bindings["toggleShelf"]?.modifiers, ["meta"])
        XCTAssertEqual(bindings["moveDisplayLeft"]?.carbonKeyCode, 123)
        XCTAssertEqual(bindings["moveDisplayLeft"]?.modifiers, ["control"])
        XCTAssertEqual(bindings["moveDisplayRight"]?.carbonKeyCode, 124)
        XCTAssertEqual(result.settings.presenceMode, "taskbar")
        XCTAssertEqual(result.settings.migrations["macUserDefaultsV1"], "completed")
        XCTAssertTrue(result.warnings.isEmpty)
    }

    func testAmoveLegacyMigrationFallsBackToDefaultsOnGarbage() {
        let result = AmoveLegacyMigration.migrateMacUserDefaults(["Amove.shortcuts.v2": .string("!!!")])
        XCTAssertEqual(result.settings.shortcutsByPlatform["darwin"]?.count, 5)
        XCTAssertEqual(result.settings.presenceMode, "background")
        XCTAssertEqual(result.settings.migrations["macUserDefaultsV1"], "completed-with-warnings")
    }
}

private func temporaryDirectory() -> URL {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true).appendingPathComponent("moirasia-native-test-\(UUID().uuidString)", isDirectory: true)
    try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
}

private final class FirewallOperationRecorder {
    private let lock = NSLock()
    private var values: [String] = []
    func append(_ operation: String) { lock.lock(); defer { lock.unlock() }; values.append(operation) }
    var operations: [String] { lock.lock(); defer { lock.unlock() }; return values }
}

private final class TestPermissionProvider: MicrophonePermissionProvider {
    let status: String
    var requestCount = 0
    init(status: String) { self.status = status }
    func authorizationStatus() -> String { status }
    func requestAccess(completion: @escaping (Bool) -> Void) { requestCount += 1; completion(true) }
}
