import type { AppSettings, ShortcutBinding, ShortcutModifier, WindowActionId } from "../shared/contracts";
import { defaultSettings } from "../shared/defaults";
import { physicalCodeForCarbon } from "../shared/shortcuts";

export interface MigrationResult {
  settings: AppSettings;
  warning?: string;
}

const actionAliases: Record<string, WindowActionId> = {
  moveDisplayLeft: "moveDisplayLeft",
  previousDisplay: "moveDisplayLeft",
  moveDisplayRight: "moveDisplayRight",
  nextDisplay: "moveDisplayRight",
  moveDisplayUp: "moveDisplayUp",
  moveDisplayDown: "moveDisplayDown",
  toggleShelf: "toggleShelf"
};

export function migrateMacUserDefaults(values: Record<string, unknown>): MigrationResult {
  const settings = defaultSettings("darwin");
  const warnings: string[] = [];
  const shortcutSource = values["Amove.shortcuts.v2"] ?? values["ShiftShelf.shortcuts.v2"];

  if (shortcutSource !== undefined) {
    try {
      const decoded = decodeShortcutDocument(shortcutSource);
      const imported: Partial<Record<WindowActionId, ShortcutBinding>> = {};
      for (const [rawAction, rawBinding] of Object.entries(decoded)) {
        const action = actionAliases[rawAction];
        if (!action) {
          warnings.push(`Ignored unknown shortcut action “${rawAction}”.`);
          continue;
        }
        imported[action] = decodeLegacyBinding(rawBinding);
      }
      settings.shortcutsByPlatform.darwin = { ...settings.shortcutsByPlatform.darwin, ...imported };
    } catch (error) {
      warnings.push(`Shortcuts could not be imported: ${errorMessage(error)}`);
    }
  }

  try {
    settings.presenceMode = migratePresence(values);
  } catch (error) {
    warnings.push(`App presence could not be imported: ${errorMessage(error)}`);
  }

  settings.migrations.macUserDefaultsV1 = warnings.length === 0 ? "completed" : "completed-with-warnings";
  return warnings.length === 0 ? { settings } : { settings, warning: warnings.join(" ") };
}

function decodeShortcutDocument(value: unknown): Record<string, unknown> {
  if (isPlainRecord(value)) return value;
  let text: string;
  if (typeof value === "string") {
    const trimmed = value.trim();
    text = trimmed.startsWith("{") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");
  } else if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    text = Buffer.from(value).toString("utf8");
  } else {
    throw new Error("unsupported preference value");
  }
  const decoded: unknown = JSON.parse(text);
  if (!isPlainRecord(decoded)) throw new Error("shortcut document is not an object");
  return decoded;
}

function decodeLegacyBinding(value: unknown): ShortcutBinding {
  if (!isPlainRecord(value) || !Number.isInteger(value.keyCode)) throw new Error("shortcut entry is malformed");
  const keyCode = value.keyCode as number;
  const rawModifiers = isPlainRecord(value.modifiers) ? value.modifiers.rawValue : value.modifiers;
  if (!Number.isInteger(rawModifiers)) throw new Error("shortcut modifiers are malformed");
  const modifiers = decodeModifierMask(rawModifiers as number);
  const physicalCode = physicalCodeForCarbon(keyCode);
  return {
    key: physicalCode ? { kind: "physical", code: physicalCode } : { kind: "darwinCarbon", keyCode },
    modifiers
  };
}

function decodeModifierMask(mask: number): ShortcutModifier[] {
  const modifiers: ShortcutModifier[] = [];
  if ((mask & (1 << 2)) !== 0) modifiers.push("control");
  if ((mask & (1 << 1)) !== 0) modifiers.push("alt");
  if ((mask & (1 << 3)) !== 0) modifiers.push("shift");
  if ((mask & 1) !== 0) modifiers.push("meta");
  return modifiers;
}

function migratePresence(values: Record<string, unknown>): "background" | "taskbar" {
  const currentMenu = optionalBoolean(values["Amove.showsMenuBar"]);
  const currentDock = optionalBoolean(values["Amove.showsDockIconWhenNoWindowOpen"]);
  if (currentMenu !== undefined || currentDock !== undefined) {
    return currentDock === true && currentMenu === false ? "taskbar" : "background";
  }

  const legacyMenu = optionalBoolean(values["ShiftShelf.showsMenuBar"]);
  const legacyDock = optionalBoolean(values["ShiftShelf.showsDockIconWhenNoWindowOpen"]);
  if (legacyMenu !== undefined || legacyDock !== undefined) {
    return legacyDock === true && legacyMenu === false ? "taskbar" : "background";
  }

  const hideFromDock = optionalBoolean(values["ShiftShelf.hideFromDock"]);
  return hideFromDock === false ? "taskbar" : "background";
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error("expected a Boolean preference");
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
