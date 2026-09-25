import Dispatch
import Foundation
import XCTest
import MoirasiaProtocol
@testable import MoirasiaFeatureService

final class FeatureRuntimeTests: XCTestCase {
    func testConcurrentSemanticCallbacksReturnWithoutBlockingAndEmitOnStateQueue() throws {
        let module = FakeFeatureModule(id: "fake", snapshot: .object(["value": .number(0)]))
        let fixture = try FeatureRuntimeFixture(modules: [module])
        let queueEntered = DispatchSemaphore(value: 0)
        let releaseQueue = DispatchSemaphore(value: 0)
        fixture.stateQueue.async {
            queueEntered.signal()
            releaseQueue.wait()
        }
        XCTAssertEqual(queueEntered.wait(timeout: .now() + 2), .success)

        let callbackCount = 32
        let callbacks = DispatchGroup()
        for index in 0..<callbackCount {
            callbacks.enter()
            DispatchQueue.global().async {
                module.fireEvent("test.semantic.\(index)")
                callbacks.leave()
            }
        }
        let returnedBeforeRelease = callbacks.wait(timeout: .now() + 2) == .success
        releaseQueue.signal()
        if !returnedBeforeRelease { _ = callbacks.wait(timeout: .now() + 2) }

        XCTAssertTrue(returnedBeforeRelease, "off-queue callbacks must enqueue without waiting for FeatureRuntime")
        _ = fixture.snapshotBarrier()

        let records = fixture.recorder.records.filter { $0.event.event.hasPrefix("test.semantic.") }
        XCTAssertEqual(records.count, callbackCount)
        XCTAssertEqual(Set(records.map(\.event.event)).count, callbackCount)
        XCTAssertTrue(records.allSatisfy(\.onStateQueue), "every event must be emitted on the injected serial queue")
        XCTAssertEqual(records.map(\.event.revision), records.map(\.event.revision).sorted())
        XCTAssertTrue(zip(records, records.dropFirst()).allSatisfy { $0.event.revision < $1.event.revision })
    }

    func testCommandSnapshotAndQueuedCallbackPublishOneChangedSnapshot() throws {
        let module = FakeFeatureModule(id: "fake", snapshot: .object(["value": .number(0)]))
        let fixture = try FeatureRuntimeFixture(modules: [module])
        try module.start()
        module.onHandle = { _ in
            let changed = JSONValue.object(["value": .number(1)])
            module.setSnapshot(changed)
            module.fireSnapshot()
            return changed
        }

        let response = fixture.runtime.handle(HostRequest(id: "change", method: "fake.change"))
        XCTAssertTrue(response.ok)
        _ = fixture.snapshotBarrier()

        let snapshots = fixture.recorder.events(named: "fake.snapshot")
        XCTAssertEqual(snapshots.count, 1)
        XCTAssertEqual(snapshots.first?.payload, .object(["value": .number(1)]))
        XCTAssertEqual(snapshots.first?.revision, 1)
    }

    func testSnapshotCacheIsPerFeatureAndOnlySuppressesEqualPayloads() throws {
        let first = FakeFeatureModule(id: "first", snapshot: .object(["value": .number(0)]))
        let second = FakeFeatureModule(id: "second", snapshot: .object(["value": .number(0)]))
        let fixture = try FeatureRuntimeFixture(modules: [first, second])

        first.fireSnapshot()
        second.fireSnapshot()
        _ = fixture.snapshotBarrier()
        XCTAssertEqual(fixture.recorder.events(named: "first.snapshot").count, 1)
        XCTAssertEqual(fixture.recorder.events(named: "second.snapshot").count, 1)

        first.fireSnapshot()
        second.fireSnapshot()
        _ = fixture.snapshotBarrier()
        XCTAssertEqual(fixture.recorder.events(named: "first.snapshot").count, 1)
        XCTAssertEqual(fixture.recorder.events(named: "second.snapshot").count, 1)

        first.setSnapshot(.object(["value": .number(1)]))
        first.fireSnapshot()
        _ = fixture.snapshotBarrier()
        XCTAssertEqual(fixture.recorder.events(named: "first.snapshot").count, 2)
        XCTAssertEqual(fixture.recorder.events(named: "second.snapshot").count, 1)
        XCTAssertEqual(fixture.recorder.events(named: "first.snapshot").last?.payload, .object(["value": .number(1)]))
    }

