import CoreGraphics
import Foundation

public struct AmoveRect: Codable, Equatable, Sendable {
    public var x: Double; public var y: Double; public var width: Double; public var height: Double
    public init(x: Double, y: Double, width: Double, height: Double) { self.x = x; self.y = y; self.width = width; self.height = height }
    public var center: CGPoint { CGPoint(x: x + width / 2, y: y + height / 2) }
    public func contains(_ point: CGPoint) -> Bool { point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height }
    public func intersectionArea(_ other: AmoveRect) -> Double { max(0, min(x + width, other.x + other.width) - max(x, other.x)) * max(0, min(y + height, other.y + other.height) - max(y, other.y)) }
}

public enum AmoveDirection: String, Codable, Sendable { case left, right, up, down }

public func sourceDisplay(window: AmoveRect, displays: [AmoveRect]) -> Int? {
    if let index = displays.firstIndex(where: { $0.contains(window.center) }) { return index }
    return displays.enumerated().max { $0.element.intersectionArea(window) < $1.element.intersectionArea(window) }?.offset
}

public func adjacentDisplay(displays: [AmoveRect], source: Int, direction: AmoveDirection) -> Int? {
    guard displays.indices.contains(source) else { return nil }
    let current = displays[source].center
    return displays.enumerated().filter { $0.offset != source }.compactMap { index, display -> (Int, Double, Double)? in
        let center = display.center; let dx = center.x - current.x; let dy = center.y - current.y
        switch direction {
        case .left where dx < 0: return (index, -dx, abs(dy))
        case .right where dx > 0: return (index, dx, abs(dy))
        case .up where dy < 0: return (index, -dy, abs(dx))
        case .down where dy > 0: return (index, dy, abs(dx))
        default: return nil
        }
    }.min { $0.1 == $1.1 ? $0.2 < $1.2 : $0.1 < $1.1 }?.0
}

public func preserveNormalizedTopLeft(window: AmoveRect, source: AmoveRect, target: AmoveRect) -> AmoveRect {
    AmoveRect(x: target.x + target.width * ((window.x - source.x) / source.width), y: target.y + target.height * ((window.y - source.y) / source.height), width: window.width, height: window.height)
}
