import Foundation
import XCTest
import MoirasiaProtocol
@testable import MoirasiaHost

final class HostUiStateRecoveryTests: XCTestCase {
    struct CapturedSend {
        let request: HostRequest
        let fallbackGeneration: UInt64
        let completion: (HostResponse, UInt64) -> Void
    }

    private var module: HostUiStateRecovery!
    private var sends: [CapturedSend] = []
    private var announcements: [[String: JSONValue]] = []

    override func setUp() {
        super.setUp()
        makeModule()
    }

    private func makeModule() {
        sends = []
        announcements = []
        module = HostUiStateRecovery(
            sendReplay: { [weak self] request, fallbackGeneration, completion in
                self?.sends.append(CapturedSend(request: request, fallbackGeneration: fallbackGeneration, completion: completion))
            },
            announceRestored: { [weak self] params in
                self?.announcements.append(params)
            }
        )
    }

    private func startGeneration(_ generation: UInt64, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(module.acceptGeneration(.started, generation: generation), file: file, line: line)
    }

    @discardableResult
    private func gateReplay(generation: UInt64, file: StaticString = #filePath, line: UInt = #line) -> CapturedSend {
        let before = sends.count
        XCTAssertTrue(module.accept(event: HostEvent(event: "host.snapshotChanged", revision: 1, payload: Self.fullSnapshot), generation: generation), file: file, line: line)
        XCTAssertEqual(sends.count, before + 1, "the gate must send exactly one replay", file: file, line: line)
        return sends[before]
    }

    private func retain(_ params: [String: JSONValue]) {
        module.retain(params)
    }

    private func succeed(_ send: CapturedSend, tag: UInt64? = nil) {
        send.completion(HostResponse(id: send.request.id, result: .object([:])), tag ?? send.fallbackGeneration)
    }

    private func fail(_ send: CapturedSend, code: String, tag: UInt64? = nil) {
        send.completion(HostResponse(id: send.request.id, error: HostError(code: code, message: "test failure")), tag ?? send.fallbackGeneration)
    }

    private static let fullSnapshot: JSONValue = .object([
        "version": .number(1),
        "revision": .number(1),
        "settings": .object([:]),
        "features": .array([])
    ])

    private static func snapshotWithout(_ key: String) -> JSONValue {
        var object: [String: JSONValue] = [
            "version": .number(1),
            "revision": .number(1),
            "settings": .object([:]),
            "features": .array([])
        ]
        object.removeValue(forKey: key)
        return .object(object)
    }

    // 1. Partial retention and unknown keys.
    func testPartialRetentionAndUnknownKeys() {
        startGeneration(1)
        retain(["mainVisible": .bool(true)])
        retain(["page": .string("settings")])
        retain([:])
        let replay = gateReplay(generation: 1)
        XCTAssertEqual(replay.request.params, [
            "mainVisible": .bool(true),
            "mainFocused": .bool(false),
            "shelfVisible": .bool(false)
        ])
    }

    // 2. All-or-nothing validation.
    func testAllOrNothingValidation() {
        startGeneration(1)
        retain(["mainVisible": .bool(true)])
        retain(["mainFocused": .string("true"), "shelfVisible": .bool(false)])
        let replay = gateReplay(generation: 1)
        XCTAssertEqual(replay.request.params, [
            "mainVisible": .bool(true),
            "mainFocused": .bool(false),
            "shelfVisible": .bool(false)
        ])
    }

    // 3. A no-op patch does not mark a replay dirty.
    func testNoOpPatchDoesNotMarkReplayDirty() {
        startGeneration(1)
        retain(["mainVisible": .bool(true)])
        let replay = gateReplay(generation: 1)
        retain(["mainVisible": .bool(true)])
        succeed(replay)
        XCTAssertEqual(sends.count, 1, "a no-op patch must not force a trailing replay")
        XCTAssertEqual(announcements.count, 1, "the clean success still announces")
    }