    func testHostSnapshotsRemainUnconditionalWhenFeatureSnapshotIsEqual() throws {
        let module = FakeFeatureModule(id: "fake", snapshot: .object(["value": .number(0)]))
        let fixture = try FeatureRuntimeFixture(modules: [module])
        try module.start()

        for requestID in ["uninstall-1", "uninstall-2"] {
            let response = fixture.runtime.handle(HostRequest(id: requestID, method: "feature.setInstalled", params: ["id": .string("fake"), "installed": .bool(false)]))
            XCTAssertTrue(response.ok)
        }

        let hostEvents = fixture.recorder.events(named: "host.snapshotChanged")
        XCTAssertEqual(hostEvents.count, 2)
        XCTAssertTrue(hostEvents.allSatisfy { $0.payload["revision"]?.numberValue == Double($0.revision) })
        XCTAssertEqual(fixture.recorder.events(named: "fake.snapshot").count, 1)
    }

    func testSemanticEventsRemainDistinctAndPrecedeRequestResponse() throws {
        let module = FakeFeatureModule(id: "fake", snapshot: .object(["value": .number(0)]))
        let fixture = try FeatureRuntimeFixture(modules: [module])
        try module.start()
        var eventCountWhenHandlerReturns = 0
        module.onHandle = { _ in
            module.fireEvent("ui.toggleShelf")
            module.fireEvent("ui.toggleShelf")
            eventCountWhenHandlerReturns = fixture.recorder.events(named: "ui.toggleShelf").count
            return .object(["accepted": .bool(true)])
        }

        let response = fixture.runtime.handle(HostRequest(id: "perform", method: "fake.perform"))
        XCTAssertTrue(response.ok)
        XCTAssertEqual(eventCountWhenHandlerReturns, 2)
        let events = fixture.recorder.events(named: "ui.toggleShelf")
        XCTAssertEqual(events.count, 2)
        XCTAssertEqual(events.map(\.revision), [1, 2])
    }

    func testSnapshotReadReportsRevisionAfterQueuedEvent() throws {
        let module = FakeFeatureModule(id: "fake", snapshot: .object(["value": .number(0)]))
        let fixture = try FeatureRuntimeFixture(modules: [module])
        module.fireEvent("test.semantic")

        let response = fixture.snapshotBarrier()
        let revision = response.result?["revision"]?.numberValue
        XCTAssertEqual(revision, Double(fixture.recorder.records.last?.event.revision ?? 0))
        XCTAssertEqual(fixture.recorder.records.count, 1, "host.getSnapshot must not emit an event")
    }

    func testShutdownEmitsPriorAndInlineHooksButDropsLateHooks() throws {
        let module = FakeFeatureModule(id: "fake", snapshot: .object(["value": .number(0)]))
        let fixture = try FeatureRuntimeFixture(modules: [module])
        try module.start()
        module.setSnapshot(.object(["value": .number(1)]))
        module.onStop = { module.fireEvent("test.stop-inline") }
        module.fireSnapshot()

        let callbackQueue = DispatchQueue(label: "com.moirasia.feature-service.fake-module.\(UUID().uuidString)")
        let callbackEntered = DispatchSemaphore(value: 0)
        let releaseCallback = DispatchSemaphore(value: 0)
        let callbackFinished = DispatchSemaphore(value: 0)
        callbackQueue.async {
            callbackEntered.signal()
            releaseCallback.wait()
            module.setSnapshot(.object(["value": .number(2)]))
            module.fireEvent("test.late")
            module.fireSnapshot()
            callbackFinished.signal()
        }
        XCTAssertEqual(callbackEntered.wait(timeout: .now() + 2), .success)

        let response = fixture.runtime.handle(HostRequest(id: "prepare", method: "host.prepareToQuit"))
        XCTAssertTrue(response.ok)
        XCTAssertEqual(response.result?["cleanupErrors"]?.arrayValue, [])
        releaseCallback.signal()
        XCTAssertEqual(callbackFinished.wait(timeout: .now() + 2), .success)
        _ = fixture.snapshotBarrier()

        let records = fixture.recorder.records.map(\.event)
        let priorSnapshotIndex = try XCTUnwrap(records.firstIndex { $0.event == "fake.snapshot" })
        let inlineEventIndex = try XCTUnwrap(records.firstIndex { $0.event == "test.stop-inline" })
        let shutdownSnapshotIndex = try XCTUnwrap(records.firstIndex { $0.event == "host.snapshotChanged" })
        XCTAssertLessThan(priorSnapshotIndex, inlineEventIndex)
        XCTAssertLessThan(inlineEventIndex, shutdownSnapshotIndex)
        XCTAssertEqual(records.filter { $0.event == "test.late" }.count, 0)
        XCTAssertEqual(records.filter { $0.event == "fake.snapshot" }.count, 1)
    }

