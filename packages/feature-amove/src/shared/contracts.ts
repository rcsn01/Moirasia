import { z } from "zod";

export const platforms = ["darwin", "win32", "linux"] as const;
export type Platform = (typeof platforms)[number];

export const windowActionIds = [
  "moveDisplayLeft",
  "moveDisplayRight",
  "moveDisplayUp",
  "moveDisplayDown",
  "toggleShelf"
] as const;
export type WindowActionId = (typeof windowActionIds)[number];

export const modifierSchema = z.enum(["control", "alt", "shift", "meta"]);
export type ShortcutModifier = z.infer<typeof modifierSchema>;

export const shortcutKeySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("physical"), code: z.string().min(1).max(80) }).strict(),
  z.object({ kind: z.literal("darwinCarbon"), keyCode: z.number().int().min(0).max(65535) }).strict()
]);
export type ShortcutKey = z.infer<typeof shortcutKeySchema>;

export const shortcutBindingSchema = z
  .object({
    key: shortcutKeySchema,
    modifiers: z.array(modifierSchema).max(4)
  })
  .strict()
  .transform((binding) => ({ ...binding, modifiers: [...new Set(binding.modifiers)] }));
export type ShortcutBinding = z.input<typeof shortcutBindingSchema>;

export const presenceModeSchema = z.enum(["background", "taskbar"]);
export type PresenceMode = z.infer<typeof presenceModeSchema>;
export const shelfModeSchema = z.enum(["files", "editor"]);
export type ShelfMode = z.infer<typeof shelfModeSchema>;
export const shelfTransitionSchema = z.enum(["compact", "expanding", "editor", "collapsing"]);
export type ShelfTransition = z.infer<typeof shelfTransitionSchema>;

const shortcutsSchema = z.record(z.enum(windowActionIds), shortcutBindingSchema);

export const appSettingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    presenceMode: presenceModeSchema,
    shortcutsByPlatform: z
      .object({
        darwin: shortcutsSchema.optional(),
        win32: shortcutsSchema.optional(),
        linux: shortcutsSchema.optional()
      })
      .strict(),
    migrations: z
      .object({
        macUserDefaultsV1: z.enum(["pending", "completed", "completed-with-warnings"])
      })
      .strict()
  })
  .strict();
export type AppSettings = z.infer<typeof appSettingsSchema>;

export type CommandResult<T = undefined> =
  | { ok: true; value: T; message?: string }
  | { ok: false; code: string; message: string };

export interface ShortcutRegistrationIssue {
  action: WindowActionId;
  code: "duplicate" | "reserved" | "registration-failed" | "unsupported";
  message: string;
}

export interface AccessibilityState {
  required: boolean;
  granted: boolean;
  label: string;
}

export type HostMode = "standalone" | "suite";

export interface MainState {
  /** The suite owns app presence when this is "suite". */
  hostMode?: HostMode;
  platform: Platform;
  settings: AppSettings;
  statusMessage: string;
  lastActionMessage: string;
  shelfVisible: boolean;
  accessibility: AccessibilityState;
  shortcutIssues: ShortcutRegistrationIssue[];
  migrationWarning?: string;
}

export interface ShelfItemView {
  id: string;
  name: string;
  parentFolderName: string;
  isDirectory: boolean;
  size: number;
}

export interface ShelfThumbnailView {
  id: string;
  dataUrl: string;
  width?: number;
  height?: number;
}

export interface ShelfState {
  visible: boolean;
  mode: ShelfMode;
  transition: ShelfTransition;
  items: ShelfItemView[];
  itemsExpanded: boolean;
  draft: string;
  hint: string;
}

export const actionPayloadSchema = z.object({ action: z.enum(windowActionIds) }).strict();
export const recordShortcutPayloadSchema = z
  .object({ action: z.enum(windowActionIds), binding: shortcutBindingSchema })
  .strict();