    // 4. One replay per generation after the first full snapshot.
    func testGateFiresOncePerGenerationAfterFirstFullSnapshot() {
        startGeneration(1)
        for key in ["version", "revision", "settings", "features"] {
            XCTAssertTrue(module.accept(event: HostEvent(event: "host.snapshotChanged", revision: 1, payload: Self.snapshotWithout(key)), generation: 1))
            XCTAssertEqual(sends.count, 0, "a snapshot missing \(key) must not trigger a replay")
        }
        XCTAssertTrue(module.accept(event: HostEvent(event: "host.snapshotChanged", revision: 1, payload: Self.fullSnapshot), generation: 1))
        XCTAssertEqual(sends.count, 1)
        XCTAssertTrue(module.accept(event: HostEvent(event: "host.snapshotChanged", revision: 2, payload: Self.fullSnapshot), generation: 1))
        XCTAssertEqual(sends.count, 1, "a later full snapshot in the same generation does not re-trigger")
    }

    // 5. Stale- and future-generation events are dropped.
    func testStaleAndFutureGenerationEventsAreDropped() {
        startGeneration(1)
        startGeneration(2)
        XCTAssertFalse(module.accept(event: HostEvent(event: "host.snapshotChanged", revision: 1, payload: Self.fullSnapshot), generation: 1))
        XCTAssertFalse(module.accept(event: HostEvent(event: "test.stale", revision: 1, payload: .object([:])), generation: 1))
        XCTAssertFalse(module.accept(event: HostEvent(event: "host.snapshotChanged", revision: 1, payload: Self.fullSnapshot), generation: 3))
        XCTAssertEqual(sends.count, 0)
        XCTAssertTrue(module.accept(event: HostEvent(event: "host.snapshotChanged", revision: 1, payload: Self.fullSnapshot), generation: 2))
        XCTAssertEqual(sends.count, 1, "the active generation still gates after the drops")
    }

    // 6. New-generation reset and repeated `.started`.
    func testNewGenerationResetAndRepeatedStarted() {
        startGeneration(1)
        let replay = gateReplay(generation: 1)
        XCTAssertTrue(module.acceptGeneration(.ended, generation: 1))
        startGeneration(2)
        XCTAssertFalse(module.acceptGeneration(.started, generation: 2), "a repeated `.started` is dropped without resetting")
        XCTAssertFalse(module.acceptGeneration(.started, generation: 1), "an older `.started` is dropped")
        succeed(replay)
        XCTAssertEqual(announcements.count, 0, "the reset cleared the in-flight replay, so the generation-1 completion is dropped")
        XCTAssertEqual(sends.count, 1)
        let reopened = gateReplay(generation: 2)
        XCTAssertEqual(reopened.fallbackGeneration, 2)
    }

    // 7. A terminal generation drops everything.
    func testTerminalGenerationDropsEverything() {
        startGeneration(1)
        let replay = gateReplay(generation: 1)
        retain(["mainFocused": .bool(true)])
        XCTAssertTrue(module.acceptGeneration(.ended, generation: 1))
        XCTAssertFalse(module.acceptGeneration(.running, generation: 1))
        XCTAssertFalse(module.accept(event: HostEvent(event: "host.snapshotChanged", revision: 2, payload: Self.fullSnapshot), generation: 1))
        succeed(replay)
        XCTAssertEqual(announcements.count, 0, "a completion for the in-flight replay is dropped: no announcement")
        XCTAssertEqual(sends.count, 1, "and no trailing replay despite the retained change")
    }

    // 8. In-flight changes coalesce into one trailing replay.
    func testInFlightChangesCoalesceIntoOneTrailingReplay() {
        startGeneration(1)
        retain(["mainVisible": .bool(true)])
        let first = gateReplay(generation: 1)
        retain(["mainFocused": .bool(true)])
        retain(["shelfVisible": .bool(true)])
        succeed(first)
        XCTAssertEqual(sends.count, 2, "two retained changes coalesce into exactly one trailing replay")
        XCTAssertEqual(announcements.count, 0, "the superseded success announces nothing")
        let trailing = sends[1]
        XCTAssertEqual(trailing.request.params, [
            "mainVisible": .bool(true),
            "mainFocused": .bool(true),
            "shelfVisible": .bool(true)
        ])
        XCTAssertNotEqual(trailing.request.id, first.request.id, "the trailing replay uses a fresh id")
        XCTAssertEqual(trailing.fallbackGeneration, 1)
        succeed(trailing)
        XCTAssertEqual(announcements.count, 1)
        XCTAssertEqual(announcements[0], trailing.request.params)
        XCTAssertEqual(sends.count, 2, "completing the trailing replay with no new changes sends nothing more")
    }

