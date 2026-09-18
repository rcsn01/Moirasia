import Foundation

// Gain conversion. Pure so tests can pin exact outputs.

/// Converts decibels to a linear amplitude multiplier. Clamps to 0...+30 dB,
/// where 0 dB is unity and +30 dB is the boost ceiling.
public enum Gain {
    public static let minDb: Double = 0
    public static let maxDb: Double = 30

    /// 10^(db/20), clamped to the supported range.
    public static func linear(forDb db: Double) -> Double {
        let clamped = min(max(db, minDb), maxDb)
        return pow(10, clamped / 20)
    }
}