import Foundation

public struct AmoveActionResult: Equatable, Sendable {
    public var ok: Bool
    public var code: String?
    public var message: String
}

public final class AmoveRuntime {
    public let hotkeys: HotkeyRegistry
    public let mover: WindowMover
    public private(set) var settings: AmoveSettings
    private let store: AmoveSettingsStore
    private let lock = NSLock()
    private var statusMessage = "Global shortcuts are active in the background."
    private var lastActionMessage = "No window actions have been triggered yet."
    /// Fired when a global hotkey asks for the shelf (Electron is launched by the host).
    public var onToggleShelf: (() -> Void)?
    /// Fired after a hotkey-driven action mutated state; publishes a snapshot event.
    public var onSnapshotChanged: (() -> Void)?

    public init(dataDirectory: String, legacyDataDirectories: [String] = []) {
        store = AmoveSettingsStore(dataDirectory: dataDirectory, legacyDataDirectories: legacyDataDirectories)
        hotkeys = HotkeyRegistry()
        mover = WindowMover()
        settings = store.load()
    }

    public func start() {
        lock.lock()
        if settings.shortcutsByPlatform["darwin"] == nil { settings.shortcutsByPlatform["darwin"] = AmoveShortcutDefaults.bindings() }
        let bindings = settings.shortcutsByPlatform["darwin"] ?? [:]
        statusMessage = "Global shortcuts are active in the background."
        lock.unlock()
        try? store.save(settings)
        hotkeys.onAction = { [weak self] action in self?.perform(action: action) }
        _ = hotkeys.register(bindings)
    }

    public func stop() {
        hotkeys.unregister()
    }

    public func setRecording(_ recording: Bool) { hotkeys.setRecording(recording) }

    public func setHotkeyPolicy(appFocused: Bool, shelfVisible: Bool) {
        hotkeys.setHotkeyPolicy(appFocused: appFocused, shelfVisible: shelfVisible)
    }

    public func setPresence(_ mode: String) {
        lock.lock()
        settings.presenceMode = mode
        lock.unlock()
        try? store.save(settings)
        onSnapshotChanged?()
    }

    /// Registers one shortcut; persists and re-registers all bindings.
    public func recordShortcut(action: String, binding: AmoveShortcutBinding) -> [AmoveShortcutIssue] {
        lock.lock()
        var bindings = settings.shortcutsByPlatform["darwin"] ?? AmoveShortcutDefaults.bindings()
        bindings[action] = binding
        settings.shortcutsByPlatform["darwin"] = bindings
        lock.unlock()
        try? store.save(settings)
        return rearmHotkeys()
    }

    public func resetShortcut(action: String?) -> [AmoveShortcutIssue] {
        lock.lock()
        var bindings = settings.shortcutsByPlatform["darwin"] ?? AmoveShortcutDefaults.bindings()
        if let action { bindings[action] = AmoveShortcutDefaults.bindings()[action] ?? bindings[action] }
        else { bindings = AmoveShortcutDefaults.bindings() }
        settings.shortcutsByPlatform["darwin"] = bindings
        lock.unlock()
        try? store.save(settings)
        return rearmHotkeys()
    }

    public var shortcutIssues: [AmoveShortcutIssue] { hotkeys.issues }
    public var migrationWarning: String? { store.warning }

    /// Window movement plus status bookkeeping; safe from the request thread or
    /// the Carbon hotkey thread.
    @discardableResult
    public func perform(action: String) -> AmoveActionResult {
        switch action {
        case "toggleShelf":
            lock.lock()
            lastActionMessage = "Shelf toggled."
            statusMessage = lastActionMessage
            lock.unlock()
            onSnapshotChanged?()
            onToggleShelf?()
            return AmoveActionResult(ok: true, code: nil, message: lastActionMessage)
        case "moveDisplayLeft", "moveDisplayRight", "moveDisplayUp", "moveDisplayDown":
            let direction: AmoveDirection = action.hasSuffix("Left") ? .left : action.hasSuffix("Right") ? .right : action.hasSuffix("Up") ? .up : .down
            let result: AmoveActionResult
            switch mover.move(direction: direction) {
            case .success:
                lock.lock()
                lastActionMessage = "Window moved to the adjacent display."
                statusMessage = lastActionMessage
                lock.unlock()
                result = AmoveActionResult(ok: true, code: nil, message: lastActionMessage)
            case .failure(let error):
                lock.lock()
                lastActionMessage = error.message
                statusMessage = error.message
                lock.unlock()
                result = AmoveActionResult(ok: false, code: error.code, message: error.message)
            }
            onSnapshotChanged?()
            return result
        default:
            return AmoveActionResult(ok: false, code: "unsupported-action", message: "This window action is not supported.")
        }
    }

    public func snapshotValues() -> (settings: AmoveSettings, statusMessage: String, lastActionMessage: String, accessibilityGranted: Bool) {
        lock.lock(); defer { lock.unlock() }
        return (settings, statusMessage, lastActionMessage, mover.accessibility.isTrusted())
    }

    public var statusMessageValue: String {
        lock.lock(); defer { lock.unlock() }
        return statusMessage
    }

    public var lastActionMessageValue: String {
        lock.lock(); defer { lock.unlock() }
        return lastActionMessage
    }

    public func setLastActionMessage(_ message: String) {
        lock.lock()
        lastActionMessage = message
        statusMessage = message
        lock.unlock()
        onSnapshotChanged?()
    }

    private func rearmHotkeys() -> [AmoveShortcutIssue] {
        lock.lock(); let bindings = settings.shortcutsByPlatform["darwin"] ?? [:]; lock.unlock()
        return hotkeys.register(bindings)
    }
}