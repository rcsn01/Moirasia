import Foundation
import MoirasiaProtocol

/// Reads the preferences written by the legacy standalone Amove/ShiftShelf apps
/// and maps them onto the suite settings shape (parity with the UI migration).
public enum AmoveLegacyMigration {
    public static let legacyKeys = [
        "Amove.shortcuts.v2", "ShiftShelf.shortcuts.v2",
        "Amove.showsMenuBar", "Amove.showsDockIconWhenNoWindowOpen",
        "ShiftShelf.showsMenuBar", "ShiftShelf.showsDockIconWhenNoWindowOpen",
        "ShiftShelf.hideFromDock"
    ]

    /// Reads legacy CFPreferences values from the `com.opense.Amove` domain.
    public static func readLegacyPreferences() -> [String: JSONValue] {
        let domain = "com.opense.Amove" as CFString
        var result: [String: JSONValue] = [:]
        for key in legacyKeys {
            guard let value = CFPreferencesCopyAppValue(key as CFString, domain) else { continue }
            if let converted = convert(value) { result[key] = converted }
        }
        return result
    }

    public static func migrateMacUserDefaults(_ values: [String: JSONValue]) -> (settings: AmoveSettings, warnings: [String]) {
        var settings = AmoveSettings.darwinDefaults()
        var warnings: [String] = []
        let shortcutSource = values["Amove.shortcuts.v2"] ?? values["ShiftShelf.shortcuts.v2"]

        if let shortcutSource {
            switch decodeShortcutDocument(shortcutSource) {
            case .success(let document):
                let imported = document.compactMapValues { entry -> AmoveShortcutBinding? in
                    decodeLegacyBinding(entry)
                }
                var bindings = settings.shortcutsByPlatform["darwin"] ?? [:]
                for (rawAction, binding) in imported {
                    guard let action = actionAliases[rawAction] else {
                        warnings.append("Ignored unknown shortcut action “\(rawAction)”.")
                        continue
                    }
                    bindings[action] = binding
                }
                settings.shortcutsByPlatform["darwin"] = bindings
            case .failure(let message):
                warnings.append("Shortcuts could not be imported: \(message.message).")
            }
        }

        switch migratePresence(values) {
        case .success(let mode):
            settings.presenceMode = mode
        case .failure:
            warnings.append("App presence could not be imported.")
        }

        settings.migrations["macUserDefaultsV1"] = warnings.isEmpty ? "completed" : "completed-with-warnings"
        return (settings, warnings)
    }

    // MARK: - Internals

    private static let actionAliases: [String: String] = [
        "moveDisplayLeft": "moveDisplayLeft", "previousDisplay": "moveDisplayLeft",
        "moveDisplayRight": "moveDisplayRight", "nextDisplay": "moveDisplayRight",
        "moveDisplayUp": "moveDisplayUp", "moveDisplayDown": "moveDisplayDown",
        "toggleShelf": "toggleShelf"
    ]

    private static func decodeShortcutDocument(_ value: JSONValue) -> Result<[String: JSONValue], ShortcutDocumentError> {
        switch value {
        case .object(let object):
            return .success(object)
        case .string(let text):
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.hasPrefix("{") { return decodeJSON(trimmed) }
            guard let decoded = Data(base64Encoded: trimmed) else { return .failure(.init(message: "unsupported preference value")) }
            return decodeJSON(String(decoding: decoded, as: UTF8.self))
        default:
            return .failure(.init(message: "unsupported preference value"))
        }
    }

    private static func decodeJSON(_ text: String) -> Result<[String: JSONValue], ShortcutDocumentError> {
        guard let data = text.data(using: .utf8), let value = try? JSONDecoder().decode(JSONValue.self, from: data), case .object(let object) = value else {
            return .failure(.init(message: "shortcut document is not an object"))
        }
        return .success(object)
    }

    private struct ShortcutDocumentError: Error {
        let message: String
    }

    private static func decodeLegacyBinding(_ value: JSONValue) -> AmoveShortcutBinding? {
        guard case .object(let object) = value else { return nil }
        guard let keyCode = object["keyCode"]?.numberValue.map(Int.init) else { return nil }
        var rawMask: Int?
        if case .number(let mask) = object["modifiers"] { rawMask = Int(mask) }
        else if case .object(let wrapper) = object["modifiers"], let mask = wrapper["rawValue"]?.numberValue { rawMask = Int(mask) }
        guard let rawMask else { return nil }
        let modifiers = decodeModifierMask(rawMask)
        let physical = AmovePhysicalKeyCodes.physicalCodeForCarbon(UInt32(clamping: keyCode))
        let key = physical.map { AmoveShortcutKey(code: $0) } ?? AmoveShortcutKey(kind: "darwinCarbon", keyCode: keyCode)
        return AmoveShortcutBinding(key: key, modifiers: modifiers)
    }

    private static func decodeModifierMask(_ mask: Int) -> [String] {
        var modifiers: [String] = []
        if mask & (1 << 2) != 0 { modifiers.append("control") }
        if mask & (1 << 1) != 0 { modifiers.append("alt") }
        if mask & (1 << 3) != 0 { modifiers.append("shift") }
        if mask & 1 != 0 { modifiers.append("meta") }
        return modifiers
    }

    private static func migratePresence(_ values: [String: JSONValue]) -> Result<String, NoLegacyPresence> {
        let currentMenu = optionalBoolean(values["Amove.showsMenuBar"])
        let currentDock = optionalBoolean(values["Amove.showsDockIconWhenNoWindowOpen"])
        if currentMenu != nil || currentDock != nil {
            return .success(currentDock == true && currentMenu == false ? "taskbar" : "background")
        }
        let legacyMenu = optionalBoolean(values["ShiftShelf.showsMenuBar"])
        let legacyDock = optionalBoolean(values["ShiftShelf.showsDockIconWhenNoWindowOpen"])
        if legacyMenu != nil || legacyDock != nil {
            return .success(legacyDock == true && legacyMenu == false ? "taskbar" : "background")
        }
        let hideFromDock = optionalBoolean(values["ShiftShelf.hideFromDock"])
        return .success(hideFromDock == false ? "taskbar" : "background")
    }

    private struct NoLegacyPresence: Error {}

    private static func optionalBoolean(_ value: JSONValue?) -> Bool? {
        guard case .bool(let bool) = value else { return nil }
        return bool
    }

    private static func convert(_ value: CFTypeRef) -> JSONValue? {
        let typeID = CFGetTypeID(value)
        if typeID == CFBooleanGetTypeID() {
            return .bool(CFBooleanGetValue(value as! CFBoolean))
        }
        if typeID == CFNumberGetTypeID() {
            var number: Double = 0
            CFNumberGetValue(value as! CFNumber, .doubleType, &number)
            return .number(number)
        }
        if typeID == CFDataGetTypeID() {
            let data = value as! CFData
            let bytes = CFDataGetBytePtr(data)
            let length = CFDataGetLength(data)
            let buffer = length > 0 && bytes != nil ? Data(bytes: bytes!, count: length) : Data()
            return .string(buffer.base64EncodedString())
        }
        if typeID == CFStringGetTypeID() {
            return .string(value as! String)
        }
        return nil
    }
}