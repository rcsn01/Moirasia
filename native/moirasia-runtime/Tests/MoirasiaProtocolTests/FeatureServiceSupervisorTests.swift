import Darwin
import Foundation
import XCTest
import MoirasiaProtocol
@testable import MoirasiaHost

final class FeatureServiceSupervisorTests: XCTestCase {
    func testGenerationTagsOldOutputAndPreservesPendingRequestIDsOnExitAndStop() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("MoirasiaSupervisorTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let executable = root.appendingPathComponent("feature-service-fixture")
        try fixtureScript().write(to: executable, atomically: true, encoding: .utf8)
        XCTAssertEqual(chmod(executable.path, 0o700), 0)

        let recorder = SupervisorCallbackRecorder()
        let replacementSnapshot = expectation(description: "replacement snapshot carries generation two")
        let crashCompletion = expectation(description: "crash completion carries the original request ID")
        let replacementRunning = expectation(description: "replacement running health carries generation two")
        let oldOutputWritten = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            FileManager.default.fileExists(atPath: root.appendingPathComponent("old-output-written").path)
        }, object: nil)
        oldOutputWritten.expectationDescription = "delayed old-generation writer finished"

        let oldEvent = expectation(description: "old-generation output is dropped")
        oldEvent.isInverted = true

        var crashResponse: HostResponse?
        var crashGeneration: UInt64?
        let supervisor = FeatureServiceSupervisor(
            executablePath: executable.path,
            userData: root.path,
            bondedHelperExecutable: nil,
            shoutDriverDirectory: nil,
            eventHandler: { event, generation in
                recorder.record(event: event, generation: generation)
                if event.payload["fixture"]?.stringValue == "old" { oldEvent.fulfill() }
                if event.payload["fixture"]?.stringValue == "replacement", generation == 2 { replacementSnapshot.fulfill() }
            },
            exitHandler: {},
            healthHandler: { state, error, restartCount, generation in
                recorder.record(state: state, error: error, restartCount: restartCount, generation: generation)
                if state == .running && generation == 2 { replacementRunning.fulfill() }
            }
        )
        defer { supervisor.stop() }

        try supervisor.start()
        supervisor.request(HostRequest(id: "crash-request", method: "host.setUiState", params: ["mainVisible": .bool(true)])) { response, generation in
            crashResponse = response
            crashGeneration = generation
            crashCompletion.fulfill()
        }

        wait(for: [crashCompletion, replacementSnapshot, replacementRunning], timeout: 5)
        XCTAssertEqual(crashResponse?.id, "crash-request")
        XCTAssertEqual(crashResponse?.error?.code, "feature_service_crashed")
        XCTAssertEqual(crashGeneration, 1)
        XCTAssertTrue(recorder.hasHealth(.starting, generation: 1))
        XCTAssertTrue(recorder.hasHealth(.running, generation: 1))
        XCTAssertTrue(recorder.hasHealth(.error, generation: 1))
        XCTAssertTrue(recorder.hasHealth(.starting, generation: 2))
        XCTAssertTrue(recorder.hasHealth(.running, generation: 2))
        XCTAssertTrue(recorder.events.contains { $0.generation == 2 && $0.event.payload["fixture"]?.stringValue == "replacement" })

        let stopCompletion = expectation(description: "stop completion carries the original request ID")
        var stopResponse: HostResponse?
        var stopGeneration: UInt64?
        supervisor.request(HostRequest(id: "stop-request", method: "host.setUiState", params: ["shelfVisible": .bool(true)])) { response, generation in
            stopResponse = response
            stopGeneration = generation
            stopCompletion.fulfill()
        }
        wait(for: [oldOutputWritten, oldEvent], timeout: 1.5)
        XCTAssertFalse(recorder.events.contains { $0.event.payload["fixture"]?.stringValue == "old" })

        supervisor.stop()
        wait(for: [stopCompletion], timeout: 2)
        XCTAssertEqual(stopResponse?.id, "stop-request")
        XCTAssertEqual(stopResponse?.error?.code, "feature_service_unavailable")
        XCTAssertEqual(stopGeneration, 2)
        XCTAssertTrue(recorder.hasHealth(.stopped, generation: 2))
    }

    private func fixtureScript() -> String {
        let script = #"""
#!/bin/sh
user_data=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--user-data" ]; then user_data="$2"; shift 2; else shift; fi
done
counter="$user_data/launch-count"
count=0
if [ -f "$counter" ]; then count=$(cat "$counter"); fi
count=$((count + 1))
printf '%s' "$count" > "$counter"
if [ "$count" -eq 1 ]; then
  IFS= read -r request || exit 0
  (sleep 0.6; printf '%s\n' '{"version":1,"id":"stop-request","ok":true,"result":{"fixture":"old"}}'; printf '%s\n' '{"version":1,"event":"host.snapshotChanged","revision":99,"payload":{"fixture":"old"}}'; : > "$user_data/old-output-written") &
  exit 0
fi
printf '%s\n' '{"version":1,"event":"host.snapshotChanged","revision":1,"payload":{"version":1,"revision":1,"settings":{},"features":[],"fixture":"replacement"}}'
while IFS= read -r request; do :; done
"""#
        return script
    }
}

private final class SupervisorCallbackRecorder {
    struct EventRecord {
        let event: HostEvent
        let generation: UInt64
    }

    struct HealthRecord {
        let state: FeatureServiceSupervisor.HealthState
        let error: String?
        let restartCount: Int
        let generation: UInt64
    }

    private let lock = NSLock()
    private var storedEvents: [EventRecord] = []
    private var storedHealth: [HealthRecord] = []

    var events: [EventRecord] {
        lock.lock()
        defer { lock.unlock() }
        return storedEvents
    }

    func record(event: HostEvent, generation: UInt64) {
        lock.lock()
        storedEvents.append(EventRecord(event: event, generation: generation))
        lock.unlock()
    }

    func record(state: FeatureServiceSupervisor.HealthState, error: String?, restartCount: Int, generation: UInt64) {
        lock.lock()
        storedHealth.append(HealthRecord(state: state, error: error, restartCount: restartCount, generation: generation))
        lock.unlock()
    }

    func hasHealth(_ state: FeatureServiceSupervisor.HealthState, generation: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return storedHealth.contains { $0.state == state && $0.generation == generation }
    }
}
