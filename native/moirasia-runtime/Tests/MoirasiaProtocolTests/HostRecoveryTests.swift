import AppKit
import Darwin
import Foundation
import XCTest
import MoirasiaProtocol
@testable import MoirasiaHost

final class HostRecoveryTests: XCTestCase {
    private var harness: HostRecoveryHarness!

    override func setUpWithError() throws {
        signal(SIGPIPE, SIG_IGN)
        harness = try HostRecoveryHarness()
    }

    override func tearDownWithError() throws {
        harness.close()
        harness = nil
    }

    func testPartialStateMergesAndReplaysLatestFullValueAfterSnapshot() throws {
        try assertPatch(["mainVisible": .bool(true)])
        try assertPatch(["mainFocused": .bool(true)])
        try assertPatch(["shelfVisible": .bool(true)])

        harness.supervisor.emit(snapshot: validSnapshot(), generation: 1)
        let replay = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: 3))
        XCTAssertEqual(replay.request.params, [
            "mainVisible": .bool(true),
            "mainFocused": .bool(true),
            "shelfVisible": .bool(true)
        ])
        XCTAssertNotNil(UUID(uuidString: replay.request.id), "internal replay uses a fresh UUID")
        XCTAssertEqual(replay.generation, 1)

        harness.supervisor.complete(replay, result: .object([:]))
        let restored = try XCTUnwrap(harness.client.waitForEvent(named: "host.uiStateChanged", after: 0) {
            $0.payload == .object(["mainVisible": .bool(true), "mainFocused": .bool(true), "shelfVisible": .bool(true)])
        })
        XCTAssertEqual(restored.payload, .object([
            "mainVisible": .bool(true),
            "mainFocused": .bool(true),
            "shelfVisible": .bool(true)
        ]))

        let allFacts = Set(["mainVisible", "mainFocused", "shelfVisible"])
        let replayCount = harness.supervisor.requests.filter { Set($0.request.params.keys) == allFacts }.count
        try assertPatch(["mainFocused": .bool(true)])
        try assertPatch(["page": .string("settings")])
        try assertPatch([:])
        XCTAssertEqual(harness.supervisor.requests.filter { Set($0.request.params.keys) == allFacts }.count, replayCount)

        harness.supervisor.emitHealth(.error, generation: 1, error: "restart", restartCount: 1)
        XCTAssertNotNil(harness.client.waitForEvent(named: "host.snapshotChanged", after: 0) {
            $0.payload["featureService"]?["error"]?.stringValue == "restart"
        })
        let nextReplayIndex = harness.supervisor.requests.count
        harness.supervisor.emitHealth(.starting, generation: 2)
        harness.supervisor.emit(snapshot: validSnapshot(), generation: 2)
        let nextReplay = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: nextReplayIndex))
        XCTAssertEqual(nextReplay.request.params, replay.request.params)
    }

    func testMalformedRecognizedFieldDoesNotPartiallyUpdateRecoveryCopy() throws {
        try assertPatch(["mainVisible": .bool(true)])
        let invalidID = UUID().uuidString
        let invalidParams: [String: JSONValue] = ["mainVisible": .bool(false), "mainFocused": .string("true")]
        harness.client.send(HostRequest(id: invalidID, method: "host.setUiState", params: invalidParams))
        let invalidRequest = try XCTUnwrap(harness.supervisor.waitForRequest(id: invalidID))
        XCTAssertEqual(invalidRequest.request.params, invalidParams)
        harness.supervisor.complete(invalidRequest, error: HostError(code: "invalid_params", message: "mainFocused must be a boolean."))
        XCTAssertEqual(try harness.client.waitForResponse(id: invalidID).error?.code, "invalid_params")

        harness.supervisor.emit(snapshot: validSnapshot(), generation: 1)
        let replay = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: 2))
        XCTAssertEqual(replay.request.params, [
            "mainVisible": .bool(true),
            "mainFocused": .bool(false),
            "shelfVisible": .bool(false)
        ])
        harness.supervisor.complete(replay, result: .object([:]))
        XCTAssertNotNil(harness.client.waitForEvent(named: "host.uiStateChanged", after: 0) {
            $0.payload == .object(replay.request.params)
        })

        try assertPatch(["mainFocused": .bool(true)])
        XCTAssertFalse(harness.client.recordedEvents.contains {
            $0.event == "host.uiStateChanged" && $0.payload == .object(invalidParams)
        })
    }

    func testUnavailableUpdateIsRetainedForNextGeneration() throws {
        try assertPatch(["mainVisible": .bool(true)])
        harness.supervisor.emitHealth(.error, generation: 1, error: "child exited", restartCount: 1)
        XCTAssertNotNil(harness.client.waitForEvent(named: "host.snapshotChanged", after: 0) {
            $0.payload["featureService"]?["error"]?.stringValue == "child exited"
        })

        let id = UUID().uuidString
        let params: [String: JSONValue] = ["mainFocused": .bool(true)]
        harness.client.send(HostRequest(id: id, method: "host.setUiState", params: params))
        let request = try XCTUnwrap(harness.supervisor.waitForRequest(id: id))
        harness.supervisor.complete(request, error: HostError(code: "feature_service_unavailable", message: "down"))
        XCTAssertEqual(try harness.client.waitForResponse(id: id).error?.code, "feature_service_unavailable")

        let priorCount = harness.supervisor.requests.count
        harness.supervisor.emitHealth(.starting, generation: 2)
        harness.supervisor.emitHealth(.running, generation: 2)
        harness.supervisor.emit(snapshot: validSnapshot(), generation: 2)
        let replay = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: priorCount))
        XCTAssertEqual(replay.generation, 2)
        XCTAssertEqual(replay.request.params, [
            "mainVisible": .bool(true),
            "mainFocused": .bool(true),
            "shelfVisible": .bool(false)
        ])
    }

    func testOnlyACompleteSnapshotAfterStartingCanTriggerReplay() throws {
        harness.supervisor.emit(event: HostEvent(event: "host.snapshotChanged", revision: 2, payload: .object([
            "featureService": .object(["state": .string("running"), "restartCount": .number(73)])
        ])), generation: 1)
        XCTAssertNotNil(harness.client.waitForEvent(named: "host.snapshotChanged", after: 0) {
            $0.payload["featureService"]?["restartCount"]?.intValue == 73
        })
        XCTAssertEqual(harness.supervisor.requests.filter { $0.request.method == "host.setUiState" }.count, 0)

        harness.supervisor.emit(event: HostEvent(event: "host.snapshotChanged", revision: 3, payload: .object([
            "version": .number(1), "features": .array([]), "marker": .bool(true)
        ])), generation: 1)
        XCTAssertNotNil(harness.client.waitForEvent(named: "host.snapshotChanged", after: 0) { $0.payload["marker"]?.boolValue == true })
        XCTAssertEqual(harness.supervisor.requests.filter { $0.request.method == "host.setUiState" }.count, 0)

        harness.supervisor.emit(snapshot: validSnapshot(), generation: 1)
        XCTAssertNotNil(harness.supervisor.waitForRequest(method: "host.setUiState", after: 0))
    }

    func testFullSnapshotsAfterInitialReplayDoNotStartAnotherReplay() throws {
        harness.supervisor.emit(snapshot: validSnapshot(), generation: 1)
        let replay = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: 0))
        harness.supervisor.complete(replay, result: .object([:]))
        XCTAssertNotNil(harness.client.waitForEvent(named: "host.uiStateChanged", after: 0))

        let eventCount = harness.client.recordedEvents.count
        harness.supervisor.emit(snapshot: validSnapshot(), generation: 1)
        harness.supervisor.emitHealth(.running, generation: 1, restartCount: 9)
        XCTAssertNotNil(harness.client.waitForEvent(named: "host.snapshotChanged", after: eventCount) {
            $0.payload["featureService"]?["restartCount"]?.intValue == 9
        })
        XCTAssertEqual(harness.supervisor.requests.filter { $0.request.method == "host.setUiState" }.count, 1)
    }

    func testStaleAndTerminalGenerationCallbacksCannotCompleteRecovery() throws {
        harness.supervisor.emit(snapshot: validSnapshot(), generation: 1)
        let oldReplay = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: 0))
        harness.supervisor.emitHealth(.error, generation: 1, error: "failed", restartCount: 1)
        harness.supervisor.emitHealth(.running, generation: 1, restartCount: 1)
        harness.supervisor.emit(event: HostEvent(event: "test.stale", revision: 10, payload: .object([:])), generation: 1)
        harness.supervisor.complete(oldReplay, result: .object([:]))
        let eventIndex = harness.client.recordedEvents.count
        harness.supervisor.emitHealth(.starting, generation: 2)
        harness.supervisor.emitHealth(.running, generation: 2)
        XCTAssertNotNil(harness.client.waitForEvent(named: "host.snapshotChanged", after: eventIndex) {
            $0.payload["featureService"]?["state"]?.stringValue == "running" && $0.payload["featureService"]?["restartCount"]?.intValue == 0
        })
        harness.supervisor.emit(snapshot: validSnapshot(), generation: 1)
        harness.supervisor.emit(event: HostEvent(event: "test.stale", revision: 11, payload: .object([:])), generation: 1)
        harness.supervisor.emit(snapshot: validSnapshot(), generation: 2)
        let newReplay = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: 1))
        XCTAssertEqual(newReplay.generation, 2)
        XCTAssertFalse(harness.client.recordedEvents.contains { $0.event == "test.stale" })
        XCTAssertFalse(harness.client.recordedEvents.contains {
            $0.event == "host.snapshotChanged" && $0.payload["featureService"]?["state"]?.stringValue == "running" && $0.payload["featureService"]?["restartCount"]?.intValue == 1
        })
    }

    func testStateChangesDuringReplayCoalesceIntoOneTrailingRequest() throws {
        try assertPatch(["mainVisible": .bool(true)])
        harness.supervisor.emit(snapshot: validSnapshot(), generation: 1)
        let first = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: 1))

        try assertPatch(["mainFocused": .bool(true)])
        try assertPatch(["mainVisible": .bool(true)])
        try assertPatch(["shelfVisible": .bool(true)])
        harness.supervisor.complete(first, result: .object([:]))

        let trailing = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: 5))
        XCTAssertEqual(trailing.request.params, [
            "mainVisible": .bool(true),
            "mainFocused": .bool(true),
            "shelfVisible": .bool(true)
        ])
        try assertPatch(["shelfVisible": .bool(true)])
        try assertPatch(["page": .string("settings")])
        try assertPatch([:])
        XCTAssertEqual(harness.supervisor.requestCount(method: "host.setUiState"), 9)
        let allFacts = Set(["mainVisible", "mainFocused", "shelfVisible"])
        XCTAssertFalse(harness.client.recordedEvents.contains {
            $0.event == "host.uiStateChanged" && Set($0.payload.objectValue?.keys ?? Dictionary<String, JSONValue>().keys) == allFacts
        })

        harness.supervisor.complete(trailing, result: .object([:]))
        let restored = try XCTUnwrap(harness.client.waitForEvent(named: "host.uiStateChanged", after: 0) {
            Set($0.payload.objectValue?.keys ?? Dictionary<String, JSONValue>().keys) == allFacts
        })
        XCTAssertEqual(restored.payload, .object(trailing.request.params))
        XCTAssertEqual(harness.supervisor.requestCount(method: "host.setUiState"), 9)
        XCTAssertEqual(harness.supervisor.requests.filter { Set($0.request.params.keys) == allFacts }.count, 2)
    }

    func testProductErrorsDoNotLoopAndTransportFailureWaitsForNextGeneration() throws {
        harness.supervisor.emit(snapshot: validSnapshot(), generation: 1)
        let initial = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: 0))
        harness.supervisor.complete(initial, error: HostError(code: "amove_failed", message: "policy failed"))
        var markedSnapshot = try XCTUnwrap(validSnapshot().objectValue)
        markedSnapshot["marker"] = .bool(true)
        harness.supervisor.emit(event: HostEvent(event: "host.snapshotChanged", revision: 2, payload: .object(markedSnapshot)), generation: 1)
        XCTAssertNotNil(harness.client.waitForEvent(named: "host.snapshotChanged", after: 0) { $0.payload["marker"]?.boolValue == true })
        XCTAssertEqual(harness.supervisor.requestCount(method: "host.setUiState"), 1)
        XCTAssertFalse(harness.client.recordedEvents.contains { $0.event == "host.uiStateChanged" })

        harness.supervisor.emitHealth(.error, generation: 1, error: "restart", restartCount: 1)
        XCTAssertNotNil(harness.client.waitForEvent(named: "host.snapshotChanged", after: 0) {
            $0.payload["featureService"]?["error"]?.stringValue == "restart"
        })
        harness.supervisor.emitHealth(.starting, generation: 2)
        harness.supervisor.emitHealth(.running, generation: 2)
        harness.supervisor.emit(snapshot: validSnapshot(), generation: 2)
        let second = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: 1))
        try assertPatch(["mainFocused": .bool(true)])
        harness.supervisor.complete(second, error: HostError(code: "amove_failed", message: "policy failed"))
        let trailing = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: 3))
        XCTAssertEqual(trailing.request.params["mainFocused"], .bool(true))
        harness.supervisor.complete(trailing, error: HostError(code: "amove_failed", message: "policy failed again"))
        XCTAssertEqual(harness.supervisor.requestCount(method: "host.setUiState"), 4)

        harness.supervisor.emitHealth(.error, generation: 2, error: "restart", restartCount: 2)
        harness.supervisor.emitHealth(.starting, generation: 3)
        harness.supervisor.emit(snapshot: validSnapshot(), generation: 3)
        let transportFailure = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: 4))
        harness.supervisor.complete(transportFailure, error: HostError(code: "feature_service_crashed", message: "child exited"))
        harness.supervisor.emitHealth(.starting, generation: 4)
        harness.supervisor.emit(snapshot: validSnapshot(), generation: 4)
        let recovered = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: 5))
        XCTAssertEqual(recovered.generation, 4)
        harness.supervisor.complete(recovered, result: .object([:]))
        XCTAssertNotNil(harness.client.waitForEvent(named: "host.uiStateChanged", after: 0))
    }

    func testSuccessfulReplayUsesIncreasingParentRevisionAndExistingPayload() throws {
        try assertPatch(["mainVisible": .bool(true)])
        let partialEvent = try XCTUnwrap(harness.client.waitForEvent(named: "host.uiStateChanged", after: 0))
        harness.supervisor.emit(snapshot: validSnapshot(), generation: 1)
        let replay = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: 1))
        harness.supervisor.complete(replay, result: .object([:]))
        let restored = try XCTUnwrap(harness.client.waitForEvent(named: "host.uiStateChanged", after: 1) {
            $0.payload == .object(replay.request.params)
        })
        XCTAssertGreaterThan(restored.revision, partialEvent.revision)
        XCTAssertEqual(Set(restored.payload.objectValue?.keys ?? Dictionary<String, JSONValue>().keys), Set(["mainVisible", "mainFocused", "shelfVisible"]))
    }

    func testDesktopExitResetUpdatesRecoveryCopyBeforeForwarding() throws {
        try assertPatch(["mainVisible": .bool(true)])
        try assertPatch(["mainFocused": .bool(true)])
        try assertPatch(["shelfVisible": .bool(true)])
        let requestIndex = harness.supervisor.requests.count
        harness.application.desktopApplicationExited()
        let reset = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: requestIndex))
        XCTAssertEqual(reset.request.params, [
            "mainVisible": .bool(false),
            "mainFocused": .bool(false),
            "shelfVisible": .bool(false)
        ])
        harness.supervisor.complete(reset, error: HostError(code: "feature_service_unavailable", message: "down"))

        harness.supervisor.emitHealth(.error, generation: 1, error: "exited", restartCount: 1)
        XCTAssertNotNil(harness.client.waitForEvent(named: "host.snapshotChanged", after: 0) {
            $0.payload["featureService"]?["error"]?.stringValue == "exited"
        })
        harness.supervisor.emitHealth(.starting, generation: 2)
        harness.supervisor.emit(snapshot: validSnapshot(), generation: 2)
        let replay = try XCTUnwrap(harness.supervisor.waitForRequest(method: "host.setUiState", after: requestIndex + 1))
        XCTAssertEqual(replay.request.params, reset.request.params)
    }

    private func assertPatch(_ params: [String: JSONValue], file: StaticString = #filePath, line: UInt = #line) throws {
        let id = UUID().uuidString
        harness.client.send(HostRequest(id: id, method: "host.setUiState", params: params))
        let captured = try XCTUnwrap(harness.supervisor.waitForRequest(id: id), file: file, line: line)
        XCTAssertEqual(captured.request.params, params, file: file, line: line)
        harness.supervisor.complete(captured, result: .object([:]))
        XCTAssertTrue(try harness.client.waitForResponse(id: id).ok, file: file, line: line)
    }
}

