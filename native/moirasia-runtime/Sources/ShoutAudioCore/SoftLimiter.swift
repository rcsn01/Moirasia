import Foundation

// Soft limiter for the boosted signal.
//
// Boosting can push peaks past full scale, and hard clipping sounds broken, so
// the render path passes every frame through this curve. Below the knee the
// signal is untouched; above it the curve bends smoothly toward an asymptote
// at 0 dBFS. The knee sits at -6 dBFS (0.5 linear).

public struct SoftLimiter: Sendable {
    /// Linear amplitude where the curve starts bending (-6 dBFS).
    public static let knee: Double = 0.5

    public init() {}

    /// The limiter transfer function, exposed for tests.
    public static func curve(_ x: Double) -> Double {
        if x <= knee {
            return x
        }
        // tanh compression from the knee to an asymptote at 1.0.
        let span = 1.0 - knee
        return knee + span * Foundation.tanh((x - knee) / span)
    }

    /// Applies the limiter to one sample (gain is applied before this stage).
    public static func apply(_ x: Float) -> Float {
        Float(curve(Double(x)))
    }

    /// Processes a block of interleaved frames in place.
    public static func process(_ buffer: UnsafeMutablePointer<Float>, frameCount: Int, channelCount: Int) {
        let sampleCount = frameCount * channelCount
        for i in 0..<sampleCount {
            buffer[i] = Float(curve(Double(buffer[i])))
        }
    }
}