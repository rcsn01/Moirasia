import Dispatch
import Foundation
import XCTest
import MoirasiaProtocol
@testable import MoirasiaFeatureService

final class FeatureRuntimeTests: XCTestCase {
    func testUiStateRoutesOnlyRelevantFieldsAndResetsAllFacts() throws {
        let amove = FakeFeatureModule(id: "amove", snapshot: .object([:]))
        let bonded = FakeFeatureModule(id: "bonded", snapshot: .object([:]))
        let fixture = try FeatureRuntimeFixture(modules: [amove, bonded])
        try amove.start()
        try bonded.start()

        XCTAssertTrue(fixture.setUiState(id: "visible", params: ["mainVisible": .bool(true)]).ok)
        XCTAssertEqual(amove.requests.count, 0)
        XCTAssertEqual(bonded.requests.last?.method, "bonded.setUiState")
        XCTAssertEqual(bonded.requests.last?.id, "visible")
        XCTAssertEqual(bonded.requests.last?.params, ["mainVisible": .bool(true)])

        XCTAssertTrue(fixture.setUiState(id: "focus", params: ["mainFocused": .bool(true)]).ok)
        XCTAssertEqual(amove.requests.last?.params, ["mainFocused": .bool(true), "shelfVisible": .bool(false)])
        XCTAssertEqual(amove.requests.last?.id, "focus")
        XCTAssertEqual(bonded.requests.count, 1)

        XCTAssertTrue(fixture.setUiState(id: "shelf", params: ["shelfVisible": .bool(true)]).ok)
        XCTAssertEqual(amove.requests.last?.params, ["mainFocused": .bool(true), "shelfVisible": .bool(true)])
        XCTAssertEqual(bonded.requests.count, 1)

        var order: [String] = []
        amove.onHandle = { _ in order.append("amove"); return .object([:]) }
        bonded.onHandle = { _ in order.append("bonded"); return .object([:]) }
        XCTAssertTrue(fixture.setUiState(id: "both", params: [
            "mainVisible": .bool(false), "mainFocused": .bool(false), "shelfVisible": .bool(false)
        ]).ok)
        XCTAssertEqual(order, ["amove", "bonded"])
        XCTAssertEqual(amove.requests.last?.id, "both")
        XCTAssertEqual(bonded.requests.last?.id, "both")
        XCTAssertEqual(amove.requests.last?.params, ["mainFocused": .bool(false), "shelfVisible": .bool(false)])
        XCTAssertEqual(bonded.requests.last?.params, ["mainVisible": .bool(false)])

        XCTAssertTrue(fixture.setUiState(id: "desktop-entry", params: [
            "mainVisible": .bool(true), "mainFocused": .bool(true), "shelfVisible": .bool(true)
        ]).ok)
        XCTAssertTrue(fixture.setUiState(id: "desktop-exit", params: [
            "mainVisible": .bool(false), "mainFocused": .bool(false), "shelfVisible": .bool(false)
        ]).ok)
        XCTAssertEqual(amove.requests.last?.params, ["mainFocused": .bool(false), "shelfVisible": .bool(false)])
        XCTAssertEqual(bonded.requests.last?.params, ["mainVisible": .bool(false)])
    }

    func testUiStateMergesPartialAndIgnoresUnrelatedOrEmptyRequests() throws {
        let amove = FakeFeatureModule(id: "amove", snapshot: .object([:]))
        let bonded = FakeFeatureModule(id: "bonded", snapshot: .object([:]))
        let fixture = try FeatureRuntimeFixture(modules: [amove, bonded])
        try amove.start()
        try bonded.start()

        XCTAssertTrue(fixture.setUiState(id: "focus", params: ["mainFocused": .bool(true)]).ok)
        XCTAssertEqual(amove.requests.last?.params, ["mainFocused": .bool(true), "shelfVisible": .bool(false)])
        XCTAssertTrue(fixture.setUiState(id: "shelf", params: ["shelfVisible": .bool(true)]).ok)
        XCTAssertEqual(amove.requests.last?.params, ["mainFocused": .bool(true), "shelfVisible": .bool(true)])

        let requestCount = amove.requests.count + bonded.requests.count
        XCTAssertTrue(fixture.setUiState(id: "page", params: ["page": .string("settings")]).ok)
        XCTAssertTrue(fixture.setUiState(id: "empty", params: [:]).ok)
        XCTAssertEqual(amove.requests.count + bonded.requests.count, requestCount)
        XCTAssertEqual(fixture.recorder.events(named: "host.snapshotChanged").count, 0)
    }