private func validSnapshot() -> JSONValue {
    .object([
        "version": .number(1),
        "revision": .number(1),
        "settings": .object([:]),
        "features": .array([])
    ])
}

private final class HostRecoveryHarness {
    let root: URL
    let supervisor: FakeSupervisor
    let client: LocalHostClient
    fileprivate let application: HostApplication

    init() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("MoirasiaHostRecovery-\(UUID().uuidString)", isDirectory: true)
        let fake = FakeSupervisor()
        supervisor = fake
        let configuration = HostConfiguration(
            applicationPath: "/unused/Moirasia.app",
            iconPath: "",
            userData: root.path,
            featureServicePath: "/unused/MoirasiaFeatureService",
            presence: nil,
            bondedHelperPath: nil,
            shoutDriverPath: nil
        )
        let createdApplication = try HostApplication(configuration: configuration, supervisorFactory: { eventHandler, healthHandler in
            fake.install(eventHandler: eventHandler, healthHandler: healthHandler)
            return fake
        })
        application = createdApplication
        try createdApplication.start()
        do {
            client = try LocalHostClient(socketPath: moirasiaHostSocketPath(userData: root.path), tokenPath: root.appendingPathComponent("runtime/client.token").path)
        } catch {
            createdApplication.applicationWillTerminate(Notification(name: NSApplication.willTerminateNotification))
            try? FileManager.default.removeItem(at: root)
            throw error
        }
    }

    func close() {
        client.close()
        application.applicationWillTerminate(Notification(name: NSApplication.willTerminateNotification))
        try? FileManager.default.removeItem(at: root)
    }
}

