import Carbon.HIToolbox
import Foundation

public struct AmoveShortcutIssue: Codable, Equatable, Sendable {
    public let action: String
    public let code: String
    public let message: String
}

/// A shortcut binding in the wire shape shared with the Electron UI.
public struct AmoveShortcutKey: Codable, Equatable, Sendable {
    public var kind: String
    public var code: String?
    public var keyCode: Int?

    public init(kind: String = "physical", code: String? = nil, keyCode: Int? = nil) {
        self.kind = kind
        self.code = code
        self.keyCode = keyCode
    }
}

public struct AmoveShortcutBinding: Codable, Equatable, Sendable {
    public var key: AmoveShortcutKey
    public var modifiers: [String]

    public init(key: AmoveShortcutKey, modifiers: [String]) {
        self.key = key
        self.modifiers = modifiers
    }
}

extension AmoveShortcutBinding {
    /// Carbon virtual key code, mirroring the adapter mapping used by the UI.
    public var carbonKeyCode: UInt32? {
        if key.kind == "darwinCarbon", let keyCode = key.keyCode, keyCode >= 0, keyCode <= Int(UInt32.max) {
            return UInt32(keyCode)
        }
        if let code = key.code { return AmovePhysicalKeyCodes.carbonCodeForPhysical(code) }
        return nil
    }

    public var carbonModifierMask: UInt32 {
        var mask: UInt32 = 0
        for modifier in modifiers {
            switch modifier {
            case "control": mask |= UInt32(controlKey)
            case "alt": mask |= UInt32(optionKey)
            case "shift": mask |= UInt32(shiftKey)
            case "meta": mask |= UInt32(cmdKey)
            default: break
            }
        }
        return mask
    }
}

public enum AmovePhysicalKeyCodes {
    /// Physical key name → Carbon virtual key code (matches the UI's `carbonCodeForPhysical`).
    private static let carbonCodes: [String: UInt32] = [
        "KeyA": 0, "KeyS": 1, "KeyD": 2, "KeyF": 3, "KeyH": 4, "KeyG": 5, "KeyZ": 6, "KeyX": 7, "KeyC": 8, "KeyV": 9,
        "KeyB": 11, "KeyQ": 12, "KeyW": 13, "KeyE": 14, "KeyR": 15, "KeyY": 16, "KeyT": 17, "Digit1": 18, "Digit2": 19,
        "Digit3": 20, "Digit4": 21, "Digit6": 22, "Digit5": 23, "Equal": 24, "Digit9": 25, "Digit7": 26, "Minus": 27,
        "Digit8": 28, "Digit0": 29, "BracketRight": 30, "KeyO": 31, "KeyU": 32, "BracketLeft": 33, "KeyI": 34, "KeyP": 35,
        "Enter": 36, "KeyL": 37, "KeyJ": 38, "Quote": 39, "KeyK": 40, "Semicolon": 41, "Backslash": 42, "Comma": 43,
        "Slash": 44, "KeyN": 45, "KeyM": 46, "Period": 47, "Tab": 48, "Space": 49, "Backquote": 50, "Backspace": 51,
        "Escape": 53, "Home": 115, "PageUp": 116, "Delete": 117, "End": 119, "PageDown": 121, "ArrowLeft": 123,
        "ArrowRight": 124, "ArrowDown": 125, "ArrowUp": 126
    ]

    public static func carbonCodeForPhysical(_ code: String) -> UInt32? { carbonCodes[code] }

    public static func physicalCodeForCarbon(_ keyCode: UInt32) -> String? {
        carbonCodes.first(where: { $0.value == keyCode })?.key
    }
}

public enum AmoveShortcutDefaults {
    public static let actions = ["moveDisplayLeft", "moveDisplayRight", "moveDisplayUp", "moveDisplayDown", "toggleShelf"]

    public static func bindings() -> [String: AmoveShortcutBinding] {
        let keys = ["moveDisplayLeft": "ArrowLeft", "moveDisplayRight": "ArrowRight", "moveDisplayUp": "ArrowUp", "moveDisplayDown": "ArrowDown", "toggleShelf": "KeyS"]
        var result: [String: AmoveShortcutBinding] = [:]
        for action in actions {
            result[action] = AmoveShortcutBinding(key: AmoveShortcutKey(code: keys[action]), modifiers: ["control", "alt", "meta"])
        }
        return result
    }
}

