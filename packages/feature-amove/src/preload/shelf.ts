import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ShelfBridge, ShelfMode, ShelfState } from "../shared/contracts";

const IPC = {
  shelfGetState: "amove:shelf:get-state", shelfStateChanged: "amove:shelf:state-changed",
  shelfSetMode: "amove:shelf:set-mode", shelfSetItemsExpanded: "amove:shelf:set-items-expanded", shelfAddPaths: "amove:shelf:add-paths", shelfPreloadPaths: "amove:shelf:preload-paths",
  shelfRemoveItems: "amove:shelf:remove-items", shelfSetDraft: "amove:shelf:set-draft",
  shelfBeginDrag: "amove:shelf:begin-drag", shelfRevealItems: "amove:shelf:reveal-items",
  shelfGetThumbnails: "amove:shelf:get-thumbnails",
  shelfCompleteDrag: "amove:shelf:complete-drag",
  shelfClose: "amove:shelf:close"
} as const;

const bridge: ShelfBridge = {
  getState: () => ipcRenderer.invoke(IPC.shelfGetState),
  subscribe(listener) { const handler = (_event: Electron.IpcRendererEvent, state: ShelfState) => listener(state); ipcRenderer.on(IPC.shelfStateChanged, handler); return () => ipcRenderer.removeListener(IPC.shelfStateChanged, handler); },
  setMode: (mode: ShelfMode) => ipcRenderer.invoke(IPC.shelfSetMode, { mode }),
  setItemsExpanded: (expanded: boolean) => ipcRenderer.invoke(IPC.shelfSetItemsExpanded, expanded),
  resolveDroppedFiles: (files: File[]) => ipcRenderer.invoke(IPC.shelfAddPaths, { paths: files.map((file) => webUtils.getPathForFile(file)).filter(Boolean) }),
  preloadDroppedFiles: (files: File[]) => ipcRenderer.send(IPC.shelfPreloadPaths, { paths: files.map((file) => webUtils.getPathForFile(file)).filter(Boolean) }),
  removeItems: (ids: string[]) => ipcRenderer.invoke(IPC.shelfRemoveItems, { ids }),
  setDraft: (draft: string) => ipcRenderer.invoke(IPC.shelfSetDraft, { draft }),
  beginDrag: (ids: string[]) => ipcRenderer.send(IPC.shelfBeginDrag, { ids }),
  revealItems: (ids: string[]) => ipcRenderer.invoke(IPC.shelfRevealItems, { ids }),
  getThumbnails: (ids: string[]) => ipcRenderer.invoke(IPC.shelfGetThumbnails, { ids }),
  completeDrag: (succeeded: boolean) => ipcRenderer.invoke(IPC.shelfCompleteDrag, succeeded),
  close: () => ipcRenderer.invoke(IPC.shelfClose)
};
contextBridge.exposeInMainWorld("amoveShelf", Object.freeze(bridge));