private final class FakeSupervisor: FeatureServiceSupervisorDriving {
    struct CapturedRequest {
        let request: HostRequest
        let generation: UInt64
    }

    private struct Pending {
        let captured: CapturedRequest
        let completion: (HostResponse, UInt64) -> Void
    }

    private let condition = NSCondition()
    private var eventHandler: ((HostEvent, UInt64) -> Void)?
    private var healthHandler: ((FeatureServiceSupervisor.HealthState, String?, Int, UInt64) -> Void)?
    private var currentGeneration: UInt64 = 0
    private var storedRequests: [CapturedRequest] = []
    private var pending: [String: Pending] = [:]

    var requests: [CapturedRequest] {
        condition.lock()
        defer { condition.unlock() }
        return storedRequests
    }

    func requestCount(method: String) -> Int {
        condition.lock()
        defer { condition.unlock() }
        return storedRequests.filter { $0.request.method == method }.count
    }

    func install(eventHandler: @escaping (HostEvent, UInt64) -> Void, healthHandler: @escaping (FeatureServiceSupervisor.HealthState, String?, Int, UInt64) -> Void) {
        condition.lock()
        self.eventHandler = eventHandler
        self.healthHandler = healthHandler
        condition.unlock()
    }

    func start() throws {
        emitHealth(.starting, generation: 1)
        emitHealth(.running, generation: 1)
    }

