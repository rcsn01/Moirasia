// Drift decisions for the seam between the microphone's hardware clock and the
// virtual device's clock. Pure and deterministic so tests can pin behavior.
//
// The render loop feeds occupancy readings; the controller returns trims (drop
// buffered frames), and a small ratio correction that leans the resampler
// against sustained drift. Chunks and cooldowns keep corrections inaudible.

public struct DriftController: Sendable {
    public struct Action: Equatable, Sendable {
        public let trimFrames: Int
        public let correctionDelta: Double

        public static let none = Action(trimFrames: 0, correctionDelta: 0)
    }

    /// Occupancy fraction above which a trim fires.
    public let trimThreshold: Double
    /// Occupancy fraction below which a pad (ratio lean) fires.
    public let padThreshold: Double
    /// Minimum seconds between corrections (hysteresis).
    public let cooldownSeconds: Double
    /// Per-correction ratio step.
    public let correctionStep: Double
    /// Correction clamp.
    public let correctionRange: ClosedRange<Double>

    public private(set) var correction: Double = 1.0
    private var lastTrimSeconds: Double = -.infinity
    private var lastPadSeconds: Double = -.infinity

    public init(
        trimThreshold: Double = 0.85,
        padThreshold: Double = 0.15,
        cooldownSeconds: Double = 2.0,
        correctionStep: Double = 0.0005,
        correctionRange: ClosedRange<Double> = 0.98...1.02
    ) {
        self.trimThreshold = trimThreshold
        self.padThreshold = padThreshold
        self.cooldownSeconds = cooldownSeconds
        self.correctionStep = correctionStep
        self.correctionRange = correctionRange
    }

    /// Evaluates one occupancy reading. `chunkFrames` is the trim size (e.g.
    /// 10 ms at the device rate).
    public mutating func update(occupancyFrames: Int, capacityFrames: Int, chunkFrames: Int, nowSeconds: Double) -> Action {
        guard capacityFrames > 0 else { return .none }
        let occupancy = Double(occupancyFrames) / Double(capacityFrames)
        if occupancy >= trimThreshold && nowSeconds - lastTrimSeconds >= cooldownSeconds {
            lastTrimSeconds = nowSeconds
            correction = min(correction + correctionStep, correctionRange.upperBound)
            return Action(trimFrames: chunkFrames, correctionDelta: correctionStep)
        }
        if occupancy <= padThreshold && nowSeconds - lastPadSeconds >= cooldownSeconds {
            lastPadSeconds = nowSeconds
            correction = max(correction - correctionStep, correctionRange.lowerBound)
            return Action(trimFrames: 0, correctionDelta: -correctionStep)
        }
        return .none
    }
}