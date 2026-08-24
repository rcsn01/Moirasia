import { contextBridge, ipcRenderer } from 'electron'
import type { Appearance, AppearanceApi } from '@moirasia/desktop-shell'
import { createExithibitionBridge } from './bridge'

export { createExithibitionBridge } from './bridge'
export type { IpcRendererLike } from './bridge'

contextBridge.exposeInMainWorld('exithibition', Object.freeze(createExithibitionBridge(ipcRenderer)))

const appearanceApi: AppearanceApi = {
  getAppearance: () => ipcRenderer.invoke('desktop-shell:exithibition:appearance:get'),
  setAppearance: (value: Appearance) => ipcRenderer.invoke('desktop-shell:exithibition:appearance:set', value),
  onAppearance(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: Appearance) => listener(value)
    ipcRenderer.on('desktop-shell:exithibition:appearance:changed', handler)
    return () => ipcRenderer.removeListener('desktop-shell:exithibition:appearance:changed', handler)
  }
}
contextBridge.exposeInMainWorld('desktopShell', Object.freeze(appearanceApi))