    func testOffQueueSnapshotHookReturnsWithoutBlockingAndPublishesChange() throws {
        let module = FakeFeatureModule(id: "fake", snapshot: .object(["value": .number(0)]))
        let fixture = try FeatureRuntimeFixture(modules: [module])
        let queueEntered = DispatchSemaphore(value: 0)
        let releaseQueue = DispatchSemaphore(value: 0)
        fixture.stateQueue.async {
            queueEntered.signal()
            releaseQueue.wait()
        }
        XCTAssertEqual(queueEntered.wait(timeout: .now() + 2), .success)

        let callbackReturned = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            module.setSnapshot(.object(["value": .number(1)]))
            module.fireSnapshot()
            callbackReturned.signal()
        }
        let returnedBeforeRelease = callbackReturned.wait(timeout: .now() + 2) == .success
        releaseQueue.signal()
        if !returnedBeforeRelease { _ = callbackReturned.wait(timeout: .now() + 2) }

        XCTAssertTrue(returnedBeforeRelease, "snapshot hooks must not wait for FeatureRuntime")
        _ = fixture.snapshotBarrier()
        let snapshots = fixture.recorder.events(named: "fake.snapshot")
        XCTAssertEqual(snapshots.count, 1)
        XCTAssertEqual(snapshots.first?.payload, .object(["value": .number(1)]))
        XCTAssertEqual(snapshots.first?.revision, 1)
    }
}

private final class FeatureRuntimeFixture {
    let stateQueue: DispatchQueue
    let recorder: FeatureEventRecorder
    let runtime: FeatureRuntime
    private let userData: URL

    init(modules: [FakeFeatureModule]) throws {
        stateQueue = DispatchQueue(label: "com.moirasia.feature-service.tests.\(UUID().uuidString)")
        recorder = FeatureEventRecorder(queue: stateQueue)
        userData = FileManager.default.temporaryDirectory.appendingPathComponent("moirasia-feature-runtime-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: userData, withIntermediateDirectories: true)
        let moduleMap = Dictionary(uniqueKeysWithValues: modules.map { ($0.id, $0 as FeatureModule) })
        runtime = FeatureRuntime(userData: userData.path, stateQueue: stateQueue, modules: moduleMap) { [recorder] in
            recorder.record($0)
        }
    }

    deinit { try? FileManager.default.removeItem(at: userData) }

    @discardableResult
    func snapshotBarrier() -> HostResponse {
        runtime.handle(HostRequest(id: UUID().uuidString, method: "host.getSnapshot"))
    }
}

private final class FeatureEventRecorder {
    struct Record {
        let event: HostEvent
        let onStateQueue: Bool
    }

    private let lock = NSLock()
    private let queueKey = DispatchSpecificKey<Bool>()
    private var storedRecords: [Record] = []

    init(queue: DispatchQueue) { queue.setSpecific(key: queueKey, value: true) }

    var records: [Record] {
        lock.lock()
        defer { lock.unlock() }
        return storedRecords
    }

    func events(named name: String) -> [HostEvent] { records.map(\.event).filter { $0.event == name } }

    func record(_ event: HostEvent) {
        let record = Record(event: event, onStateQueue: DispatchQueue.getSpecific(key: queueKey) == true)
        lock.lock()
        storedRecords.append(record)
        lock.unlock()
    }
}

private final class FakeFeatureModule: BasicFeatureModule {
    private let snapshotLock = NSLock()
    private var storedSnapshot: JSONValue
    var onHandle: ((HostRequest) throws -> JSONValue)?
    var onStop: (() -> Void)?

    init(id: String, snapshot: JSONValue) {
        storedSnapshot = snapshot
        super.init(id: id)
    }

    override func snapshot() -> JSONValue {
        snapshotLock.lock()
        defer { snapshotLock.unlock() }
        return storedSnapshot
    }

    func setSnapshot(_ snapshot: JSONValue) {
        snapshotLock.lock()
        storedSnapshot = snapshot
        snapshotLock.unlock()
    }

    func fireSnapshot() { publishHook?() }
    func fireEvent(_ name: String) { eventHook?(name) }

    override func handle(_ request: HostRequest) throws -> JSONValue {
        if let onHandle { return try onHandle(request) }
        return try super.handle(request)
    }

    override func stop() throws {
        onStop?()
        try super.stop()
    }
}
