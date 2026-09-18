// Streaming linear resampler between the microphone's hardware rate and the
// virtual device rate. Frames are pushed one at a time (in callback order) and
// converted outputs are collected by the caller.
//
// The conversion consumes one nominal source frame per output frame scaled by
// a drift correction factor the render loop adjusts from ring occupancy. The
// next output's absolute source position is tracked explicitly so both slower
// (step < 1) and faster (step > 1) sources interpolate correctly, including
// frames skipped when the source runs faster than the destination.

public final class LinearResampler {
    public let sourceRate: Double
    public let destRate: Double
    public let channelCount: Int

    /// Nominal source frames consumed per output frame.
    public var nominalStep: Double { sourceRate / destRate }

    /// Drift correction multiplier applied to the nominal step. Above 1
    /// consumes more source per output (drains the ring); below 1 consumes
    /// less (lets it fill). Clamped to +/-2 percent.
    public var correction: Double {
        get { correctionValue }
        set { correctionValue = min(max(newValue, 0.98), 1.02) }
    }

    private var correctionValue: Double = 1.0

    /// Absolute source position of the next output frame.
    private var nextOutputPosition: Double = 0
    /// How many source frames have been pushed (index of the next one).
    private var pushedFrames: UInt64 = 0
    private var previousFrame: [Float]
    private var havePrevious = false

    public init(sourceRate: Double, destRate: Double, channelCount: Int = 2) {
        self.sourceRate = sourceRate
        self.destRate = destRate
        self.channelCount = channelCount
        self.previousFrame = [Float](repeating: 0, count: channelCount)
    }

    /// Drops carried state (source change, rate change, ring reset).
    public func reset() {
        nextOutputPosition = 0
        pushedFrames = 0
        havePrevious = false
        for c in 0..<channelCount { previousFrame[c] = 0 }
    }

    /// Feeds one interleaved source frame; writes produced output frames into
    /// `output` and returns how many were written (0 or more).
    public func push(sourceFrame: UnsafePointer<Float>, output: UnsafeMutablePointer<Float>) -> Int {
        if !havePrevious {
            for c in 0..<channelCount { previousFrame[c] = sourceFrame[c] }
            havePrevious = true
            pushedFrames += 1
            return 0
        }
        let currentIndex = Int(pushedFrames)
        let leftIndex = currentIndex - 1
        var produced = 0
        // Outputs whose source position falls between the previous frame and
        // this one interpolate across that span. Positions that slipped past
        // an entire window (fast source) are skipped without producing.
        while produced < 64 {
            let position = nextOutputPosition
            guard position < Double(currentIndex) else { break }
            if position >= Double(leftIndex) {
                let frac = Float(position - Double(leftIndex))
                for c in 0..<channelCount {
                    output[produced * channelCount + c] = previousFrame[c] + (sourceFrame[c] - previousFrame[c]) * frac
                }
                produced += 1
            }
            nextOutputPosition += nominalStep * correctionValue
        }
        for c in 0..<channelCount { previousFrame[c] = sourceFrame[c] }
        pushedFrames += 1
        return produced
    }
}