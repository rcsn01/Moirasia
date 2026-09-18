import Foundation

// Lock-free single-producer/single-consumer ring for interleaved stereo frames.
//
// The producer is the capture IOProc on the physical microphone's hardware
// clock; the consumer is the render IOProc on the virtual Shout Mic device's
// clock. The two run on different realtime threads with independent clocks, so
// the ring is the seam between them: the consumer measures occupancy to detect
// drift and the DriftController decides when to trim or pad.
//
// All storage is allocated once in init; read/write are realtime-safe.

public final class SpscRingBuffer {
    public let capacity: Int
    public let channelCount: Int

    private let storage: UnsafeMutablePointer<Float>
    private let readIndex = Atomic<UInt64>(0)
    private let writeIndex = Atomic<UInt64>(0)

    /// - Parameters:
    ///   - capacity: Ring depth in frames (per channel).
    ///   - channelCount: Interleaved channel count.
    public init(capacity: Int, channelCount: Int = 2) {
        self.capacity = capacity
        self.channelCount = channelCount
        self.storage = .allocate(capacity: capacity * channelCount)
        self.storage.initialize(repeating: 0, count: capacity * channelCount)
    }

    deinit {
        storage.deinitialize(count: capacity * channelCount)
        storage.deallocate()
    }

    /// Frames currently readable.
    public var availableFrames: Int {
        Int(writeIndex.load(ordering: .acquiring) - readIndex.load(ordering: .acquiring))
    }

    /// Writes up to `frameCount` frames from interleaved `source`, returning
    /// how many frames were accepted. Frames are dropped when the ring is full
    /// (the producer never blocks the capture thread).
    @discardableResult
    public func write(from source: UnsafePointer<Float>, frameCount: Int) -> Int {
        let writable = capacity - availableFrames
        let count = max(0, min(frameCount, writable))
        if count == 0 { return 0 }
        let write = writeIndex.load(ordering: .relaxed)
        writeInterleaved(source, count: count, atAbsolute: write)
        writeIndex.store(write + UInt64(count), ordering: .releasing)
        return count
    }

    /// Reads up to `frameCount` frames into interleaved `destination` and
    /// returns how many frames were read. Unread frames stay buffered.
    @discardableResult
    public func read(into destination: UnsafeMutablePointer<Float>, frameCount: Int) -> Int {
        let availableNow = availableFrames
        let count = max(0, min(frameCount, availableNow))
        if count > 0 {
            let read = readIndex.load(ordering: .relaxed)
            readInterleaved(destination, count: count, atAbsolute: read)
            readIndex.store(read + UInt64(count), ordering: .releasing)
        }
        return count
    }

    /// Drops up to `frameCount` oldest frames without rendering them (drift trim).
    /// Returns how many frames were discarded. Consumer-side only.
    @discardableResult
    public func discardOldest(upTo frameCount: Int) -> Int {
        let availableNow = availableFrames
        let count = max(0, min(frameCount, availableNow))
        if count > 0 {
            let read = readIndex.load(ordering: .relaxed)
            readIndex.store(read + UInt64(count), ordering: .releasing)
        }
        return count
    }

    /// Drops everything buffered and resets both cursors. Used when the
    /// capture source changes or restarts, so stale audio never leaks through.
    public func reset() {
        readIndex.store(0, ordering: .relaxed)
        writeIndex.store(0, ordering: .relaxed)
    }

    private func writeInterleaved(_ source: UnsafePointer<Float>, count: Int, atAbsolute absolute: UInt64) {
        var frame = absolute % UInt64(capacity)
        var offset = 0
        var remaining = count
        while remaining > 0 {
            let chunk = min(remaining, capacity - Int(frame))
            memcpy(storage + Int(frame) * channelCount, source + offset * channelCount, chunk * channelCount * MemoryLayout<Float>.size)
            offset += chunk
            frame = (frame + UInt64(chunk)) % UInt64(capacity)
            remaining -= chunk
        }
    }

    private func readInterleaved(_ destination: UnsafeMutablePointer<Float>, count: Int, atAbsolute absolute: UInt64) {
        var frame = absolute % UInt64(capacity)
        var offset = 0
        var remaining = count
        while remaining > 0 {
            let chunk = min(remaining, capacity - Int(frame))
            memcpy(destination + offset * channelCount, storage + Int(frame) * channelCount, chunk * channelCount * MemoryLayout<Float>.size)
            offset += chunk
            frame = (frame + UInt64(chunk)) % UInt64(capacity)
            remaining -= chunk
        }
    }
}