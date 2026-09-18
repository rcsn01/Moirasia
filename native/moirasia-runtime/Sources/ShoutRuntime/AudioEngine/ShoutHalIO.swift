import Foundation
import CoreAudio
import ShoutAudioCore

// HAL plumbing for ShoutEngine: device queries, change listeners, the capture
// and render IOProcs, and the meter timer. See ShoutEngine.swift for the
// threading rules this file must respect.

enum EngineError: Error, LocalizedError {
    case hal(String)

    var errorDescription: String? {
        switch self {
        case .hal(let message): return message
        }
    }
}

// MARK: - Device queries

extension ShoutEngine {
    func defaultInputUID() -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var deviceID = AudioObjectID(0)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID) == noErr, deviceID != 0 else {
            return nil
        }
        return stringProperty(deviceID, kAudioDevicePropertyDeviceUID)
    }

    func stringProperty(_ objectID: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>>.size)
        guard AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, &value) == noErr else { return nil }
        return value?.takeRetainedValue() as String?
    }

    func nominalRate(of deviceID: AudioObjectID) -> Double? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyNominalSampleRate,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var rate: Float64 = 0
        var size = UInt32(MemoryLayout<Float64>.size)
        guard AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &rate) == noErr, rate > 0 else { return nil }
        return Double(rate)
    }

    /// Stream format of the device's main stream in the given scope.
    func streamFormat(of deviceID: AudioObjectID, scope: AudioObjectPropertyScope) -> AudioStreamBasicDescription? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamFormat,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        guard AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &asbd) == noErr else { return nil }
        return asbd
    }

    func inputStreamCount(of deviceID: AudioObjectID) -> Int {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreams,
            mScope: kAudioObjectPropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &size) == noErr else { return 0 }
        return Int(size) / MemoryLayout<AudioStreamID>.size
    }

    func deviceIsAliveSafe(_ deviceID: AudioObjectID) -> Bool {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceIsAlive,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var alive: UInt32 = 1
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &alive) == noErr else { return false }
        return alive != 0
    }

    func deviceName(forUID uid: String) -> String? {
        devices.first { $0.uid == uid }?.name
    }

    /// Re-enumerates devices and refreshes the shout-mic presence flag.
    func refreshDeviceList() {
        var snapshots: [AudioDeviceSnapshot] = []
        var idsByUID: [String: AudioObjectID] = [:]
        for id in enumerateDeviceIDs() {
            guard let uid = stringProperty(id, kAudioDevicePropertyDeviceUID), !uid.isEmpty else { continue }
            let name = stringProperty(id, kAudioObjectPropertyName) ?? uid
            let rate = nominalRate(of: id)
            let snapshot = AudioDeviceSnapshot(
                uid: uid,
                name: name,
                hasInputStream: inputStreamCount(of: id) > 0,
                isShoutMic: uid == Self.shoutMicUID,
                sampleRate: rate
            )
            snapshots.append(snapshot)
            idsByUID[uid] = id
        }
        devices = snapshots
        deviceIDsByUID = idsByUID
        state.shoutMicPresent = idsByUID[Self.shoutMicUID] != nil
    }

    private func enumerateDeviceIDs() -> [AudioObjectID] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr, size > 0 else {
            return []
        }
        let count = Int(size) / MemoryLayout<AudioObjectID>.size
        var ids = [AudioObjectID](repeating: 0, count: count)
        var dataSize = size
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &dataSize, &ids) == noErr else {
            return []
        }
        return ids
    }
}

// MARK: - Listeners

extension ShoutEngine {
    func registerSystemListeners() {
        guard !systemListenersRegistered else { return }
        let system = AudioObjectID(kAudioObjectSystemObject)

        let devicesBlock: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            self?.queue.async { self?.handleDeviceListChanged() }
        }
        var devicesAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        AudioObjectAddPropertyListenerBlock(system, &devicesAddress, queue, devicesBlock)