    func stop() {
        condition.lock()
        let generation = currentGeneration
        let callbacks = Array(pending.values)
        pending.removeAll()
        condition.unlock()
        callbacks.forEach { pending in
            pending.completion(HostResponse(id: pending.captured.request.id, error: HostError(code: "feature_service_unavailable", message: "stopped")), pending.captured.generation)
        }
        emitHealth(.stopped, generation: generation)
    }

    func request(_ request: HostRequest, completion: @escaping (HostResponse, UInt64) -> Void) {
        condition.lock()
        let captured = CapturedRequest(request: request, generation: currentGeneration)
        storedRequests.append(captured)
        pending[request.id] = Pending(captured: captured, completion: completion)
        condition.broadcast()
        condition.unlock()
    }

    func emitHealth(_ state: FeatureServiceSupervisor.HealthState, generation: UInt64, error: String? = nil, restartCount: Int = 0) {
        condition.lock()
        if state == .starting { currentGeneration = generation }
        let handler = healthHandler
        condition.broadcast()
        condition.unlock()
        handler?(state, error, restartCount, generation)
    }

    func emit(snapshot: JSONValue, generation: UInt64) {
        let handler = eventHandler
        handler?(HostEvent(event: "host.snapshotChanged", revision: 1, payload: snapshot), generation)
    }

