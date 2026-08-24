import { contextBridge, ipcRenderer } from 'electron'
import type { Appearance, AppearanceApi } from '@moirasia/desktop-shell'
import { createAmoveBridge } from './bridge'

export { createAmoveBridge } from './bridge'
export type { IpcRendererLike } from './bridge'

const bridge = createAmoveBridge(ipcRenderer)
contextBridge.exposeInMainWorld('amove', Object.freeze(bridge))

const appearanceApi: AppearanceApi = {
  getAppearance: () => ipcRenderer.invoke('desktop-shell:amove:appearance:get'),
  setAppearance: (value: Appearance) => ipcRenderer.invoke('desktop-shell:amove:appearance:set', value),
  onAppearance(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: Appearance) => listener(value)
    ipcRenderer.on('desktop-shell:amove:appearance:changed', handler)
    return () => ipcRenderer.removeListener('desktop-shell:amove:appearance:changed', handler)
  }
}
contextBridge.exposeInMainWorld('desktopShell', Object.freeze(appearanceApi))