        let defaultBlock: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            self?.queue.async { self?.handleDefaultInputChanged() }
        }
        var defaultAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        AudioObjectAddPropertyListenerBlock(system, &defaultAddress, queue, defaultBlock)

        systemListenersRegistered = true
    }

    func handleDeviceListChanged() {
        let hadShout = state.shoutMicPresent
        let previousActive = state.activeSourceUid
        refreshDeviceList()
        emit(.devicesChanged(helperDevices()))

        if let active = previousActive, deviceIDsByUID[active] == nil {
            reevaluateSource()
        }

        if state.shoutMicPresent != hadShout {
            if state.boostEnabled && !state.shoutMicPresent {
                stopBoost()
            } else if state.boostEnabled && !state.boostActive && state.shoutMicPresent {
                startBoost()
            } else {
                reevaluateSource()
            }
        } else if state.boostEnabled && !state.boostActive && state.shoutMicPresent {
            startBoost()
        } else {
            reevaluateSource()
        }
        emitState()
    }

    func handleDefaultInputChanged() {
        let uid = defaultInputUID()
        let changed = uid != state.defaultInputUid
        state.defaultInputUid = uid
        state.defaultInputIsShoutMic = uid == Self.shoutMicUID
        if let uid, uid != Self.shoutMicUID {
            lastPhysicalDefaultUID = uid
        }
        guard changed else { return }
        reevaluateSource()
        emitState()
        emit(.defaultInputChanged(uid))
    }

    private func addListener(_ deviceID: AudioObjectID, _ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal, block: @escaping AudioObjectPropertyListenerBlock) {
        var address = AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
        AudioObjectAddPropertyListenerBlock(deviceID, &address, queue, block)
    }

    func registerSourceListeners(deviceID: AudioObjectID) {
        removeSourceListeners()
        let aliveBlock: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            self?.queue.async {
                guard let self, self.state.boostActive else { return }
                if self.captureDeviceID == deviceID && !self.deviceIsAliveSafe(deviceID) {
                    self.reevaluateSource()
                    self.emitState()
                }
            }
        }
        addListener(deviceID, kAudioDevicePropertyDeviceIsAlive, block: aliveBlock)

        let rateBlock: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            self?.queue.async { self?.handleSourceRateChanged(deviceID: deviceID) }
        }
        addListener(deviceID, kAudioDevicePropertyNominalSampleRate, block: rateBlock)

        sourceListenerBlocks[kAudioDevicePropertyDeviceIsAlive] = aliveBlock
        sourceListenerBlocks[kAudioDevicePropertyNominalSampleRate] = rateBlock
        sourceListenerDeviceID = deviceID
    }

    func removeSourceListeners() {
        guard sourceListenerDeviceID != 0 else { return }
        for (selector, block) in sourceListenerBlocks {
            var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            AudioObjectRemovePropertyListenerBlock(sourceListenerDeviceID, &address, queue, block)
        }
        sourceListenerBlocks = [:]
        sourceListenerDeviceID = 0
    }

    func registerShoutListeners(deviceID: AudioObjectID) {
        removeShoutListeners()
        let aliveBlock: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            self?.queue.async {
                guard let self, self.state.boostActive else { return }
                if self.renderDeviceID == deviceID && !self.deviceIsAliveSafe(deviceID) {
                    self.stopBoost()
                    self.emitState()
                }
            }
        }
        addListener(deviceID, kAudioDevicePropertyDeviceIsAlive, block: aliveBlock)

        let rateBlock: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            self?.queue.async { self?.restartIOForRateChange() }
        }
        addListener(deviceID, kAudioDevicePropertyNominalSampleRate, block: rateBlock)

        shoutListenerBlocks[kAudioDevicePropertyDeviceIsAlive] = aliveBlock
        shoutListenerBlocks[kAudioDevicePropertyNominalSampleRate] = rateBlock
    }

    func removeShoutListeners() {
        guard renderDeviceID != 0 else { return }
        for (selector, block) in shoutListenerBlocks {
            var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            AudioObjectRemovePropertyListenerBlock(renderDeviceID, &address, queue, block)
        }
        shoutListenerBlocks = [:]
    }

    /// A rate change on either end requires rebuilding the resampler, which is
    /// only safe while both IOProcs are stopped, so restart the whole path.
    func restartIOForRateChange() {
        guard state.boostActive else { return }
        let sourceRateBefore = sourceRate
        let destinationRateBefore = destinationRate
        stopCapture()
        stopRender()
        resetRealtimePath()
        if let shoutID = deviceIDsByUID[Self.shoutMicUID] {
            do {
                try startRender(shoutID: shoutID)
                state.boostActive = renderProcID != nil
                destinationRate = nominalRate(of: shoutID) ?? destinationRate
                reevaluateSource()
            } catch {
                state.boostActive = false
                state.captureState = .blocked
                emit(.error("failed to restart render: \(error.localizedDescription)"))
            }
        } else {
            state.boostActive = false
            state.captureState = .idle
        }
        if sourceRate != sourceRateBefore || destinationRate != destinationRateBefore {
            emitState()
        }
    }

    func handleSourceRateChanged(deviceID: AudioObjectID) {
        let newRate = nominalRate(of: deviceID) ?? sourceRate
        guard abs(newRate - sourceRate) > 0.5 else { return }
        restartIOForRateChange()
    }
}