    func emit(event: HostEvent, generation: UInt64) {
        let handler = eventHandler
        handler?(event, generation)
    }

    func waitForRequest(id: String, timeout: TimeInterval = 2) -> CapturedRequest? {
        condition.lock()
        defer { condition.unlock() }
        let deadline = Date(timeIntervalSinceNow: timeout)
        while let value = storedRequests.first(where: { $0.request.id == id }) { return value }
        while !condition.wait(until: deadline) {
            if let value = storedRequests.first(where: { $0.request.id == id }) { return value }
        }
        return storedRequests.first(where: { $0.request.id == id })
    }

    func waitForRequestCount(_ count: Int, timeout: TimeInterval = 2) -> Bool {
        condition.lock()
        defer { condition.unlock() }
        let deadline = Date(timeIntervalSinceNow: timeout)
        while storedRequests.count < count {
            guard condition.wait(until: deadline) else { return false }
        }
        return true
    }

    func waitForRequest(method: String, after index: Int, timeout: TimeInterval = 2) -> CapturedRequest? {
        condition.lock()
        defer { condition.unlock() }
        let deadline = Date(timeIntervalSinceNow: timeout)
        while true {
            if let value = storedRequests.dropFirst(index).first(where: { $0.request.method == method }) { return value }
            guard condition.wait(until: deadline) else { return nil }
        }
    }

