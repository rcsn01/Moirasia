import type { AppSettings, Platform, ShortcutBinding, WindowActionId } from "./contracts";
import { windowActionIds } from "./contracts";

const macKeys: Record<WindowActionId, string> = {
  moveDisplayLeft: "ArrowLeft",
  moveDisplayRight: "ArrowRight",
  moveDisplayUp: "ArrowUp",
  moveDisplayDown: "ArrowDown",
  toggleShelf: "KeyS"
};

const nonMacKeys = macKeys;

export function defaultBindings(platform: Platform): Record<WindowActionId, ShortcutBinding> {
  const modifiers = platform === "darwin" ? (["control", "alt", "meta"] as const) : (["control", "alt", "shift"] as const);
  const keys = platform === "darwin" ? macKeys : nonMacKeys;
  return Object.fromEntries(
    windowActionIds.map((action) => [action, { key: { kind: "physical" as const, code: keys[action] }, modifiers: [...modifiers] }])
  ) as Record<WindowActionId, ShortcutBinding>;
}

export function defaultSettings(platform: Platform): AppSettings {
  return {
    schemaVersion: 1,
    presenceMode: "background",
    shortcutsByPlatform: { [platform]: defaultBindings(platform) },
    migrations: { macUserDefaultsV1: platform === "darwin" ? "pending" : "completed" }
  };
}

export const actionMeta: Record<WindowActionId, { title: string; detail: string; icon: string }> = {
  moveDisplayLeft: {
    title: "Move To Left Display",
    detail: "Move the frontmost window to the display on the left while preserving its relative placement.",
    icon: "←"
  },
  moveDisplayRight: {
    title: "Move To Right Display",
    detail: "Move the frontmost window to the display on the right while preserving its relative placement.",
    icon: "→"
  },
  moveDisplayUp: {
    title: "Move To Top Display",
    detail: "Move the frontmost window to the display above while preserving its relative placement.",
    icon: "↑"
  },
  moveDisplayDown: {
    title: "Move To Bottom Display",
    detail: "Move the frontmost window to the display below while preserving its relative placement.",
    icon: "↓"
  },
  toggleShelf: {
    title: "Toggle Shelf",
    detail: "Toggle the floating Shelf panel on or off.",
    icon: "▣"
  }
};