// MARK: - Capture / render lifecycle

extension ShoutEngine {
    func startCapture(deviceID: AudioObjectID, snapshot: AudioDeviceSnapshot) throws {
        stopCapture()
        // The producer is gone; ask the render thread to reset the shared path
        // at its next cycle (mutation must stay on the realtime thread).
        pendingRealtimeReset.store(1, ordering: .releasing)

        // Record the source stream format before starting IO; these fields are
        // read by the capture callback only, and AudioDeviceStart publishes
        // them to the realtime thread.
        if let asbd = streamFormat(of: deviceID, scope: kAudioObjectPropertyScopeInput) {
            sourceBitsPerChannel = Int(asbd.mBitsPerChannel)
            sourceIsFloat = asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0
            sourceIsInterleaved = asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0
        } else {
            sourceBitsPerChannel = 32
            sourceIsFloat = true
            sourceIsInterleaved = false
        }

        let captureProc: AudioDeviceIOProc = { _, _, inputData, _, _, _, clientData in
            guard let clientData else { return 0 }
            let engine = Unmanaged<ShoutEngine>.fromOpaque(clientData).takeUnretainedValue()
            engine.captureCallback(inputData: inputData)
            return 0
        }
        var procID: AudioDeviceIOProcID?
        let createStatus = AudioDeviceCreateIOProcID(deviceID, captureProc, Unmanaged.passUnretained(self).toOpaque(), &procID)
        guard createStatus == noErr, let procID else {
            throw EngineError.hal("AudioDeviceCreateIOProcID failed: \(createStatus)")
        }
        let startStatus = AudioDeviceStart(deviceID, procID)
        guard startStatus == noErr else {
            AudioDeviceDestroyIOProcID(deviceID, procID)
            throw EngineError.hal("AudioDeviceStart failed: \(startStatus)")
        }
        captureDeviceID = deviceID
        captureProcID = procID
        sourceRate = nominalRate(of: deviceID) ?? snapshot.sampleRate ?? 48000
        state.captureState = .capturing
        state.activeSourceUid = snapshot.uid
        state.activeSourceName = snapshot.name
        registerSourceListeners(deviceID: deviceID)
    }

    func stopCapture() {
        if let procID = captureProcID, captureDeviceID != 0 {
            AudioDeviceStop(captureDeviceID, procID)
            AudioDeviceDestroyIOProcID(captureDeviceID, procID)
        }
        removeSourceListeners()
        captureProcID = nil
        captureDeviceID = 0
    }

    func startRender(shoutID: AudioObjectID) throws {
        stopRender()
        // Record the virtual device's stream format for the render writer.
        if let asbd = streamFormat(of: shoutID, scope: kAudioObjectPropertyScopeOutput) {
            renderBytesPerSample = max(Int(asbd.mBitsPerChannel) / 8, 2)
        } else {
            renderBytesPerSample = 4
        }

        let renderProc: AudioDeviceIOProc = { _, _, _, _, outputData, _, clientData in
            guard let clientData else { return 0 }
            let engine = Unmanaged<ShoutEngine>.fromOpaque(clientData).takeUnretainedValue()
            engine.renderCallback(outputData: outputData)
            return 0
        }
        var procID: AudioDeviceIOProcID?
        let createStatus = AudioDeviceCreateIOProcID(shoutID, renderProc, Unmanaged.passUnretained(self).toOpaque(), &procID)
        guard createStatus == noErr, let procID else {
            throw EngineError.hal("AudioDeviceCreateIOProcID (render) failed: \(createStatus)")
        }
        let startStatus = AudioDeviceStart(shoutID, procID)
        guard startStatus == noErr else {
            AudioDeviceDestroyIOProcID(shoutID, procID)
            throw EngineError.hal("AudioDeviceStart (render) failed: \(startStatus)")
        }
        renderDeviceID = shoutID
        renderProcID = procID
        registerShoutListeners(deviceID: shoutID)
    }