    func complete(_ captured: CapturedRequest, result: JSONValue) {
        finish(captured, response: HostResponse(id: captured.request.id, result: result))
    }

    func complete(_ captured: CapturedRequest, error: HostError) {
        finish(captured, response: HostResponse(id: captured.request.id, error: error))
    }

    private func finish(_ captured: CapturedRequest, response: HostResponse) {
        condition.lock()
        let value = pending.removeValue(forKey: captured.request.id)
        condition.unlock()
        value?.completion(response, captured.generation)
    }
}

private final class LocalHostClient {
    private let handle: FileHandle
    private let writer: FramedWriter
    private let condition = NSCondition()
    private var decoder = LineDecoder()
    private var responses: [String: HostResponse] = [:]
    private var events: [HostEvent] = []
    private var closed = false

    init(socketPath: String, tokenPath: String) throws {
        let descriptor = try Self.connect(socketPath)
        handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        writer = FramedWriter(handle: handle)
        SafeIO.makeNonBlocking(descriptor)
        handle.readabilityHandler = { [weak self] incoming in
            guard let self else { incoming.readabilityHandler = nil; return }
            guard let result = SafeIO.drain(descriptor: incoming.fileDescriptor) else { return }
            if !result.data.isEmpty { self.receive(result.data) }
            if result.ended { incoming.readabilityHandler = nil }
        }
        let token = try String(contentsOfFile: tokenPath, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        send(HostRequest(id: "authenticate-\(UUID().uuidString)", method: "host.authenticate", params: ["token": .string(token)]))
        let response = try waitForAnyResponse(timeout: 2)
        guard response.ok else { throw NSError(domain: "HostRecoveryTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Host authentication failed."]) }
    }

