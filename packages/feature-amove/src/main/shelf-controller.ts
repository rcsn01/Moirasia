import { join } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { app, BrowserWindow, nativeImage, screen } from "electron";
import { IPC, type ShelfMode, type ShelfThumbnailView } from "../shared/contracts";
import { ShelfStore } from "./shelf-store";
import { windowBackgrounds } from "@moirasia/ui-react/tokens";
import { sendToRenderer } from "@moirasia/desktop-shell/main";

const COMPACT = { width: 216, height: 208 };
const ITEMS_EXPANDED = { width: 394, height: 394 };
const EXPANDED = { width: 520, height: 340 };
const DURATION = 200;
const PATH_CHECK_INTERVAL = 250;

export class ShelfController {
  readonly store = new ShelfStore();
  private window: BrowserWindow | undefined;
  private animation: NodeJS.Timeout | undefined;
  private animationResolve: (() => void) | undefined;
  private animationGeneration = 0;
  private draggedItemIds: string[] = [];
  private pathMonitor: NodeJS.Timeout | undefined;
  private pathCheck: Promise<void> | undefined;
  private readonly thumbnailCache = new Map<string, Promise<Omit<ShelfThumbnailView, "id">>>();
  private readonly unsubscribeStore: () => void;

  constructor(private readonly preloadPath: string, private readonly appIconPath: string, private readonly rendererTarget?: string,
    private readonly createWindow?: (options: Electron.BrowserWindowConstructorOptions) => Promise<BrowserWindow>,
    private readonly rendererRoot?: string) {
    this.unsubscribeStore = this.store.subscribe((state) => {
      if (this.window) sendToRenderer(this.window.webContents, IPC.shelfStateChanged, state);
      if (state.visible && state.items.length > 0) this.startPathMonitor();
      else this.stopPathMonitor();
    });
  }

  getWindow(): BrowserWindow | undefined { return this.window; }
  isVisible(): boolean { return this.window?.isVisible() ?? false; }

