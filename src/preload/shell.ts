import { contextBridge, ipcRenderer } from 'electron'
import type { Appearance } from '@moirasia/desktop-shell'
import { IPC, type ApplicationId, type ControllerApi, type ControllerPage, type ControllerSnapshot, type ShellSettings } from '../shared/contracts'
const api: ControllerApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.getSnapshot), refresh: () => ipcRenderer.invoke(IPC.refresh), getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  openApplication: (id: ApplicationId) => ipcRenderer.invoke(IPC.openApplication, id), quitApplication: (id: ApplicationId) => ipcRenderer.invoke(IPC.quitApplication, id),
  setAppearance: (product, appearance: Appearance) => ipcRenderer.invoke(IPC.setAppearance, product, appearance), setAllAppearances: (appearance: Appearance) => ipcRenderer.invoke(IPC.setAllAppearances, appearance),
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke(IPC.setLaunchAtLogin, enabled) as Promise<ShellSettings>, setApplicationLoginItem: (id, enabled) => ipcRenderer.invoke(IPC.setApplicationLoginItem, id, enabled),
  openLoginItemsSettings: () => ipcRenderer.invoke(IPC.openLoginItemsSettings),
  onSnapshot(listener) { const handler = (_event: Electron.IpcRendererEvent, snapshot: ControllerSnapshot) => listener(snapshot); ipcRenderer.on(IPC.snapshot, handler); return () => ipcRenderer.removeListener(IPC.snapshot, handler) },
  onNavigate(listener) { const handler = (_event: Electron.IpcRendererEvent, page: ControllerPage) => listener(page); ipcRenderer.on(IPC.navigate, handler); return () => ipcRenderer.removeListener(IPC.navigate, handler) }
}
contextBridge.exposeInMainWorld('moirasia', api)
