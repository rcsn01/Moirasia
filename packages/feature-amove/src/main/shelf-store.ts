import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { CommandResult, ShelfItemView, ShelfMode, ShelfState, ShelfTransition } from "../shared/contracts";

interface ShelfItem extends ShelfItemView { path: string; normalizedPath: string }

export class ShelfStore {
  private items: ShelfItem[] = [];
  private visible = false;
  private mode: ShelfMode = "files";
  private transition: ShelfTransition = "compact";
  private itemsExpanded = false;
  private draft = "";
  private listeners = new Set<(state: ShelfState) => void>();

  subscribe(listener: (state: ShelfState) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  getState(): ShelfState {
    return {
      visible: this.visible,
      mode: this.mode,
      transition: this.transition,
      items: this.items.map(({ id, name, parentFolderName, isDirectory, size }) => ({ id, name, parentFolderName, isDirectory, size })),
      itemsExpanded: this.itemsExpanded,
      draft: this.draft,
      hint: shelfHint(this.items.length)
    };
  }

  setVisible(visible: boolean): void { this.visible = visible; this.emit(); }
  setTransition(transition: ShelfTransition): void {
    this.transition = transition;
    this.mode = transition === "editor" || transition === "expanding" ? "editor" : transition === "collapsing" ? "files" : this.mode;
    this.emit();
  }
  setMode(mode: ShelfMode): void { this.mode = mode; if (mode === "editor") this.itemsExpanded = false; this.emit(); }
  setItemsExpanded(expanded: boolean): void { this.itemsExpanded = expanded && this.items.length > 0; this.emit(); }
  setDraft(draft: string): void { this.draft = draft; this.emit(); }

  async addPaths(paths: string[], platform: NodeJS.Platform): Promise<CommandResult> {
    const seen = new Set(this.items.map((item) => item.normalizedPath));
    let added = 0;
    const invalid: string[] = [];
    for (const candidate of paths) {
      try {
        const path = await realpath(candidate);
        const normalizedPath = platform === "win32" ? path.toLocaleLowerCase("en-US") : path;
        if (seen.has(normalizedPath)) continue;
        const details = await stat(path);
        this.items.push({ id: randomUUID(), path, normalizedPath, name: basename(path), parentFolderName: basename(dirname(path)) || dirname(path), isDirectory: details.isDirectory(), size: details.size });
        seen.add(normalizedPath);
        added += 1;
      } catch { invalid.push(candidate); }
    }
    this.emit();
    if (invalid.length > 0 && added === 0) return { ok: false, code: "invalid-path", message: "None of the dropped items still exist." };
    return { ok: true, value: undefined, message: invalid.length > 0 ? `${added} item(s) staged; ${invalid.length} unavailable item(s) were skipped.` : `${added} item(s) staged.` };
  }

  remove(ids: string[]): void {
    const set = new Set(ids);
    this.items = this.items.filter((item) => !set.has(item.id));
    if (this.items.length === 0) this.itemsExpanded = false;
    this.emit();
  }
  async removeUnavailableItems(): Promise<string[]> {
    const snapshot = this.items.map(({ id, path }) => ({ id, path }));
    const unavailable = await Promise.all(snapshot.map(async ({ id, path }) => {
      try {
        await stat(path);
        return undefined;
      } catch {
        return id;
      }
    }));
    const ids = unavailable.filter((id): id is string => id !== undefined);
    if (ids.length === 0) return [];
    const set = new Set(ids);
    this.items = this.items.filter((item) => !set.has(item.id));
    if (this.items.length === 0) this.itemsExpanded = false;
    this.emit();
    return ids;
  }
  pathsFor(ids: string[]): string[] { const set = new Set(ids); return this.items.filter((item) => set.has(item.id)).map((item) => item.path); }
  thumbnailSourcesFor(ids: string[]): Array<{ id: string; path: string; isDirectory: boolean }> {
    const set = new Set(ids);
    return this.items.filter((item) => set.has(item.id)).map(({ id, path, isDirectory }) => ({ id, path, isDirectory }));
  }
  clearItems(): void { this.items = []; this.itemsExpanded = false; this.emit(); }
  clear(): void { this.items = []; this.itemsExpanded = false; this.draft = ""; this.mode = "files"; this.transition = "compact"; this.emit(); }

  private emit(): void { const state = this.getState(); for (const listener of this.listeners) listener(state); }
}

function shelfHint(count: number): string {
  if (count === 0) return "";
  if (count === 1) return "1 item is staged on the Shelf. Drag it out when you reach the destination.";
  return `${count} items are staged on the Shelf. Drag them out when you reach the destination.`;
}
