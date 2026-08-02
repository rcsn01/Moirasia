import { contextBridge, ipcRenderer } from 'electron'
import type {
  ModuleId,
  ModuleSnapshot,
  ShellApi,
  ShellPage,
  ShellSettings,
  ShellSettingsPatch
} from '../shared/contracts'

const IPC = {
  getSnapshot: 'shell:get-snapshot',
  getSettings: 'shell:get-settings',
  updateSettings: 'shell:update-settings',
  startModule: 'shell:start-module',
  activateModule: 'shell:activate-module',
  stopModule: 'shell:stop-module',
  showPage: 'shell:show-page',
  setRailWidth: 'shell:set-rail-width',
  quit: 'shell:quit',
  snapshot: 'shell:snapshot',
  navigate: 'shell:navigate'
} as const

const isDestination = (value: unknown): value is ShellPage | ModuleId =>
  value === 'home' ||
  value === 'settings' ||
  value === 'amove' ||
  value === 'vox' ||
  value === 'exithibition'

const api: ShellApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.getSnapshot) as Promise<ModuleSnapshot>,
  getSettings: () => ipcRenderer.invoke(IPC.getSettings) as Promise<ShellSettings>,
  updateSettings: (patch: ShellSettingsPatch) =>
    ipcRenderer.invoke(IPC.updateSettings, patch) as Promise<ShellSettings>,
  startModule: (id) => ipcRenderer.invoke(IPC.startModule, id) as Promise<ModuleSnapshot>,
  activateModule: (id) => ipcRenderer.invoke(IPC.activateModule, id) as Promise<ModuleSnapshot>,
  stopModule: (id) => ipcRenderer.invoke(IPC.stopModule, id) as Promise<ModuleSnapshot>,
  showPage: (page) => ipcRenderer.invoke(IPC.showPage, page) as Promise<ModuleSnapshot>,
  setRailWidth: (width) => ipcRenderer.send(IPC.setRailWidth, width),
  quit: () => ipcRenderer.send(IPC.quit),
  onSnapshot(listener) {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: ModuleSnapshot): void => listener(snapshot)
    ipcRenderer.on(IPC.snapshot, handler)
    return () => ipcRenderer.removeListener(IPC.snapshot, handler)
  },
  onNavigate(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (isDestination(value)) listener(value)
    }
    ipcRenderer.on(IPC.navigate, handler)
    return () => ipcRenderer.removeListener(IPC.navigate, handler)
  }
}

contextBridge.exposeInMainWorld('moirasia', api)