/// Registers global shortcuts with Carbon and dispatches them through `onAction`.
/// `registrar` replaces the Carbon registration in tests.
public final class HotkeyRegistry {
    public var onAction: ((String) -> Void)?
    /// Returns a stable hotkey handle on success; the default uses Carbon.
    public var registrar: ((_ keyCode: UInt32, _ modifiers: UInt32) -> (Bool, Int64))?

    private enum HotKeyHandle {
        case carbon(EventHotKeyRef)
        case fake(Int64)
    }

    private var hotKeyHandles: [HotKeyHandle] = []
    private var actionByHotKeyID: [UInt32: String] = [:]
    private var eventHandler: EventHandlerRef?
    private var nextHotKeyID: UInt32 = 1
    private(set) public var issues: [AmoveShortcutIssue] = []
    private var recording = false
    public private(set) var appFocused = false
    public private(set) var shelfVisible = false

    public init() {}

    public func register(_ bindings: [String: AmoveShortcutBinding]) -> [AmoveShortcutIssue] {
        unregister()
        var issues: [AmoveShortcutIssue] = []
        var seen: [String: String] = [:]
        var actions: [UInt32: String] = [:]
        for action in bindings.keys.sorted() {
            guard let binding = bindings[action] else { continue }
            guard let keyCode = binding.carbonKeyCode else {
                issues.append(AmoveShortcutIssue(action: action, code: "unsupported", message: "This physical key is not supported by the native hotkey adapter."))
                continue
            }
            let mask = binding.carbonModifierMask
            if mask == 0 {
                issues.append(AmoveShortcutIssue(action: action, code: "reserved", message: "Shortcuts must include at least one modifier key."))
                continue
            }
            let chord = "\(mask)|\(keyCode)"
            if let owner = seen[chord] {
                issues.append(AmoveShortcutIssue(action: action, code: "duplicate", message: "Another action already owns this shortcut."))
                continue
            }
            seen[chord] = action
            let hotKeyID = nextHotKeyID
            nextHotKeyID += 1
            if let registrar {
                let (ok, handle) = registrar(keyCode, mask)
                guard ok else {
                    issues.append(AmoveShortcutIssue(action: action, code: "registration-failed", message: "macOS could not register this shortcut."))
                    continue
                }
                hotKeyHandles.append(.fake(handle))
            } else {
                var ref: EventHotKeyRef?
                let status = RegisterEventHotKey(keyCode, mask, EventHotKeyID(signature: OSType(0x4D4F_5241), id: hotKeyID), GetApplicationEventTarget(), 0, &ref)
                guard status == noErr, let ref else {
                    issues.append(AmoveShortcutIssue(action: action, code: "registration-failed", message: "macOS could not register this shortcut."))
                    continue
                }
                hotKeyHandles.append(.carbon(ref))
            }
            actions[hotKeyID] = action
        }
        actionByHotKeyID = actions
        installEventHandlerIfNeeded()
        self.issues = issues
        return issues
    }

    public func unregister() {
        for handle in hotKeyHandles {
            if case .carbon(let ref) = handle { UnregisterEventHotKey(ref) }
        }
        hotKeyHandles.removeAll()
        actionByHotKeyID.removeAll()
    }

    public func setRecording(_ value: Bool) { recording = value }

    public func setHotkeyPolicy(appFocused: Bool, shelfVisible: Bool) {
        self.appFocused = appFocused
        self.shelfVisible = shelfVisible
    }

    public func shouldDispatch(action: String) -> Bool {
        !recording && (!appFocused || (action == "toggleShelf" && shelfVisible))
    }

    // MARK: - Carbon plumbing

    private func installEventHandlerIfNeeded() {
        guard eventHandler == nil else { return }
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let callback: EventHandlerUPP = { _, event, userData in
            guard let event, let userData else { return noErr }
            let registry = Unmanaged<HotkeyRegistry>.fromOpaque(userData).takeUnretainedValue()
            registry.handleHotkey(event)
            return noErr
        }
        let selfRef = Unmanaged.passUnretained(self).toOpaque()
        let target = GetApplicationEventTarget()
        var handler: EventHandlerRef?
        let status = InstallEventHandler(target, callback, 1, &eventType, selfRef, &handler)
        if status == noErr { eventHandler = handler }
    }

    private func handleHotkey(_ event: EventRef?) {
        var hotKeyID = EventHotKeyID()
        let bufferSize = MemoryLayout<EventHotKeyID>.size
        let status = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, bufferSize, nil, &hotKeyID)
        guard status == noErr, let action = actionByHotKeyID[hotKeyID.id] else { return }
        guard shouldDispatch(action: action) else { return }
        onAction?(action)
    }
}