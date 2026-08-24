import type { Platform, ShortcutBinding, ShortcutRegistrationIssue, WindowActionId } from "./contracts";
import { actionMeta, defaultBindings } from "./defaults";
import { windowActionIds } from "./contracts";

const modifierOrder = ["control", "alt", "shift", "meta"] as const;

export function shortcutChord(binding: ShortcutBinding): string {
  const key = binding.key.kind === "physical" ? binding.key.code : `carbon:${binding.key.keyCode}`;
  return `${modifierOrder.filter((item) => binding.modifiers.includes(item)).join("+")}+${key}`;
}

export function shortcutLabel(binding: ShortcutBinding, platform: Platform): string {
  const macSymbols: Record<string, string> = { control: "⌃", alt: "⌥", shift: "⇧", meta: "⌘" };
  const otherLabels: Record<string, string> = { control: "Ctrl", alt: "Alt", shift: "Shift", meta: "Meta" };
  const modifiers = modifierOrder
    .filter((item) => binding.modifiers.includes(item))
    .map((item) => (platform === "darwin" ? macSymbols[item] : otherLabels[item]));
  const rawKey = binding.key.kind === "physical" ? binding.key.code : carbonLabel(binding.key.keyCode);
  const key = rawKey.replace(/^Key/, "").replace(/^Arrow/, "");
  return platform === "darwin" ? `${modifiers.join("")}${arrowSymbol(key)}` : [...modifiers, arrowSymbol(key)].join("+");
}

function arrowSymbol(key: string): string {
  return ({ Left: "←", Right: "→", Up: "↑", Down: "↓" } as Record<string, string>)[key] ?? key;
}

export function validateBindings(
  bindings: Partial<Record<WindowActionId, ShortcutBinding>>,
  platform: Platform
): ShortcutRegistrationIssue[] {
  const issues: ShortcutRegistrationIssue[] = [];
  const seen = new Map<string, WindowActionId>();
  const complete = { ...defaultBindings(platform), ...bindings };
  for (const action of windowActionIds) {
    const binding = complete[action];
    if (binding.modifiers.length === 0) {
      issues.push({ action, code: "reserved", message: "Shortcuts must include at least one modifier key." });
      continue;
    }
    const chord = shortcutChord(binding);
    const owner = seen.get(chord);
    if (owner) {
      issues.push({
        action,
        code: "duplicate",
        message: `${actionMeta[owner].title} already owns this shortcut.`
      });
    } else {
      seen.set(chord, action);
    }
  }
  return issues;
}

export function isReservedShortcut(binding: ShortcutBinding, platform: Platform): boolean {
  if (binding.key.kind !== "physical") return false;
  if (platform === "darwin" && binding.modifiers.length === 1 && binding.modifiers[0] === "meta") {
    return new Set(["KeyA", "KeyC", "KeyF", "KeyH", "KeyM", "KeyN", "KeyO", "KeyP", "KeyQ", "KeyS", "KeyV", "KeyW", "KeyX", "KeyZ", "Tab", "Space", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]).has(binding.key.code);
  }
  return platform === "win32" && binding.modifiers.length === 1 && binding.modifiers[0] === "alt" && binding.key.code === "Tab";
}

const carbonCodes: Record<number, string> = {
  0: "KeyA", 1: "KeyS", 2: "KeyD", 3: "KeyF", 4: "KeyH", 5: "KeyG", 6: "KeyZ", 7: "KeyX", 8: "KeyC", 9: "KeyV",
  11: "KeyB", 12: "KeyQ", 13: "KeyW", 14: "KeyE", 15: "KeyR", 16: "KeyY", 17: "KeyT", 18: "Digit1", 19: "Digit2",
  20: "Digit3", 21: "Digit4", 22: "Digit6", 23: "Digit5", 24: "Equal", 25: "Digit9", 26: "Digit7", 27: "Minus",
  28: "Digit8", 29: "Digit0", 30: "BracketRight", 31: "KeyO", 32: "KeyU", 33: "BracketLeft", 34: "KeyI", 35: "KeyP",
  36: "Enter", 37: "KeyL", 38: "KeyJ", 39: "Quote", 40: "KeyK", 41: "Semicolon", 42: "Backslash", 43: "Comma",
  44: "Slash", 45: "KeyN", 46: "KeyM", 47: "Period", 48: "Tab", 49: "Space", 50: "Backquote", 51: "Backspace",
  53: "Escape", 115: "Home", 116: "PageUp", 117: "Delete", 119: "End", 121: "PageDown", 123: "ArrowLeft",
  124: "ArrowRight", 125: "ArrowDown", 126: "ArrowUp"
};

export function physicalCodeForCarbon(keyCode: number): string | undefined {
  return carbonCodes[keyCode];
}

export function carbonCodeForPhysical(code: string): number | undefined {
  return Object.entries(carbonCodes).find(([, value]) => value === code)?.[0] === undefined
    ? undefined
    : Number(Object.entries(carbonCodes).find(([, value]) => value === code)?.[0]);
}

function carbonLabel(keyCode: number): string {
  return physicalCodeForCarbon(keyCode) ?? `Key ${keyCode}`;
}
