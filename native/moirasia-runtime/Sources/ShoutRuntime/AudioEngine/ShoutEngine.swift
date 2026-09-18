import Foundation
import CoreAudio
import ShoutAudioCore

// The HAL engine: discovers devices, captures the physical microphone, renders
// the boosted signal into the virtual Shout Mic device, watches for changes,
// and reports state/events over the helper protocol.
//
// Threading model: every non-realtime decision runs on one serial `queue`.
// The two IOProcs (capture on the physical mic, render on the Shout Mic) touch
// only the lock-free ring, atomics, and their own scratch buffers — never
// `state` or other queue-guarded members. HAL plumbing lives in ShoutHalIO.swift.

final class ShoutEngine {
    static let shoutMicUID = "ShoutMic_UID"
    static let ringCapacity = 4096
    /// 10 ms trim chunk at a 48 kHz destination.
    static let driftChunkFrames = 480

    private(set) var emit: (HelperEvent) -> Void
    let queue = DispatchQueue(label: "com.opense.shout.helper.engine")

    // Queue-guarded state.
    var state = HelperState(shoutMicUid: ShoutEngine.shoutMicUID)
    var devices: [AudioDeviceSnapshot] = []
    var deviceIDsByUID: [String: AudioObjectID] = [:]
    var lastPhysicalDefaultUID: String?
    let defaultInput: DefaultInputController

    // IO objects (queue-guarded references).
    var captureDeviceID: AudioObjectID = 0
    var captureProcID: AudioDeviceIOProcID?
    var renderDeviceID: AudioObjectID = 0
    var renderProcID: AudioDeviceIOProcID?
    var sourceRate: Double = 48000
    var destinationRate: Double = 48000
    /// Source stream format (read by the capture callback; written before
    /// AudioDeviceStart publishes them to the realtime thread).
    var sourceBitsPerChannel = 32
    var sourceIsFloat = true
    var sourceIsInterleaved = false
    /// Render stream format (read by the render callback; written before start).
    var renderBytesPerSample = 4

    // Realtime path (lock-free; IOProcs only).
    let ring = SpscRingBuffer(capacity: ShoutEngine.ringCapacity, channelCount: 2)
    var resampler = LinearResampler(sourceRate: 48000, destRate: 48000)
    var drift = DriftController()
    let gainBits = Atomic<UInt64>(0)       // Float64 bit pattern of the linear gain
    let limiterEnabled = Atomic<UInt32>(1)
    let meterPeakBits = Atomic<UInt64>(0)  // Float64 bit pattern of the post-gain peak
    /// Set by the control queue when the realtime path must be reset; honored
    /// (and cleared) by the render callback so state mutation stays on the
    /// realtime thread.
    let pendingRealtimeReset = Atomic<UInt32>(0)
    // Scratch buffers, each owned by exactly one thread.
    let captureScratch: UnsafeMutablePointer<Float>     // capture IOProc
    let pullScratch: UnsafeMutablePointer<Float>        // render IOProc (ring reads)
    let resamplerScratch: UnsafeMutablePointer<Float>   // render IOProc (resampler out)
    let pendingScratch: UnsafeMutablePointer<Float>     // render IOProc (leftovers)
    var pendingFrameCount = 0                           // render IOProc only
    var pendingReadCursor = 0
    let scratchFrameCapacity = 4096

    // Listener bookkeeping.
    var systemListenersRegistered = false
    var sourceListenerDeviceID: AudioObjectID = 0
    var sourceListenerBlocks: [AudioObjectPropertySelector: AudioObjectPropertyListenerBlock] = [:]
    var shoutListenerBlocks: [AudioObjectPropertySelector: AudioObjectPropertyListenerBlock] = [:]
    var meterTimer: DispatchSourceTimer?

    init(dataDirectory: URL, emit: @escaping (HelperEvent) -> Void) {
        self.emit = emit
        self.defaultInput = DefaultInputController(dataDirectory: dataDirectory)
        self.captureScratch = .allocate(capacity: scratchFrameCapacity * 2)
        self.pullScratch = .allocate(capacity: scratchFrameCapacity * 2)
        self.resamplerScratch = .allocate(capacity: 64 * 2)
        self.pendingScratch = .allocate(capacity: scratchFrameCapacity * 2)
    }

