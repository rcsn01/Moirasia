import { contextBridge, ipcRenderer } from 'electron'
import { createAmoveBridge } from '../../apps/Amove/src/preload/bridge'
import { createExithibitionBridge } from '../../apps/Exithibition/src/preload/bridge'
import { createOrbisBridge } from '../../apps/Orbis/src/preload/bridge'
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
contextBridge.exposeInMainWorld('moirasia', Object.freeze(api))
contextBridge.exposeInMainWorld('amove', Object.freeze(createAmoveBridge(ipcRenderer)))
contextBridge.exposeInMainWorld('exithibition', Object.freeze(createExithibitionBridge(ipcRenderer)))
contextBridge.exposeInMainWorld('orbis', Object.freeze(createOrbisBridge(ipcRenderer)))
