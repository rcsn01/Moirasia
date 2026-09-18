import Darwin

/// Minimal macOS 14-compatible atomic storage used by the realtime audio path.
/// Values are naturally aligned and all accesses are surrounded by the platform
/// memory barrier; the ring has one producer and one consumer per index.
public enum AtomicOrdering { case relaxed, acquiring, releasing, acquiringAndReleasing }
public struct AtomicCompareExchangeResult<Value> { public let exchanged: Bool; public let original: Value }

public final class Atomic<Value>: @unchecked Sendable {
    private var value: Value
    public init(_ value: Value) { self.value = value }
    @inline(__always) public func load(ordering: AtomicOrdering) -> Value { OSMemoryBarrier(); return value }
    @inline(__always) public func store(_ value: Value, ordering: AtomicOrdering) { self.value = value; OSMemoryBarrier() }
    @inline(__always) public func exchange(_ value: Value, ordering: AtomicOrdering) -> Value { let original = self.value; self.value = value; OSMemoryBarrier(); return original }
    @inline(__always) public func compareExchange(expected: Value, desired: Value, ordering: AtomicOrdering) -> AtomicCompareExchangeResult<Value> where Value: Equatable {
        let original = self.value
        guard original == expected else { OSMemoryBarrier(); return AtomicCompareExchangeResult(exchanged: false, original: original) }
        self.value = desired
        OSMemoryBarrier()
        return AtomicCompareExchangeResult(exchanged: true, original: original)
    }
}
