import Foundation
import MoirasiaProtocol

/// Owns the parent-side recovery copy of reported host UI state and the
/// replay cycle that restores it after a supervised child restart.
///
/// Contract: every method must be called on the host state queue. The module
/// is not thread-safe. The copy is memory-only; recovery across a full
/// `MoirasiaHost` restart and Electron reconnect resynchronization are
/// outside this module.
final class HostUiStateRecovery {
    enum GenerationObservation {
        case started   // a new child generation is starting
        case running    // the active generation is running
        case ended      // the active generation errored or stopped
    }

    typealias ReplaySender = (HostRequest, UInt64, @escaping (HostResponse, UInt64) -> Void) -> Void
    typealias RestoredAnnouncer = ([String: JSONValue]) -> Void

    private let sendReplay: ReplaySender
    private let announceRestored: RestoredAnnouncer

    private var hostUiState = HostUiState()
    private var activeGeneration: UInt64?
    private var generationTerminal = false
    private var initialSnapshotReceived = false
    private var replayInFlightGeneration: UInt64?
    private var replayStateChanged = false

    init(sendReplay: @escaping ReplaySender, announceRestored: @escaping RestoredAnnouncer) {
        self.sendReplay = sendReplay
        self.announceRestored = announceRestored
    }

    /// Fences stale or terminal generations and drives the first-full-snapshot
    /// replay gate. Returns false when the host must drop the event.
    @discardableResult
    func accept(event: HostEvent, generation: UInt64) -> Bool {
        guard activeGeneration == generation, !generationTerminal else { return false }
        if event.event == "host.snapshotChanged", !initialSnapshotReceived, isFullSnapshot(event.payload) {
            initialSnapshotReceived = true
            startReplay(generation)
        }
        return true
    }

    /// Fences stale observations; a new `.started` resets per-generation state
    /// and `.ended` marks the generation terminal. Returns false when the host
    /// must drop the observation.
    @discardableResult
    func acceptGeneration(_ observation: GenerationObservation, generation: UInt64) -> Bool {
        switch observation {
        case .started:
            if let activeGeneration, generation <= activeGeneration { return false }
            activeGeneration = generation
            generationTerminal = false
            initialSnapshotReceived = false
            replayInFlightGeneration = nil
            replayStateChanged = false
        case .running:
            guard activeGeneration == generation, !generationTerminal else { return false }
        case .ended:
            guard activeGeneration == generation, !generationTerminal else { return false }
            generationTerminal = true
            replayInFlightGeneration = nil
            replayStateChanged = false
        }
        return true
    }

    /// Merges a UI-state patch into the recovery copy. All recognized fields
    /// must be valid or nothing is absorbed; a no-op patch changes nothing.
    func retain(_ params: [String: JSONValue]) {
        let changed: Bool
        do { changed = try hostUiState.apply(params) }
        catch { return }
        guard changed else { return }
        if replayInFlightGeneration != nil { replayStateChanged = true }
    }

    private func isFullSnapshot(_ payload: JSONValue) -> Bool {
        guard let object = payload.objectValue,
              object["version"]?.numberValue == 1,
              object["revision"]?.numberValue != nil,
              object["settings"]?.objectValue != nil,
              object["features"]?.arrayValue != nil else { return false }
        return true
    }

    private func startReplay(_ generation: UInt64) {
        guard activeGeneration == generation, !generationTerminal else { return }
        let request = HostRequest(id: UUID().uuidString, method: "host.setUiState", params: hostUiState.params)
        replayStateChanged = false
        replayInFlightGeneration = generation
        // The host effect hops a supervisor completion back to the state queue;
        // with no supervisor it may instead complete immediately on this thread,
        // re-entering finishReplay below before startReplay returns. That is
        // safe: the completion only clears state this send just set.
        sendReplay(request, generation) { [weak self] response, completionGeneration in
            self?.finishReplay(response, generation: completionGeneration)
        }
    }

    private func finishReplay(_ response: HostResponse, generation: UInt64) {
        guard activeGeneration == generation,
              !generationTerminal,
              replayInFlightGeneration == generation else { return }
        replayInFlightGeneration = nil

        let transportFailure = ["feature_service_crashed", "feature_service_unavailable"].contains(response.error?.code ?? "")
        if transportFailure {
            replayStateChanged = false
            return
        }
        if replayStateChanged {
            replayStateChanged = false
            startReplay(generation)
            return
        }
        guard response.ok else { return }

        announceRestored(hostUiState.params)
    }
}