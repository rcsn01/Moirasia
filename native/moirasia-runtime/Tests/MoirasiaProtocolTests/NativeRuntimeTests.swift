import XCTest
import MoirasiaProtocol
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

    func testShoutRuntimeDoesNotEnableBoostWithoutExplicitPermissionRequest() {
        let provider = TestPermissionProvider(status: "not-determined")
        let runtime = ShoutRuntime(dataDirectory: NSTemporaryDirectory() + UUID().uuidString, permission: provider)
        runtime.setBoost(true)
        XCTAssertFalse(runtime.snapshot.boostActive)
        XCTAssertEqual(provider.requestCount, 0)
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

private final class TestPermissionProvider: MicrophonePermissionProvider {
    let status: String
    var requestCount = 0
    init(status: String) { self.status = status }
    func authorizationStatus() -> String { status }
    func requestAccess(completion: @escaping (Bool) -> Void) { requestCount += 1; completion(true) }
}