    func send(_ request: HostRequest) { try? writer.send(.request(request)) }

    func waitForResponse(id: String, timeout: TimeInterval = 2) throws -> HostResponse {
        condition.lock()
        defer { condition.unlock() }
        let deadline = Date(timeIntervalSinceNow: timeout)
        while responses[id] == nil {
            guard condition.wait(until: deadline) else { throw timeoutError("response \(id)") }
        }
        return responses.removeValue(forKey: id)!
    }

    var recordedEvents: [HostEvent] {
        condition.lock()
        defer { condition.unlock() }
        return events
    }

    func waitForEvent(named name: String, after index: Int, timeout: TimeInterval = 2, matching predicate: (HostEvent) -> Bool = { _ in true }) -> HostEvent? {
        condition.lock()
        defer { condition.unlock() }
        let deadline = Date(timeIntervalSinceNow: timeout)
        while true {
            if let event = events.dropFirst(index).first(where: { $0.event == name && predicate($0) }) { return event }
            guard condition.wait(until: deadline) else { return nil }
        }
    }

    func close() {
        condition.lock()
        guard !closed else { condition.unlock(); return }
        closed = true
        condition.unlock()
        handle.readabilityHandler = nil
        try? handle.close()
    }

    private func receive(_ data: Data) {
        do {
            let messages = try decoder.append(data)
            condition.lock()
            for message in messages {
                switch message {
                case .response(let response): responses[response.id] = response
                case .event(let event): events.append(event)
                case .request: break
                }
            }
            condition.broadcast()
            condition.unlock()
        } catch {
            condition.lock()
            condition.broadcast()
            condition.unlock()
        }
    }

    private func waitForAnyResponse(timeout: TimeInterval) throws -> HostResponse {
        condition.lock()
        defer { condition.unlock() }
        let deadline = Date(timeIntervalSinceNow: timeout)
        while responses.isEmpty {
            guard condition.wait(until: deadline) else { throw timeoutError("authentication response") }
        }
        let id = responses.keys.first!
        return responses.removeValue(forKey: id)!
    }

    private static func connect(_ path: String) throws -> Int32 {
        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw posixError() }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8) + [0]
        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        guard bytes.count <= capacity else { Darwin.close(descriptor); throw NSError(domain: "HostRecoveryTests", code: 2) }
        withUnsafeMutableBytes(of: &address.sun_path) { buffer in
            for (index, byte) in bytes.enumerated() { buffer[index] = byte }
        }
        let result = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sa_family_t>.size + bytes.count)) }
        }
        guard result == 0 else { let error = posixError(); Darwin.close(descriptor); throw error }
        return descriptor
    }
}

private func posixError() -> NSError { NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
private func timeoutError(_ operation: String) -> NSError { NSError(domain: "HostRecoveryTests", code: 3, userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for \(operation)."]) }