    deinit {
        captureScratch.deallocate()
        pullScratch.deallocate()
        resamplerScratch.deallocate()
        pendingScratch.deallocate()
    }

    var stateSnapshot: HelperState { queue.sync { state } }

    // MARK: Lifecycle

    func start() {
        queue.async { [self] in
            refreshDeviceList()
            emit(.devicesChanged(helperDevices()))
            let defaultUID = defaultInputUID()
            state.defaultInputUid = defaultUID
            state.defaultInputIsShoutMic = defaultUID == Self.shoutMicUID
            if let uid = defaultUID, uid != Self.shoutMicUID {
                lastPhysicalDefaultUID = uid
            }
            registerSystemListeners()
            // Recovery: a previous session that boosted with the default input
            // and died before restoring must not leave Shout Mic as default.
            _ = defaultInput.recoverAtStartup(
                shoutUID: Self.shoutMicUID,
                currentDefaultUID: defaultUID,
                deviceIDForUID: { [self] uid in self.deviceIDsByUID[uid] }
            )
            state.defaultInputUid = defaultInputUID()
            state.defaultInputIsShoutMic = state.defaultInputUid == Self.shoutMicUID
            emitState()
            emit(.defaultInputChanged(state.defaultInputUid))
        }
    }

    func shutdown() {
        queue.sync {
            stopBoost()
            stopMeterTimer()
        }
    }

    // MARK: Command handling

    func handle(_ request: HelperRequest, reply: @escaping (HelperResponse) -> Void) {
        queue.async { [self] in
            reply(perform(request))
        }
    }

    private func perform(_ request: HelperRequest) -> HelperResponse {
        switch request.type {
        case .getState:
            return HelperResponse(id: request.id, ok: true, state: state)
        case .getDevices:
            return HelperResponse(id: request.id, ok: true, devices: helperDevices())
        case .setBoost:
            guard let enabled = request.enabled else {
                return HelperResponse(id: request.id, ok: false, error: "set-boost requires enabled")
            }
            return setBoost(request.id, enabled: enabled)
        case .setGain:
            guard let db = request.db else {
                return HelperResponse(id: request.id, ok: false, error: "set-gain requires db")
            }
            state.gainDb = min(max(db, Gain.minDb), Gain.maxDb)
            gainBits.store(Gain.linear(forDb: state.gainDb).bitPattern, ordering: .releasing)
            emitState()
            return HelperResponse(id: request.id, ok: true, state: state)
        case .setLimiter:
            guard let enabled = request.enabled else {
                return HelperResponse(id: request.id, ok: false, error: "set-limiter requires enabled")
            }
            state.limiterEnabled = enabled
            limiterEnabled.store(enabled ? 1 : 0, ordering: .releasing)
            emitState()
            return HelperResponse(id: request.id, ok: true, state: state)
        case .setSource:
            guard let mode = request.mode else {
                return HelperResponse(id: request.id, ok: false, error: "set-source requires mode")
            }
            state.sourceMode = mode
            state.sourceUid = mode == .device ? request.uid : nil
            reevaluateSource()
            emitState()
            return HelperResponse(id: request.id, ok: true, state: state)
        case .setDefaultInput:
            guard let enabled = request.enabled else {
                return HelperResponse(id: request.id, ok: false, error: "set-default-input requires enabled")
            }
            state.makeDefaultInput = enabled
            applyDefaultInput(enabled: enabled)
            emitState()
            return HelperResponse(id: request.id, ok: true, state: state)
        }
    }

    // MARK: Boost lifecycle

    private func setBoost(_ id: Int, enabled: Bool) -> HelperResponse {
        state.boostEnabled = enabled
        if enabled {
            if deviceIDsByUID[Self.shoutMicUID] == nil {
                state.boostActive = false
                state.captureState = .idle
                emitState()
                return HelperResponse(id: id, ok: false, state: state, error: "shout-mic-not-present")
            }
            startBoost()
        } else {
            stopBoost()
        }
        emitState()
        return HelperResponse(id: id, ok: true, state: state)
    }

