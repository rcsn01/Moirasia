import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { CommandResult, Platform, ShortcutBinding, ShortcutRegistrationIssue, WindowActionId } from "../shared/contracts";
import { carbonCodeForPhysical } from "../shared/shortcuts";

interface NativeModule {
  registerHotkeys(bindingsJson: string): string;
  unregisterHotkeys(): void;
  setHotkeyPolicy(appFocused: boolean, shelfVisible: boolean, recording: boolean): void;
  pollHotkey(): string | null;
  moveWindow(direction: string): string;
  accessibilityStatus(): boolean;
  requestAccessibility(): boolean;
  readLegacyPreferences(): string;
  enableMoveFileDrag(): boolean;
  disableMoveFileDrag(): void;
}

const actionOrder: WindowActionId[] = [
  "moveDisplayLeft",
  "moveDisplayRight",
  "moveDisplayUp",
  "moveDisplayDown",
  "toggleShelf"
];

export class NativeBackend {
  private readonly platform: Platform;
  private readonly native: NativeModule | undefined;
  private pollTimer: NodeJS.Timeout | undefined;

  constructor(platform: Platform, nativePath?: string) {
    this.platform = platform;
    this.native = loadNativeAddon(platform, nativePath);
    if (platform === "darwin") {
      try { this.native?.enableMoveFileDrag(); } catch { /* An incompatible addon is reported as unavailable below. */ }
    }
  }

  isAvailable(): boolean { return this.native !== undefined; }

  registerHotkeys(bindings: Record<WindowActionId, ShortcutBinding>): ShortcutRegistrationIssue[] {
    if (!this.native) {
      return actionOrder.map((action) => ({ action, code: "registration-failed", message: "The Amove native addon is not available in this build." }));
    }
    const records = actionOrder.flatMap((action) => {
      const binding = bindings[action];
      const keyCode = nativeKeyCode(binding, this.platform);
      return keyCode === undefined ? [] : [{ action, key_code: keyCode, modifiers: binding.modifiers }];
    });
    const unsupported = actionOrder
      .filter((action) => nativeKeyCode(bindings[action], this.platform) === undefined)
      .map((action): ShortcutRegistrationIssue => ({ action, code: "unsupported", message: "This physical key is not supported by the native hotkey adapter." }));
    try {
      return [...unsupported, ...(JSON.parse(this.native.registerHotkeys(JSON.stringify(records))) as ShortcutRegistrationIssue[])];
    } catch (error) {
      return [{ action: "toggleShelf", code: "registration-failed", message: `Native hotkeys failed: ${errorMessage(error)}` }];
    }
  }

  startPolling(onAction: (action: WindowActionId) => void): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      try {
        let action = this.native?.pollHotkey();
        while (action != null) {
          if (actionOrder.includes(action as WindowActionId)) onAction(action as WindowActionId);
          action = this.native?.pollHotkey();
        }
      } catch {
        // The main process must stay alive when an addon is incompatible.
      }
    }, 25);
    this.pollTimer.unref();
  }

  stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  setHotkeyPolicy(appFocused: boolean, shelfVisible: boolean, recording: boolean): void {
    this.native?.setHotkeyPolicy(appFocused, shelfVisible, recording);
  }

  moveWindow(action: WindowActionId): CommandResult {
    const direction = ({ moveDisplayLeft: "left", moveDisplayRight: "right", moveDisplayUp: "up", moveDisplayDown: "down" } as Partial<Record<WindowActionId, string>>)[action];
    if (!direction) return { ok: false, code: "unsupported-action", message: "This action cannot be handled by the window adapter." };
    if (!this.native) return { ok: false, code: "native-addon-unavailable", message: "The Amove native addon is not available in this build." };
    try { return JSON.parse(this.native.moveWindow(direction)) as CommandResult; }
    catch (error) { return { ok: false, code: "native-error", message: errorMessage(error) }; }
  }

  accessibilityStatus(): boolean { return this.platform === "win32" || (this.native?.accessibilityStatus() ?? false); }
  requestAccessibility(): boolean { return this.platform === "win32" || (this.native?.requestAccessibility() ?? false); }

  async readLegacyPreferences(): Promise<Record<string, unknown> | undefined> {
    if (this.platform !== "darwin") return {};
    if (!this.native) return undefined;
    return JSON.parse(this.native.readLegacyPreferences()) as Record<string, unknown>;
  }

  dispose(): void {
    this.stopPolling();
    try { this.native?.unregisterHotkeys(); } catch { /* Addon teardown is best effort. */ }
    try { this.native?.disableMoveFileDrag(); } catch { /* Addon teardown is best effort. */ }
  }
}

function loadNativeAddon(platform: Platform, injectedPath?: string): NativeModule | undefined {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const names = platform === "darwin"
    ? [`amove-native.darwin-${arch}.node`, `index.darwin-${arch}.node`, "amove-native.darwin-universal.node", "index.darwin-universal.node", "amove-native.node", "index.node"]
    : platform === "win32"
      ? ["amove-native.win32-x64-msvc.node", "index.win32-x64-msvc.node", "amove-native.node", "index.node"]
      : ["amove-native.linux-x64-gnu.node", "index.linux-x64-gnu.node", "amove-native.node", "index.node"];
  const exact = injectedPath?.endsWith('.node') ? [injectedPath] : [];
  const roots = injectedPath && exact.length === 0 ? [injectedPath, join(injectedPath, 'native')] : app.isPackaged
    ? [join(process.resourcesPath, "native"), join(process.resourcesPath, "app.asar.unpacked", "native")]
    : [join(app.getAppPath(), "native"), join(process.cwd(), "native")];
  const candidates = exact.length > 0 ? exact : roots.flatMap((root) => names.map((name) => join(root, name)));
  const require = createRequire(import.meta.url);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try { return require(candidate) as NativeModule; } catch { /* An incompatible binary is unavailable. */ }
  }
  return undefined;
}

function nativeKeyCode(binding: ShortcutBinding, platform: Platform): number | undefined {
  if (platform === "darwin") {
    return binding.key.kind === "darwinCarbon" ? binding.key.keyCode : carbonCodeForPhysical(binding.key.code);
  }
  if (binding.key.kind !== "physical") return undefined;
  const code = binding.key.code;
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  return ({ ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28, Space: 0x20, Tab: 0x09, Enter: 0x0d, Escape: 0x1b } as Record<string, number>)[code];
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