export const resetShortcutPayloadSchema = z.object({ action: z.enum(windowActionIds).optional() }).strict();
export const presencePayloadSchema = z.object({ mode: presenceModeSchema }).strict();
export const shelfModePayloadSchema = z.object({ mode: shelfModeSchema }).strict();
export const shelfPathsPayloadSchema = z.object({ paths: z.array(z.string().min(1)).max(256) }).strict();
export const shelfIdsPayloadSchema = z.object({ ids: z.array(z.string().uuid()).max(256) }).strict();
export const shelfDraftPayloadSchema = z.object({ draft: z.string().max(2_000_000) }).strict();
export const shelfDragPayloadSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(256) }).strict();
export const shelfRevealPayloadSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(256) }).strict();
export const shelfThumbnailPayloadSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(256) }).strict();

export const IPC = {
  mainGetState: "amove:main:get-state",
  mainStateChanged: "amove:main:state-changed",
  mainPerformAction: "amove:main:perform-action",
  mainRecordShortcut: "amove:main:record-shortcut",
  mainSetShortcutRecording: "amove:main:set-shortcut-recording",
  mainResetShortcut: "amove:main:reset-shortcut",
  mainSetPresence: "amove:main:set-presence",
  mainRefreshAccessibility: "amove:main:refresh-accessibility",
  mainRequestAccessibility: "amove:main:request-accessibility",
  mainOpenAccessibilitySettings: "amove:main:open-accessibility-settings",
  mainShowShelf: "amove:main:show-shelf",
  mainCancelShelf: "amove:main:cancel-shelf",
  shelfGetState: "amove:shelf:get-state",
  shelfStateChanged: "amove:shelf:state-changed",
  shelfSetMode: "amove:shelf:set-mode",
  shelfSetItemsExpanded: "amove:shelf:set-items-expanded",
  shelfAddPaths: "amove:shelf:add-paths",
  shelfPreloadPaths: "amove:shelf:preload-paths",
  shelfRemoveItems: "amove:shelf:remove-items",
  shelfSetDraft: "amove:shelf:set-draft",
  shelfBeginDrag: "amove:shelf:begin-drag",
  shelfRevealItems: "amove:shelf:reveal-items",
  shelfGetThumbnails: "amove:shelf:get-thumbnails",
  shelfCompleteDrag: "amove:shelf:complete-drag",
  shelfClose: "amove:shelf:close"
} as const;

export type Unsubscribe = () => void;

export interface MainBridge {
  getState(): Promise<MainState>;
  subscribe(listener: (state: MainState) => void): Unsubscribe;
  performAction(action: WindowActionId): Promise<CommandResult>;
  recordShortcut(action: WindowActionId, binding: ShortcutBinding): Promise<CommandResult>;
  setShortcutRecording(active: boolean): Promise<CommandResult>;
  resetShortcut(action?: WindowActionId): Promise<CommandResult>;
  setPresenceMode(mode: PresenceMode): Promise<CommandResult>;
  refreshAccessibility(): Promise<CommandResult<AccessibilityState>>;
  requestAccessibility(): Promise<CommandResult<AccessibilityState>>;
  openAccessibilitySettings(): Promise<CommandResult>;
  showShelf(): Promise<CommandResult>;
  cancelShelf(): Promise<CommandResult>;
}

export interface ShelfBridge {
  getState(): Promise<ShelfState>;
  subscribe(listener: (state: ShelfState) => void): Unsubscribe;
  setMode(mode: ShelfMode): Promise<CommandResult>;
  setItemsExpanded(expanded: boolean): Promise<CommandResult>;
  resolveDroppedFiles(files: File[]): Promise<CommandResult>;
  preloadDroppedFiles(files: File[]): void;
  removeItems(ids: string[]): Promise<CommandResult>;
  setDraft(draft: string): Promise<CommandResult>;
  beginDrag(ids: string[]): void;
  revealItems(ids: string[]): Promise<CommandResult>;
  getThumbnails(ids: string[]): Promise<CommandResult<ShelfThumbnailView[]>>;
  completeDrag(succeeded: boolean): Promise<CommandResult>;
  close(): Promise<CommandResult>;
}
