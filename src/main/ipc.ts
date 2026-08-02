import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  IPC,
  isModuleId,
  isRailWidth,
  isShellPage,
  type ModuleId,
  type ShellSettingsPatch,
  type ShellPage
} from '../shared/contracts'
import type { ModuleManager } from './modules/manager'
import type { ShellSettingsStore } from './settings'

interface IpcOptions {
  readonly window: BrowserWindow
  readonly manager: ModuleManager
  readonly settings: ShellSettingsStore
  readonly setRailWidth: (width: number) => void
  readonly requestShutdown: () => void
  readonly requestStopModule: (id: ModuleId) => Promise<ReturnType<ModuleManager['snapshot']>>
  readonly requestStartModule: (id: ModuleId) => ReturnType<ModuleManager['start']>
  readonly requestActivateModule: (id: ModuleId) => ReturnType<ModuleManager['activate']>
  readonly applySettings: () => void
}

export function registerShellIpc(options: IpcOptions): () => void {
  const authorize = (event: IpcMainEvent | IpcMainInvokeEvent): void => {
    if (event.sender !== options.window.webContents || event.sender.isDestroyed()) {
      throw new Error('Unauthorized IPC sender')
    }
  }
  const moduleId = (value: unknown): ModuleId => {
    if (!isModuleId(value)) throw new TypeError('Invalid module id')
    return value
  }
  const shellPage = (value: unknown): ShellPage => {
    if (!isShellPage(value)) throw new TypeError('Invalid shell page')
    return value
  }

  ipcMain.handle(IPC.getSnapshot, (event) => {
    authorize(event)
    return options.manager.snapshot()
  })
  ipcMain.handle(IPC.getSettings, (event) => {
    authorize(event)
    return options.settings.get()
  })
  ipcMain.handle(IPC.updateSettings, async (event, value: unknown) => {
    authorize(event)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('Invalid settings patch')
    }
    const settings = await options.settings.update(value as ShellSettingsPatch)
    options.applySettings()
    return settings
  })
  ipcMain.handle(IPC.startModule, (event, value: unknown) => {
    authorize(event)
    return options.requestStartModule(moduleId(value))
  })
  ipcMain.handle(IPC.activateModule, async (event, value: unknown) => {
    authorize(event)
    const id = moduleId(value)
    const result = await options.requestActivateModule(id)
    await options.settings.update({ priorSelection: id })
    return result
  })
  ipcMain.handle(IPC.stopModule, (event, value: unknown) => {
    authorize(event)
    return options.requestStopModule(moduleId(value))
  })
  ipcMain.handle(IPC.showPage, async (event, value: unknown) => {
    authorize(event)
    const page = shellPage(value)
    const result = await options.manager.hideActive()
    await options.settings.update({ priorSelection: page })
    return result
  })

  const onSetRailWidth = (event: IpcMainEvent, value: unknown): void => {
    authorize(event)
    if (!isRailWidth(value)) throw new TypeError('Invalid rail width')
    options.setRailWidth(value)
  }
  const onQuit = (event: IpcMainEvent): void => {
    authorize(event)
    options.requestShutdown()
  }
  ipcMain.on(IPC.setRailWidth, onSetRailWidth)
  ipcMain.on(IPC.quit, onQuit)

  const unsubscribe = options.manager.subscribe((snapshot) => {
    if (!options.window.isDestroyed() && !options.window.webContents.isDestroyed()) {
      options.window.webContents.send(IPC.snapshot, snapshot)
    }
  })

  return () => {
    unsubscribe()
    ipcMain.removeHandler(IPC.getSnapshot)
    ipcMain.removeHandler(IPC.getSettings)
    ipcMain.removeHandler(IPC.updateSettings)
    ipcMain.removeHandler(IPC.startModule)
    ipcMain.removeHandler(IPC.activateModule)
    ipcMain.removeHandler(IPC.stopModule)
    ipcMain.removeHandler(IPC.showPage)
    ipcMain.removeListener(IPC.setRailWidth, onSetRailWidth)
    ipcMain.removeListener(IPC.quit, onQuit)
  }
}