    func stopRender() {
        if let procID = renderProcID, renderDeviceID != 0 {
            AudioDeviceStop(renderDeviceID, procID)
            AudioDeviceDestroyIOProcID(renderDeviceID, procID)
        }
        removeShoutListeners()
        renderProcID = nil
        renderDeviceID = 0
    }
}

// MARK: - Realtime callbacks

extension ShoutEngine {
    /// Runs on the capture IOProc's realtime thread. Converts the incoming
    /// buffer list to interleaved stereo and pushes it into the ring.
    func captureCallback(inputData: UnsafePointer<AudioBufferList>) {
        let bytesPerSample = max(sourceBitsPerChannel / 8, 1)
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
        guard let firstBuffer = buffers.first, firstBuffer.mData != nil, firstBuffer.mNumberChannels > 0 else { return }
        let channels = Int(firstBuffer.mNumberChannels)
        let frames = Int(firstBuffer.mDataByteSize) / (channels * bytesPerSample)
        guard frames > 0, frames <= scratchFrameCapacity else { return }
        let deinterleaved = !sourceIsInterleaved || buffers.count > 1
        let mono = channels == 1

        for frame in 0..<frames {
            for c in 0..<2 {
                let value: Float
                if deinterleaved {
                    let buffer = buffers[min(c, buffers.count - 1)]
                    let chInBuffer = max(Int(buffer.mNumberChannels), 1)
                    value = readSample(buffer, offset: frame * chInBuffer)
                } else {
                    let offset = frame * channels + (mono ? 0 : c)
                    value = readSample(firstBuffer, offset: offset)
                }
                captureScratch[frame * 2 + c] = value
            }
        }
        ring.write(from: captureScratch, frameCount: frames)
    }

    /// Runs on the render IOProc's realtime thread. Pulls mic frames from the
    /// ring, resamples to the device rate, applies gain + limiter, and fills
    /// the output buffer list.
    func renderCallback(outputData: UnsafeMutablePointer<AudioBufferList>) {
        // Honor reset requests from the control queue at a safe point.
        if pendingRealtimeReset.exchange(0, ordering: .acquiring) == 1 {
            ring.reset()
            resampler.reset()
            resampler.correction = 1.0
            drift = DriftController()
            pendingFrameCount = 0
            pendingReadCursor = 0
        }

        let bytesPerSample = max(renderBytesPerSample, 1)
        let buffers = UnsafeMutableAudioBufferListPointer(outputData)
        guard let firstBuffer = buffers.first, firstBuffer.mData != nil, firstBuffer.mNumberChannels > 0 else { return }
        let channels = Int(firstBuffer.mNumberChannels)
        let frames = Int(firstBuffer.mDataByteSize) / (channels * bytesPerSample)
        guard frames > 0 else { return }
        // Unused channels stay zero.
        for buffer in buffers {
            if let data = buffer.mData {
                memset(data, 0, Int(buffer.mDataByteSize))
            }
        }

        let nowSeconds = Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000_000
        let action = drift.update(
            occupancyFrames: ring.availableFrames,
            capacityFrames: Self.ringCapacity,
            chunkFrames: Self.driftChunkFrames,
            nowSeconds: nowSeconds
        )
        resampler.correction = drift.correction
        if action.trimFrames > 0 {
            _ = ring.discardOldest(upTo: action.trimFrames)
        }

        let gain = Double(bitPattern: gainBits.load(ordering: .acquiring))
        let limiterOn = limiterEnabled.load(ordering: .acquiring) != 0
        var peak = 0.0
        var written = 0

        // Serve processed leftovers from previous cycles first.
        while written < frames && pendingReadCursor < pendingFrameCount {
            writeRenderSample(buffers, bytesPerSample: bytesPerSample, frame: written,
                              left: pendingScratch[pendingReadCursor * 2], right: pendingScratch[pendingReadCursor * 2 + 1])
            written += 1
            pendingReadCursor += 1
        }
        if pendingReadCursor >= pendingFrameCount {
            pendingFrameCount = 0
            pendingReadCursor = 0
        }

        while written < frames {
            let available = ring.availableFrames
            guard available > 0 else { break }
            let needed = Int((Double(frames - written) * sourceRate / destinationRate / resampler.correction).rounded(.up)) + 1
            let pull = min(available, min(needed, scratchFrameCapacity))
            let got = ring.read(into: pullScratch, frameCount: pull)
            guard got > 0 else { break }
            for f in 0..<got {
                let produced = resampler.push(sourceFrame: pullScratch + f * 2, output: resamplerScratch)
                for o in 0..<produced {
                    let left = Double(resamplerScratch[o * 2]) * gain
                    let right = Double(resamplerScratch[o * 2 + 1]) * gain
                    peak = max(peak, max(abs(left), abs(right)))
                    let leftOut: Float = limiterOn ? Float(SoftLimiter.curve(left)) : Float(left)
                    let rightOut: Float = limiterOn ? Float(SoftLimiter.curve(right)) : Float(right)
                    if written < frames {
                        writeRenderSample(buffers, bytesPerSample: bytesPerSample, frame: written, left: leftOut, right: rightOut)
                        written += 1
                    } else if pendingFrameCount < scratchFrameCapacity {
                        pendingScratch[pendingFrameCount * 2] = leftOut
                        pendingScratch[pendingFrameCount * 2 + 1] = rightOut
                        pendingFrameCount += 1
                    }
                }
            }
        }

        // Underflow: the buffer was memset to silence.
        bumpPeak(peak)
    }

