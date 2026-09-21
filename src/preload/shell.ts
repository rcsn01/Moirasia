import { contextBridge, ipcRenderer } from 'electron'
import { createAmoveBridge } from '../../apps/integrated/Amove/src/preload/bridge'
import { createBondedBridge } from '../../apps/integrated/Bonded/src/preload/bridge'
import { createShoutBridge } from '../../apps/integrated/Shout/src/preload/bridge'
import type { Appearance } from '@moirasia/desktop-shell'
import { IPC, type ApplicationId, type AppPresenceMode, type ControllerApi, type ControllerPage, type ControllerSnapshot, type ShellSettings, type UpdateState } from '../shared/contracts'
const api: ControllerApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.getSnapshot), refresh: () => ipcRenderer.invoke(IPC.refresh), getSettings: () => ipcRenderer.invoke(IPC.getSettings), getPage: () => ipcRenderer.invoke(IPC.getPage) as Promise<ControllerPage>,
  openApplication: (id: ApplicationId) => ipcRenderer.invoke(IPC.openApplication, id), quitApplication: (id: ApplicationId) => ipcRenderer.invoke(IPC.quitApplication, id),
  setAppearance: (product, appearance: Appearance) => ipcRenderer.invoke(IPC.setAppearance, product, appearance), setAllAppearances: (appearance: Appearance) => ipcRenderer.invoke(IPC.setAllAppearances, appearance),
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke(IPC.setLaunchAtLogin, enabled) as Promise<ShellSettings>, setAppPresence: (mode: AppPresenceMode) => ipcRenderer.invoke(IPC.setAppPresence, mode) as Promise<ShellSettings>, setApplicationLoginItem: (id, enabled) => ipcRenderer.invoke(IPC.setApplicationLoginItem, id, enabled),
  installFeature: (id: ApplicationId) => ipcRenderer.invoke(IPC.installFeature, id), uninstallFeature: (id: ApplicationId) => ipcRenderer.invoke(IPC.uninstallFeature, id),
  openFeature: (id: ApplicationId) => ipcRenderer.invoke(IPC.openFeature, id) as Promise<void>,
  reportPage: (page: ControllerPage) => ipcRenderer.invoke(IPC.reportPage, page) as Promise<void>,
  relaunchApp: () => ipcRenderer.invoke(IPC.relaunch) as Promise<void>,
  openLoginItemsSettings: () => ipcRenderer.invoke(IPC.openLoginItemsSettings),
  getUpdateState: () => ipcRenderer.invoke(IPC.getUpdateState) as Promise<UpdateState>,
  checkForUpdate: () => ipcRenderer.invoke(IPC.checkForUpdate) as Promise<UpdateState>,
  openReleasePage: () => ipcRenderer.invoke(IPC.openReleasePage) as Promise<void>,
  onSnapshot(listener) { const handler = (_event: Electron.IpcRendererEvent, snapshot: ControllerSnapshot) => listener(snapshot); ipcRenderer.on(IPC.snapshot, handler); return () => ipcRenderer.removeListener(IPC.snapshot, handler) },
  onNavigate(listener) { const handler = (_event: Electron.IpcRendererEvent, page: ControllerPage) => listener(page); ipcRenderer.on(IPC.navigate, handler); return () => ipcRenderer.removeListener(IPC.navigate, handler) },
  onUpdateState(listener) { const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state); ipcRenderer.on(IPC.updateState, handler); return () => ipcRenderer.removeListener(IPC.updateState, handler) }
}
// Bridge exposure is a security seam: every contextBridge call is an explicit,
// hand-reviewed statement of what leaves the preload sandbox. It is deliberately
// not driven by the feature catalog.
contextBridge.exposeInMainWorld('moirasia', Object.freeze(api))
contextBridge.exposeInMainWorld('amove', Object.freeze(createAmoveBridge(ipcRenderer)))
contextBridge.exposeInMainWorld('bonded', Object.freeze(createBondedBridge(ipcRenderer)))
contextBridge.exposeInMainWorld('shout', Object.freeze(createShoutBridge(ipcRenderer)))