    func testUiStateValidatesAllRecognizedFieldsBeforeApplyingAnything() throws {
        let amove = FakeFeatureModule(id: "amove", snapshot: .object([:]))
        let bonded = FakeFeatureModule(id: "bonded", snapshot: .object([:]))
        let fixture = try FeatureRuntimeFixture(modules: [amove, bonded])
        try amove.start()
        try bonded.start()
        let invalidValues: [JSONValue] = [.null, .number(7), .string("true"), .array([]), .object([:])]
        let mixedFields: [(invalid: String, valid: String)] = [
            ("mainVisible", "mainFocused"),
            ("mainFocused", "shelfVisible"),
            ("shelfVisible", "mainFocused")
        ]

        XCTAssertTrue(fixture.setUiState(id: "baseline", params: [
            "mainVisible": .bool(true), "mainFocused": .bool(true), "shelfVisible": .bool(true)
        ]).ok)
        for field in mixedFields {
            for invalidValue in invalidValues {
                XCTAssertTrue(fixture.setUiState(id: "baseline-\(field.invalid)", params: [
                    "mainVisible": .bool(true), "mainFocused": .bool(true), "shelfVisible": .bool(true)
                ]).ok)
                amove.removeRequests()
                bonded.removeRequests()

                let response = fixture.setUiState(id: "invalid-\(field.invalid)", params: [
                    field.invalid: invalidValue, field.valid: .bool(false)
                ])
                XCTAssertEqual(response.error?.code, "invalid_params")
                XCTAssertEqual(response.error?.message, "\(field.invalid) must be a boolean.")
                XCTAssertTrue(amove.requests.isEmpty)
                XCTAssertTrue(bonded.requests.isEmpty)

                try amove.stop()
                try bonded.stop()
                XCTAssertTrue(fixture.startFeature(id: "amove").ok)
                XCTAssertTrue(fixture.startFeature(id: "bonded").ok)
                XCTAssertEqual(amove.requests.last?.params, ["mainFocused": .bool(true), "shelfVisible": .bool(true)])
                XCTAssertEqual(bonded.requests.last?.params, ["mainVisible": .bool(true)])
            }
        }

        amove.removeRequests()
        bonded.removeRequests()
        XCTAssertTrue(fixture.setUiState(id: "valid-focus", params: ["mainFocused": .bool(false)]).ok)
        XCTAssertEqual(amove.requests.last?.params, ["mainFocused": .bool(false), "shelfVisible": .bool(true)])
        XCTAssertTrue(fixture.setUiState(id: "valid-visibility", params: ["mainVisible": .bool(false)]).ok)
        XCTAssertEqual(bonded.requests.last?.params, ["mainVisible": .bool(false)])
    }

    func testStoppedModulesReceiveLatestRetainedStateOnStartupReplay() throws {
        let amove = FakeFeatureModule(id: "amove", snapshot: .object([:]))
        let bonded = FakeFeatureModule(id: "bonded", snapshot: .object([:]))
        let shout = FakeFeatureModule(id: "shout", snapshot: .object([:]))
        let fixture = try FeatureRuntimeFixture(modules: [amove, bonded, shout])

        XCTAssertTrue(fixture.setUiState(id: "visible", params: ["mainVisible": .bool(true)]).ok)
        XCTAssertTrue(fixture.setUiState(id: "focus", params: ["mainFocused": .bool(true)]).ok)
        XCTAssertTrue(fixture.setUiState(id: "shelf", params: ["shelfVisible": .bool(true)]).ok)
        XCTAssertTrue(amove.requests.isEmpty)
        XCTAssertTrue(bonded.requests.isEmpty)
        XCTAssertTrue(shout.requests.isEmpty)

        XCTAssertTrue(fixture.startFeature(id: "amove").ok)
        XCTAssertTrue(fixture.startFeature(id: "bonded").ok)
        XCTAssertTrue(fixture.startFeature(id: "shout").ok)
        XCTAssertEqual(amove.requests.map(\.method), ["amove.setUiState"])
        XCTAssertEqual(amove.requests.last?.params, ["mainFocused": .bool(true), "shelfVisible": .bool(true)])
        XCTAssertNotEqual(amove.requests.last?.id, "shelf")
        XCTAssertEqual(bonded.requests.map(\.method), ["bonded.setUiState"])
        XCTAssertEqual(bonded.requests.last?.params, ["mainVisible": .bool(true)])
        XCTAssertEqual(shout.requests.count, 0)

        let freshAmove = FakeFeatureModule(id: "amove", snapshot: .object([:]))
        let freshBonded = FakeFeatureModule(id: "bonded", snapshot: .object([:]))
        let fresh = try FeatureRuntimeFixture(modules: [freshAmove, freshBonded])
        XCTAssertTrue(fresh.startFeature(id: "amove").ok)
        XCTAssertTrue(fresh.startFeature(id: "bonded").ok)
        XCTAssertEqual(freshAmove.requests.last?.params, ["mainFocused": .bool(false), "shelfVisible": .bool(false)])
        XCTAssertEqual(freshBonded.requests.last?.params, ["mainVisible": .bool(false)])
    }