    func startBoost() {
        guard let shoutID = deviceIDsByUID[Self.shoutMicUID] else { return }
        if renderProcID == nil {
            do {
                try startRender(shoutID: shoutID)
            } catch {
                state.captureState = .blocked
                state.boostActive = false
                emit(.error("failed to start render: \(error.localizedDescription)"))
                return
            }
        }
        state.boostActive = renderProcID != nil
        destinationRate = nominalRate(of: shoutID) ?? 48000
        reevaluateSource()
        if state.makeDefaultInput {
            applyDefaultInput(enabled: true)
        }
        startMeterTimer()
    }

    func stopBoost() {
        stopCapture()
        stopRender()
        resetRealtimePath()
        if defaultInput.ownsDefault {
            _ = defaultInput.restoreIfNeeded(
                shoutUID: Self.shoutMicUID,
                currentDefaultUID: defaultInputUID(),
                deviceIDForUID: { [self] uid in self.deviceIDsByUID[uid] }
            )
        }
        stopMeterTimer()
        state.boostActive = false
        state.captureState = .idle
        state.activeSourceUid = nil
        state.activeSourceName = nil
        state.defaultInputUid = defaultInputUID()
        state.defaultInputIsShoutMic = state.defaultInputUid == Self.shoutMicUID
    }

    /// Clears the ring/resampler/meter. Only call while both IOProcs are
    /// stopped (AudioDeviceStop is synchronous).
    func resetRealtimePath() {
        ring.reset()
        resampler.reset()
        resampler.correction = 1.0
        drift = DriftController()
        pendingFrameCount = 0
        pendingReadCursor = 0
        meterPeakBits.store(0, ordering: .relaxed)
    }

    private func applyDefaultInput(enabled: Bool) {        if enabled {
            guard state.boostActive, let shoutID = deviceIDsByUID[Self.shoutMicUID] else { return }
            let applied = defaultInput.apply(
                shoutDeviceID: shoutID,
                shoutUID: Self.shoutMicUID,
                currentDefaultUID: defaultInputUID()
            ) { [self] uid in deviceName(forUID: uid) ?? uid }
            if applied {
                state.defaultInputUid = Self.shoutMicUID
                state.defaultInputIsShoutMic = true
                emit(.defaultInputChanged(state.defaultInputUid))
            }
        } else if defaultInput.ownsDefault {
            _ = defaultInput.restoreIfNeeded(
                shoutUID: Self.shoutMicUID,
                currentDefaultUID: defaultInputUID(),
                deviceIDForUID: { [self] uid in self.deviceIDsByUID[uid] }
            )
            state.defaultInputUid = defaultInputUID()
            state.defaultInputIsShoutMic = state.defaultInputUid == Self.shoutMicUID
            emit(.defaultInputChanged(state.defaultInputUid))
        }
    }

    // MARK: Source resolution

    func reevaluateSource() {
        guard state.boostActive else { return }
        let request = SourceRequest(
            mode: state.sourceMode,
            selectedUid: state.sourceUid,
            defaultInputUid: defaultInputUID(),
            lastPhysicalDefaultUid: lastPhysicalDefaultUID,
            devices: devices
        )
        guard let resolved = SourceResolver.resolve(request), let id = deviceIDsByUID[resolved.uid] else {
            stopCapture()
            state.captureState = .noSource
            state.activeSourceUid = nil
            state.activeSourceName = nil
            return
        }
        if captureProcID != nil && captureDeviceID == id {
            state.captureState = .capturing
            return
        }
        do {
            try startCapture(deviceID: id, snapshot: resolved)
        } catch {
            stopCapture()
            state.captureState = .blocked
            state.activeSourceUid = nil
            state.activeSourceName = nil
            emit(.error("failed to capture \(resolved.name): \(error.localizedDescription)"))
        }
    }

    func emitState() {
        emit(.stateChanged(state))
    }

    func helperDevices() -> [HelperDevice] {
        devices.filter { $0.hasInputStream || $0.isShoutMic }.map { HelperDevice(uid: $0.uid, name: $0.name, isShoutMic: $0.isShoutMic, sampleRate: $0.sampleRate) }
    }
}