    // 9. Transport failures wait for the next generation.
    func testTransportFailuresWaitForNextGeneration() {
        for code in ["feature_service_crashed", "feature_service_unavailable"] {
            makeModule()
            startGeneration(1)
            retain(["mainVisible": .bool(true)])
            let replay = gateReplay(generation: 1)
            retain(["shelfVisible": .bool(true)])
            fail(replay, code: code)
            XCTAssertEqual(sends.count, 1, "\(code) must not resend in-generation")
            XCTAssertEqual(announcements.count, 0)
            startGeneration(2)
            XCTAssertTrue(module.accept(event: HostEvent(event: "host.snapshotChanged", revision: 1, payload: Self.fullSnapshot), generation: 2))
            XCTAssertEqual(sends.count, 2, "the next generation's gate fires a fresh replay")
            XCTAssertEqual(sends[1].request.params, [
                "mainVisible": .bool(true),
                "mainFocused": .bool(false),
                "shelfVisible": .bool(true)
            ])
            XCTAssertEqual(sends[1].fallbackGeneration, 2)
        }
    }

    // 10. Product errors neither loop nor announce.
    func testProductErrorsNeitherLoopNorAnnounce() {
        startGeneration(1)
        let replay = gateReplay(generation: 1)
        fail(replay, code: "amove_failed")
        XCTAssertEqual(sends.count, 1)
        XCTAssertEqual(announcements.count, 0)
        XCTAssertTrue(module.accept(event: HostEvent(event: "host.snapshotChanged", revision: 2, payload: Self.fullSnapshot), generation: 1))
        XCTAssertEqual(sends.count, 1, "a later full snapshot in the same generation does not refire")

        startGeneration(2)
        let second = gateReplay(generation: 2)
        retain(["mainFocused": .bool(true)])
        fail(second, code: "amove_failed")
        XCTAssertEqual(sends.count, 3, "a product error with the dirty flag set still sends the one trailing replay")
        XCTAssertEqual(announcements.count, 0)
        let trailing = sends[2]
        XCTAssertEqual(trailing.request.params, [
            "mainVisible": .bool(false),
            "mainFocused": .bool(true),
            "shelfVisible": .bool(false)
        ])
        fail(trailing, code: "amove_failed")
        XCTAssertEqual(sends.count, 3, "the cycle ends with no new changes: no loop")
        XCTAssertEqual(announcements.count, 0)
    }

    // 11. Success announces the full copy with a fresh request.
    func testSuccessAnnouncesFullCopyWithFreshRequest() {
        startGeneration(1)
        retain(["mainVisible": .bool(true)])
        retain(["shelfVisible": .bool(true)])
        let replay = gateReplay(generation: 1)
        XCTAssertEqual(replay.request.method, "host.setUiState")
        XCTAssertNotNil(UUID(uuidString: replay.request.id), "the replay request uses a fresh UUID")
        XCTAssertEqual(replay.request.params, [
            "mainVisible": .bool(true),
            "mainFocused": .bool(false),
            "shelfVisible": .bool(true)
        ])
        XCTAssertEqual(replay.fallbackGeneration, 1)
        succeed(replay)
        XCTAssertEqual(announcements.count, 1)
        XCTAssertEqual(announcements[0], replay.request.params)
    }

    // 12. A completion tagged with a different generation is dropped.
    func testMismatchedCompletionTagIsDropped() {
        startGeneration(1)
        let replay = gateReplay(generation: 1)
        succeed(replay, tag: 2)
        XCTAssertEqual(announcements.count, 0, "a completion tagged past a crash between gate and send is dropped")
        XCTAssertEqual(sends.count, 1)
        succeed(replay, tag: 1)
        XCTAssertEqual(announcements.count, 1, "the mismatched completion changed nothing, so the matching one still completes")
        XCTAssertEqual(sends.count, 1)
    }
}