  async ensureWindow(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const options: Electron.BrowserWindowConstructorOptions = {
      width: COMPACT.width, height: COMPACT.height, minWidth: COMPACT.width, minHeight: COMPACT.height,
      frame: false, transparent: false, backgroundColor: windowBackgrounds.amove.shelf, hasShadow: false, resizable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false, roundedCorners: true, acceptFirstMouse: true,
      webPreferences: { preload: this.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !process.env.CI }
    };
    const window = this.createWindow ? await this.createWindow(options) : new BrowserWindow(options);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => { if (url !== window.webContents.getURL()) event.preventDefault(); });
    window.setAlwaysOnTop(true, process.platform === "darwin" ? "status" : "floating");
    if (process.platform === "darwin") window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    window.on("closed", () => { this.cancelAnimation(); this.window = undefined; });
    this.window = window;
    if (this.rendererTarget && isRendererUrl(this.rendererTarget)) await window.loadURL(this.rendererTarget);
    else if (this.rendererTarget) await window.loadFile(this.rendererTarget);
    else await window.loadFile(join(this.rendererRoot ?? join(__dirname, "../renderer"), "shelf.html"));
    return window;
  }

  async show(): Promise<void> {
    const window = await this.ensureWindow();
    this.cancelAnimation();
    const state = this.store.getState();
    const expanded = state.mode === "editor";
    const size = expanded ? EXPANDED : state.itemsExpanded ? ITEMS_EXPANDED : COMPACT;
    const anchor = screen.getCursorScreenPoint();
    window.setBounds({ x: anchor.x, y: anchor.y, ...size }, false);
    window.setResizable(expanded);
    this.store.setTransition(expanded ? "editor" : "compact");
    window.showInactive();
    if (expanded) window.focus();
    this.store.setVisible(true);
  }

  hideAndClearItems(): void {
    this.cancelAnimation();
    this.draggedItemIds = [];
    this.window?.hide();
    this.store.clearItems();
    this.store.setVisible(false);
  }
  cancelAndClear(): void {
    this.cancelAnimation();
    this.draggedItemIds = [];
    this.window?.hide();
    this.store.clear();
    this.store.setVisible(false);
  }

  async setMode(mode: ShelfMode): Promise<void> {
    const window = await this.ensureWindow();
    if (mode === "editor" && this.store.getState().transition !== "editor") {
      this.store.setMode("editor");
      await this.animate(window, EXPANDED, "expanding", "editor");
      window.setResizable(true);
      window.focus();
      sendToRenderer(window.webContents, IPC.shelfStateChanged, this.store.getState());
    } else if (mode === "files" && this.store.getState().transition !== "compact") {
      this.store.setMode("files");
      window.setResizable(false);
      await this.animate(window, COMPACT, "collapsing", "compact");
    }
  }

  async setItemsExpanded(expanded: boolean): Promise<void> {
    const window = await this.ensureWindow();
    if (this.store.getState().mode !== "files") return;
    this.store.setItemsExpanded(expanded);
    await this.animateItemsPanel(window, this.store.getState().itemsExpanded ? ITEMS_EXPANDED : COMPACT);
  }

  beginDrag(ids: string[]): boolean {
    const availableIds = new Set(this.store.getState().items.map((item) => item.id));
    const draggedItemIds = [...new Set(ids)].filter((id) => availableIds.has(id));
    const paths = this.store.pathsFor(draggedItemIds);
    if (paths.length === 0 || !this.window) return false;
    this.draggedItemIds = draggedItemIds;
    let icon = nativeImage.createFromPath(this.appIconPath);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
    this.window.webContents.startDrag({ file: paths[0]!, files: paths, icon: icon.resize({ width: 32, height: 32 }) });
    return true;
  }

  async getThumbnails(ids: string[]): Promise<ShelfThumbnailView[]> {
    return Promise.all(this.store.thumbnailSourcesFor(ids).map(async ({ id, path, isDirectory }) => {
      const preview = await this.getCachedThumbnail(path, isDirectory);
      return { id, ...preview };
    }));
  }

  async preloadPaths(paths: string[]): Promise<void> {
    await Promise.all(paths.map(async (candidate) => {
      try {
        const path = await realpath(candidate);
        const details = await stat(path);
        await this.getCachedThumbnail(path, details.isDirectory());
      } catch {
        // A dragged item can disappear before it is dropped; staging validates it again.
      }
    }));
  }

  completeDrag(succeeded: boolean): void {
    if (this.draggedItemIds.length === 0) return;
    const draggedItemIds = this.draggedItemIds;
    this.draggedItemIds = [];
    if (!succeeded) return;
    this.store.remove(draggedItemIds);
    if (this.store.getState().items.length === 0) {
      this.cancelAnimation();
      this.window?.hide();
      this.store.setVisible(false);
    }
  }

  reconcileStagedPaths(): Promise<void> {
    if (this.pathCheck) return this.pathCheck;
    const check = (async () => {
      const removedIds = await this.store.removeUnavailableItems();
      const state = this.store.getState();
      if (removedIds.length > 0 && state.items.length === 0 && state.visible) {
        this.cancelAnimation();
        this.draggedItemIds = [];
        this.window?.hide();
        this.store.setVisible(false);
      }
    })();
    this.pathCheck = check;
    return check.finally(() => {
      if (this.pathCheck === check) this.pathCheck = undefined;
    });
  }

  dispose(): void {
    this.stopPathMonitor(); this.cancelAnimation(); this.unsubscribeStore();
    this.window?.destroy(); this.window = undefined; this.thumbnailCache.clear(); this.draggedItemIds = [];
  }

  private getCachedThumbnail(path: string, isDirectory: boolean): Promise<Omit<ShelfThumbnailView, "id">> {
    const cached = this.thumbnailCache.get(path);
    if (cached) return cached;
    if (this.thumbnailCache.size >= 256) {
      const oldestPath = this.thumbnailCache.keys().next().value;
      if (oldestPath) this.thumbnailCache.delete(oldestPath);
    }
    const thumbnail = this.createSystemThumbnail(path, isDirectory);
    this.thumbnailCache.set(path, thumbnail);
    return thumbnail;
  }

  private async createSystemThumbnail(path: string, isDirectory: boolean): Promise<Omit<ShelfThumbnailView, "id">> {
    let dimensions: Pick<ShelfThumbnailView, "width" | "height"> = {};
    if (!isDirectory) {
      const source = nativeImage.createFromPath(path);
      if (!source.isEmpty()) dimensions = source.getSize();
    }
    if (!isDirectory && (process.platform === "darwin" || process.platform === "win32")) {
      try {
        const thumbnail = await nativeImage.createThumbnailFromPath(path, thumbnailRequestSize(dimensions));
        if (!thumbnail.isEmpty()) return { dataUrl: thumbnail.toDataURL(), ...dimensions };
      } catch {
        // Quick Look can fail for unsupported or incomplete files; use the system icon below.
      }
    }
    try {
      const icon = await app.getFileIcon(path, { size: "large" });
      return { dataUrl: icon.isEmpty() ? "" : icon.toDataURL(), ...dimensions };
    } catch {
      return { dataUrl: "", ...dimensions };
    }
  }

  private animateItemsPanel(window: BrowserWindow, target: { width: number; height: number }): Promise<void> {
    this.cancelAnimation();
    const generation = ++this.animationGeneration;
    const start = window.getBounds();
    const startedAt = performance.now();
    return new Promise((resolve) => {
      this.animationResolve = resolve;
      const frame = () => {
        if (generation !== this.animationGeneration || window.isDestroyed() || !window.isVisible()) { this.animationResolve = undefined; resolve(); return; }
        const elapsed = Math.min(1, (performance.now() - startedAt) / DURATION);
        const eased = elapsed < 0.5 ? 2 * elapsed * elapsed : 1 - Math.pow(-2 * elapsed + 2, 2) / 2;
        window.setBounds({ x: start.x, y: start.y, width: Math.round(start.width + (target.width - start.width) * eased), height: Math.round(start.height + (target.height - start.height) * eased) }, false);
        if (elapsed >= 1) {
          if (this.animation) clearInterval(this.animation);
          this.animation = undefined;
          this.animationResolve = undefined;
          resolve();
        }
      };
      frame();
      this.animation = setInterval(frame, 16);
    });
  }

  private animate(window: BrowserWindow, target: { width: number; height: number }, during: "expanding" | "collapsing", after: "editor" | "compact"): Promise<void> {
    this.cancelAnimation();
    const generation = ++this.animationGeneration;
    const start = window.getBounds();
    const startedAt = performance.now();
    this.store.setTransition(during);
    return new Promise((resolve) => {
      this.animationResolve = resolve;
      const frame = () => {
        if (generation !== this.animationGeneration || window.isDestroyed() || !window.isVisible()) { this.animationResolve = undefined; resolve(); return; }
        const elapsed = Math.min(1, (performance.now() - startedAt) / DURATION);
        const eased = elapsed < 0.5 ? 2 * elapsed * elapsed : 1 - Math.pow(-2 * elapsed + 2, 2) / 2;
        window.setBounds({ x: start.x, y: start.y, width: Math.round(start.width + (target.width - start.width) * eased), height: Math.round(start.height + (target.height - start.height) * eased) }, false);
        if (elapsed >= 1) {
          if (this.animation) clearInterval(this.animation);
          this.animation = undefined;
          this.animationResolve = undefined;
          this.store.setTransition(after);
          resolve();
        }
      };
      frame();
      this.animation = setInterval(frame, 16);
    });
  }

  private cancelAnimation(): void {
    this.animationGeneration += 1;
    if (this.animation) clearInterval(this.animation);
    this.animation = undefined;
    this.animationResolve?.();
    this.animationResolve = undefined;
  }

  private startPathMonitor(): void {
    if (this.pathMonitor) return;
    void this.reconcileStagedPaths();
    this.pathMonitor = setInterval(() => void this.reconcileStagedPaths(), PATH_CHECK_INTERVAL);
    this.pathMonitor.unref();
  }

  private stopPathMonitor(): void {
    if (this.pathMonitor) clearInterval(this.pathMonitor);
    this.pathMonitor = undefined;
  }
}

function isRendererUrl(value: string): boolean { return value.startsWith('http://') || value.startsWith('https://') }

export function thumbnailRequestSize(dimensions: Pick<ShelfThumbnailView, "width" | "height">): { width: number; height: number } {
  const width = dimensions.width;
  const height = dimensions.height;
  if (!width || !height) return { width: 128, height: 128 };
  const scale = 128 / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}