    private func bumpPeak(_ value: Double) {
        guard value > 0 else { return }
        let bits = value.bitPattern
        var current = meterPeakBits.load(ordering: .relaxed)
        while Double(bitPattern: current) < value {
            let result = meterPeakBits.compareExchange(expected: current, desired: bits, ordering: .acquiringAndReleasing)
            if result.exchanged { return }
            current = result.original
        }
    }

    private func readSample(_ buffer: AudioBuffer, offset: Int) -> Float {
        guard let data = buffer.mData else { return 0 }
        switch (sourceIsFloat, sourceBitsPerChannel) {
        case (true, 32):
            return data.assumingMemoryBound(to: Float.self)[offset]
        case (true, 64):
            return Float(data.assumingMemoryBound(to: Double.self)[offset])
        case (false, 16):
            return Float(data.assumingMemoryBound(to: Int16.self)[offset]) / 32768.0
        case (false, 32):
            return Float(data.assumingMemoryBound(to: Int32.self)[offset]) / 2147483648.0
        default:
            return data.assumingMemoryBound(to: Float.self)[offset]
        }
    }

    private func writeRenderSample(_ buffers: UnsafeMutableAudioBufferListPointer, bytesPerSample: Int, frame: Int, left: Float, right: Float) {
        if buffers.count <= 1 {
            let buffer = buffers[0]
            guard let data = buffer.mData else { return }
            let ch = max(Int(buffer.mNumberChannels), 1)
            if bytesPerSample == 4 {
                let ptr = data.assumingMemoryBound(to: Float.self)
                ptr[frame * ch] = left
                if ch > 1 { ptr[frame * ch + 1] = right }
            } else {
                let ptr = data.assumingMemoryBound(to: Int16.self)
                ptr[frame * ch] = Int16(clamping: Int(left * 32767))
                if ch > 1 { ptr[frame * ch + 1] = Int16(clamping: Int(right * 32767)) }
            }
        } else {
            // Deinterleaved: one buffer per channel; extras stay zero.
            for (i, value) in [left, right].enumerated() where i < buffers.count {
                let buffer = buffers[i]
                guard let data = buffer.mData else { continue }
                let ch = max(Int(buffer.mNumberChannels), 1)
                if bytesPerSample == 4 {
                    data.assumingMemoryBound(to: Float.self)[frame * ch] = value
                } else {
                    data.assumingMemoryBound(to: Int16.self)[frame * ch] = Int16(clamping: Int(value * 32767))
                }
            }
        }
    }
}

// MARK: - Meter

extension ShoutEngine {
    private static let meterQueue = DispatchQueue(label: "com.opense.shout.helper.meter")

    func startMeterTimer() {
        queue.async { [self] in
            guard meterTimer == nil else { return }
            let timer = DispatchSource.makeTimerSource(queue: ShoutEngine.meterQueue)
            timer.schedule(deadline: .now() + 0.066, repeating: 1.0 / 15.0)
            timer.setEventHandler { [weak self] in
                guard let self else { return }
                let bits = self.meterPeakBits.exchange(0, ordering: .acquiring)
                let peak = Double(bitPattern: bits)
                let dbfs = peak > 0 ? 20 * log10(peak) : -120
                self.emit(.meter(peakDbfs: min(dbfs, 0)))
            }
            timer.resume()
            meterTimer = timer
        }
    }

    func stopMeterTimer() {
        queue.async { [self] in
            meterTimer?.cancel()
            meterTimer = nil
        }
    }
}