    func testUiStateFailuresAreIndependentAndPublishOnlyChangedErrors() throws {
        let amove = FakeFeatureModule(id: "amove", snapshot: .object([:]))
        let bonded = FakeFeatureModule(id: "bonded", snapshot: .object([:]))
        let fixture = try FeatureRuntimeFixture(modules: [amove, bonded])
        try amove.start()
        try bonded.start()
        var amoveError: Error? = HostError(code: "amove_failed", message: "Amove failed first.")
        var bondedError: Error?
        var order: [String] = []
        amove.onHandle = { _ in
            order.append("amove")
            if let amoveError { throw amoveError }
            return .object([:])
        }
        bonded.onHandle = { _ in
            order.append("bonded")
            if let bondedError { throw bondedError }
            return .object([:])
        }
        let both = ["mainFocused": JSONValue.bool(true), "mainVisible": .bool(true)]

        let first = fixture.setUiState(id: "first-error", params: both)
        XCTAssertEqual(first.error?.code, "amove_failed")
        XCTAssertEqual(first.error?.message, "Amove failed first.")
        XCTAssertEqual(order, ["amove", "bonded"])
        XCTAssertEqual(fixture.recorder.events(named: "host.snapshotChanged").count, 1)
        XCTAssertEqual(fixture.statusError(id: "amove", from: fixture.recorder.events(named: "host.snapshotChanged").last), "Amove failed first.")
        XCTAssertNil(fixture.statusError(id: "bonded", from: fixture.recorder.events(named: "host.snapshotChanged").last))

        amoveError = HostError(code: "amove_failed", message: "Amove failed again.")
        bondedError = HostError(code: "bonded_failed", message: "Bonded failed.")
        order.removeAll()
        let bothFail = fixture.setUiState(id: "two-errors", params: both)
        XCTAssertEqual(bothFail.error?.code, "amove_failed")
        XCTAssertEqual(bothFail.error?.message, "Amove failed again.")
        XCTAssertEqual(order, ["amove", "bonded"])
        XCTAssertEqual(fixture.recorder.events(named: "host.snapshotChanged").count, 2)
        let failureSnapshot = fixture.recorder.events(named: "host.snapshotChanged").last
        XCTAssertEqual(fixture.statusError(id: "amove", from: failureSnapshot), "Amove failed again.")
        XCTAssertEqual(fixture.statusError(id: "bonded", from: failureSnapshot), "Bonded failed.")

        _ = fixture.setUiState(id: "same-errors", params: both)
        XCTAssertEqual(fixture.recorder.events(named: "host.snapshotChanged").count, 2)

        amoveError = NSError(domain: "FeatureRuntimeTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Amove threw a regular error."])
        bondedError = nil
        let regularError = fixture.setUiState(id: "regular-error", params: both)
        XCTAssertEqual(regularError.error?.code, "feature_failed")
        XCTAssertEqual(regularError.error?.message, "Amove threw a regular error.")
        XCTAssertEqual(fixture.recorder.events(named: "host.snapshotChanged").count, 3)
    }

    func testUiStateErrorsClearWhenRepeatedDesiredValuesSucceed() throws {
        let amove = FakeFeatureModule(id: "amove", snapshot: .object([:]))
        let bonded = FakeFeatureModule(id: "bonded", snapshot: .object([:]))
        let fixture = try FeatureRuntimeFixture(modules: [amove, bonded])
        try amove.start()
        try bonded.start()
        var shouldFail = true
        amove.onHandle = { _ in
            if shouldFail { throw HostError(code: "amove_failed", message: "Amove failed.") }
            return .object([:])
        }
        bonded.onHandle = { _ in
            if shouldFail { throw HostError(code: "bonded_failed", message: "Bonded failed.") }
            return .object([:])
        }
        let repeatedState = ["mainFocused": JSONValue.bool(true), "mainVisible": .bool(true)]

        _ = fixture.setUiState(id: "failure", params: repeatedState)
        XCTAssertEqual(fixture.recorder.events(named: "host.snapshotChanged").count, 1)
        let amoveCalls = amove.requests.count
        let bondedCalls = bonded.requests.count
        shouldFail = false
        XCTAssertTrue(fixture.setUiState(id: "recovery", params: repeatedState).ok)
        XCTAssertEqual(amove.requests.count, amoveCalls + 1)
        XCTAssertEqual(bonded.requests.count, bondedCalls + 1)
        XCTAssertEqual(fixture.recorder.events(named: "host.snapshotChanged").count, 2)
        let recovered = fixture.recorder.events(named: "host.snapshotChanged").last
        XCTAssertNil(fixture.statusError(id: "amove", from: recovered))
        XCTAssertNil(fixture.statusError(id: "bonded", from: recovered))
    }

    func testStartupReplayFailureStopsModuleAndPreservesOriginalError() throws {
        let amove = FakeFeatureModule(id: "amove", snapshot: .object([:]))
        let fixture = try FeatureRuntimeFixture(modules: [amove])
        XCTAssertTrue(fixture.setUiState(id: "focus", params: ["mainFocused": .bool(true)]).ok)
        let replayError = HostError(code: "replay_failed", message: "Retained focus could not be applied.")
        var failReplay = true
        amove.onHandle = { _ in
            if failReplay { throw replayError }
            return .object([:])
        }

        let failedStart = fixture.startFeature(id: "amove")
        XCTAssertEqual(failedStart.error?.code, "feature_start_failed")
        XCTAssertEqual(failedStart.error?.message, replayError.message)
        XCTAssertEqual(amove.startCount, 1)
        XCTAssertEqual(amove.stopCount, 1)
        XCTAssertFalse(amove.isRunning)
        XCTAssertEqual(fixture.statusError(id: "amove", from: fixture.recorder.events(named: "host.snapshotChanged").last), replayError.message)

        failReplay = false
        let retried = fixture.retryFeature(id: "amove")
        XCTAssertTrue(retried.ok)
        XCTAssertEqual(amove.startCount, 2)
        XCTAssertEqual(amove.requests.count, 2)

        let cleanupFailureModule = FakeFeatureModule(id: "amove", snapshot: .object([:]))
        let cleanupFixture = try FeatureRuntimeFixture(modules: [cleanupFailureModule])
        XCTAssertTrue(cleanupFixture.setUiState(id: "focus", params: ["mainFocused": .bool(true)]).ok)
        let originalError = HostError(code: "replay_failed", message: "Original replay failure.")
        cleanupFailureModule.onHandle = { _ in throw originalError }
        cleanupFailureModule.onStop = { throw HostError(code: "cleanup_failed", message: "Stop also failed.") }
        let cleanupFailedStart = cleanupFixture.startFeature(id: "amove")
        XCTAssertEqual(cleanupFailedStart.error?.code, "feature_start_failed")
        XCTAssertEqual(cleanupFailedStart.error?.message, originalError.message)
        XCTAssertEqual(cleanupFailureModule.stopCount, 1)
        XCTAssertEqual(cleanupFixture.statusError(id: "amove", from: cleanupFixture.recorder.events(named: "host.snapshotChanged").last), originalError.message)

        cleanupFailureModule.onHandle = { _ in .object([:]) }
        cleanupFailureModule.onStop = nil
        XCTAssertTrue(cleanupFixture.retryFeature(id: "amove").ok, "a retry must reacquire the lease after replay cleanup")
    }

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

    @discardableResult
    func setUiState(id: String, params: [String: JSONValue]) -> HostResponse {
        runtime.handle(HostRequest(id: id, method: "host.setUiState", params: params))
    }

    @discardableResult
    func startFeature(id: String) -> HostResponse {
        runtime.handle(HostRequest(id: UUID().uuidString, method: "feature.setInstalled", params: ["id": .string(id), "installed": .bool(true)]))
    }

    @discardableResult
    func retryFeature(id: String) -> HostResponse {
        runtime.handle(HostRequest(id: UUID().uuidString, method: "host.retryFeature", params: ["id": .string(id)]))
    }

    func statusError(id: String, from event: HostEvent?) -> String? {
        guard let features = event?.payload["features"]?.arrayValue,
              let status = features.first(where: { $0["id"]?.stringValue == id }) else { return nil }
        return status["error"]?.stringValue
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
    private let requestLock = NSLock()
    private var storedSnapshot: JSONValue
    private var storedRequests: [HostRequest] = []
    private(set) var startCount = 0
    private(set) var stopCount = 0
    var onHandle: ((HostRequest) throws -> JSONValue)?
    var onStart: (() throws -> Void)?
    var onStop: (() throws -> Void)?

    var requests: [HostRequest] {
        requestLock.lock()
        defer { requestLock.unlock() }
        return storedRequests
    }

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

    func removeRequests() {
        requestLock.lock()
        storedRequests.removeAll()
        requestLock.unlock()
    }

    override func start() throws {
        startCount += 1
        try onStart?()
        try super.start()
    }

    override func handle(_ request: HostRequest) throws -> JSONValue {
        requestLock.lock()
        storedRequests.append(request)
        requestLock.unlock()
        if let onHandle { return try onHandle(request) }
        return try super.handle(request)
    }

    override func stop() throws {
        stopCount += 1
        try onStop?()
        try super.stop()
    }
}
