import AppKit
import ApplicationServices
import Foundation

public final class AccessibilityController {
    public init() {}
    public func isTrusted(prompt: Bool = false) -> Bool {
        if prompt {
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            return AXIsProcessTrustedWithOptions(options)
        }
        return AXIsProcessTrusted()
    }
    public func openSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }
}

/// Errors mirror the Rust move_window codes for UI parity.
public struct AmoveWindowError: Error, LocalizedError, Equatable {
    public let code: String
    public let message: String
    public var errorDescription: String? { message }

    static func denied() -> AmoveWindowError { AmoveWindowError(code: "accessibility-denied", message: "Accessibility access is required before Amove can move other apps' windows.") }
    static func frontmostMissing() -> AmoveWindowError { AmoveWindowError(code: "frontmost-application-missing", message: "No active application window is available to move.") }
    static func focusedMissing() -> AmoveWindowError { AmoveWindowError(code: "focused-window-missing", message: "The active application does not expose a focused window.") }
    static func unsupportedWindow(_ detail: String) -> AmoveWindowError { AmoveWindowError(code: "unsupported-window", message: detail) }
    static func screenUnavailable() -> AmoveWindowError { AmoveWindowError(code: "screen-unavailable", message: "Amove could not determine which display owns the active window.") }
    static func noDisplayInDirection() -> AmoveWindowError { AmoveWindowError(code: "no-display-in-direction", message: "There is no display in that direction.") }
    static func frameWriteFailed(sizeStatus: Int32, pointStatus: Int32) -> AmoveWindowError { AmoveWindowError(code: "frame-write-failed", message: "macOS rejected the window move request (AX errors \(sizeStatus)/\(pointStatus)).") }
}

enum AmoveFrameWritePlan { case positionOnly, sizeThenPosition }

func amoveFrameWritePlan(current: AmoveRect, requested: AmoveRect) -> AmoveFrameWritePlan {
    current.width == requested.width && current.height == requested.height ? .positionOnly : .sizeThenPosition
}

public final class WindowMover {
    public let accessibility: AccessibilityController
    public init(accessibility: AccessibilityController = AccessibilityController()) { self.accessibility = accessibility }

    public func displays() -> [AmoveRect] {
        NSScreen.screens.map { screen in AmoveRect(x: screen.frame.origin.x, y: screen.frame.origin.y, width: screen.frame.width, height: screen.frame.height) }
    }

    public func move(direction: AmoveDirection) -> Result<Void, AmoveWindowError> {
        guard accessibility.isTrusted() else { return .failure(.denied()) }
        guard let application = NSWorkspace.shared.frontmostApplication else { return .failure(.frontmostMissing()) }
        let axApplication = AXUIElementCreateApplication(application.processIdentifier)
        var windowValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(axApplication, kAXFocusedWindowAttribute as CFString, &windowValue) == .success, let windowObject = windowValue else {
            return .failure(.focusedMissing())
        }
        let window = unsafeDowncast(windowObject, to: AXUIElement.self)
        let frame: AmoveRect
        switch Self.readFrame(window: window) {
        case .success(let value): frame = value
        case .failure(let error): return .failure(error)
        }
        let displays = displays()
        guard let sourceIndex = sourceDisplay(window: frame, displays: displays) else { return .failure(.screenUnavailable()) }
        guard let targetIndex = adjacentDisplay(displays: displays, source: sourceIndex, direction: direction) else { return .failure(.noDisplayInDirection()) }
        let destination = preserveNormalizedTopLeft(window: frame, source: displays[sourceIndex], target: displays[targetIndex])
        switch Self.writeFrame(window: window, current: frame, requested: destination) {
        case .success: return .success(())
        case .failure(let error): return .failure(error)
        }
    }

    private static func readFrame(window: AXUIElement) -> Result<AmoveRect, AmoveWindowError> {
        var positionValue: CFTypeRef?
        var sizeValue: CFTypeRef?
        let positionStatus = AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &positionValue)
        let sizeStatus = AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeValue)
        guard positionStatus == .success, sizeStatus == .success, let positionObject = positionValue, let sizeObject = sizeValue else {
            return .failure(.unsupportedWindow("The active window does not expose a movable frame."))
        }
        var point = CGPoint.zero
        var size = CGSize.zero
        let pointValid = AXValueGetValue(unsafeDowncast(positionObject, to: AXValue.self), .cgPoint, &point)
        let sizeValid = AXValueGetValue(unsafeDowncast(sizeObject, to: AXValue.self), .cgSize, &size)
        guard pointValid, sizeValid else { return .failure(.unsupportedWindow("The active window exposes an unsupported frame.")) }
        return .success(AmoveRect(x: point.x, y: point.y, width: size.width, height: size.height))
    }

    private static func writeFrame(window: AXUIElement, current: AmoveRect, requested: AmoveRect) -> Result<Void, AmoveWindowError> {
        let sizeStatus: AXError
        switch amoveFrameWritePlan(current: current, requested: requested) {
        case .positionOnly: sizeStatus = .success
        case .sizeThenPosition: sizeStatus = setValue(window: window, attribute: kAXSizeAttribute as CFString, type: .cgSize, value: CGSize(width: requested.width, height: requested.height))
        }
        let pointStatus = sizeStatus == .success ? setValue(window: window, attribute: kAXPositionAttribute as CFString, type: .cgPoint, value: CGPoint(x: requested.x, y: requested.y)) : sizeStatus
        guard sizeStatus == .success, pointStatus == .success else { return .failure(.frameWriteFailed(sizeStatus: sizeStatus.rawValue, pointStatus: pointStatus.rawValue)) }
        return .success(())
    }

    private static func setValue<T>(window: AXUIElement, attribute: CFString, type: AXValueType, value: T) -> AXError {
        var value = value
        return withUnsafeBytes(of: &value) { buffer in
            guard let raw = buffer.baseAddress, let axValue = AXValueCreate(type, raw) else { return .failure }
            return AXUIElementSetAttributeValue(window, attribute, axValue)
        }
    }
}