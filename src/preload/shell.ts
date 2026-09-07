import { contextBridge, ipcRenderer } from 'electron'
import { createAmoveBridge } from '../../apps/integrated/Amove/src/preload/bridge'
import { createBondedBridge } from '../../apps/integrated/Bonded/src/preload/bridge'
import type { Appearance } from '@moirasia/desktop-shell'
import { IPC, type ApplicationId, type ControllerApi, type ControllerPage, type ControllerSnapshot, type ShellSettings } from '../shared/contracts'
const api: ControllerApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.getSnapshot), refresh: () => ipcRenderer.invoke(IPC.refresh), getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  openApplication: (id: ApplicationId) => ipcRenderer.invoke(IPC.openApplication, id), quitApplication: (id: ApplicationId) => ipcRenderer.invoke(IPC.quitApplication, id),
  setAppearance: (product, appearance: Appearance) => ipcRenderer.invoke(IPC.setAppearance, product, appearance), setAllAppearances: (appearance: Appearance) => ipcRenderer.invoke(IPC.setAllAppearances, appearance),
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke(IPC.setLaunchAtLogin, enabled) as Promise<ShellSettings>, setApplicationLoginItem: (id, enabled) => ipcRenderer.invoke(IPC.setApplicationLoginItem, id, enabled),
  installFeature: (id: ApplicationId) => ipcRenderer.invoke(IPC.installFeature, id), uninstallFeature: (id: ApplicationId) => ipcRenderer.invoke(IPC.uninstallFeature, id),
  openFeature: (id: ApplicationId) => ipcRenderer.invoke(IPC.openFeature, id) as Promise<void>,
  reportPage: (page: ControllerPage) => ipcRenderer.invoke(IPC.reportPage, page) as Promise<void>,
  relaunchApp: () => ipcRenderer.invoke(IPC.relaunch) as Promise<void>,
  openLoginItemsSettings: () => ipcRenderer.invoke(IPC.openLoginItemsSettings),
  onSnapshot(listener) { const handler = (_event: Electron.IpcRendererEvent, snapshot: ControllerSnapshot) => listener(snapshot); ipcRenderer.on(IPC.snapshot, handler); return () => ipcRenderer.removeListener(IPC.snapshot, handler) },
  onNavigate(listener) { const handler = (_event: Electron.IpcRendererEvent, page: ControllerPage) => listener(page); ipcRenderer.on(IPC.navigate, handler); return () => ipcRenderer.removeListener(IPC.navigate, handler) }
}
// Bridge exposure is a security seam: every contextBridge call is an explicit,
// hand-reviewed statement of what leaves the preload sandbox. It is deliberately
// not driven by the feature catalog.
contextBridge.exposeInMainWorld('moirasia', Object.freeze(api))
contextBridge.exposeInMainWorld('amove', Object.freeze(createAmoveBridge(ipcRenderer)))
contextBridge.exposeInMainWorld('bonded', Object.freeze(createBondedBridge(ipcRenderer)))
