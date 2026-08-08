import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { isAppearance, isProductId } from '@moirasia/desktop-shell'
import { IPC, isApplicationId } from '../shared/contracts'
import type { ApplicationController } from './application-controller'
import type { ShellSettingsStore } from './settings'

export function registerControllerIpc(options: { window: BrowserWindow; controller: ApplicationController; settings: ShellSettingsStore; applyShellAppearance(): void }): () => void {
  const authorize = (event: IpcMainEvent | IpcMainInvokeEvent) => { if (event.sender !== options.window.webContents || event.sender.isDestroyed()) throw new Error('Unauthorized IPC sender') }
  const applicationId = (value: unknown) => { if (!isApplicationId(value)) throw new TypeError('Invalid application id'); return value }
  ipcMain.handle(IPC.getSnapshot, (event) => { authorize(event); return options.controller.snapshot() })
  ipcMain.handle(IPC.refresh, (event) => { authorize(event); return options.controller.refresh() })
  ipcMain.handle(IPC.getSettings, (event) => { authorize(event); return options.settings.get() })
  ipcMain.handle(IPC.openApplication, (event, id) => { authorize(event); return options.controller.open(applicationId(id)) })
  ipcMain.handle(IPC.quitApplication, (event, id) => { authorize(event); return options.controller.quit(applicationId(id)) })
  ipcMain.handle(IPC.setAppearance, async (event, product, appearance) => { authorize(event); if (!isProductId(product) || !isAppearance(appearance)) throw new TypeError('Invalid appearance'); const result = await options.controller.setAppearance(product, appearance); if (product === 'moirasia') options.applyShellAppearance(); return result })
  ipcMain.handle(IPC.setAllAppearances, async (event, appearance) => { authorize(event); if (!isAppearance(appearance)) throw new TypeError('Invalid appearance'); const result = await options.controller.setAllAppearances(appearance); options.applyShellAppearance(); return result })
  ipcMain.handle(IPC.setLaunchAtLogin, async (event, enabled) => { authorize(event); if (typeof enabled !== 'boolean') throw new TypeError('Invalid login setting'); const result = await options.settings.update({ launchAtLogin: enabled }); appSetLoginItem(enabled); return result })
  ipcMain.handle(IPC.setApplicationLoginItem, (event, id, enabled) => { authorize(event); if (typeof enabled !== 'boolean') throw new TypeError('Invalid login setting'); return options.controller.setLoginItem(applicationId(id), enabled) })
  ipcMain.handle(IPC.openLoginItemsSettings, (event) => { authorize(event); return options.controller.openLoginItemsSettings() })
  const unsubscribe = options.controller.subscribe((snapshot) => { if (!options.window.isDestroyed()) options.window.webContents.send(IPC.snapshot, snapshot) })
  const handlers = Object.values(IPC).filter((value) => value !== IPC.snapshot && value !== IPC.navigate)
  return () => { unsubscribe(); handlers.forEach((channel) => ipcMain.removeHandler(channel)) }
}
function appSetLoginItem(openAtLogin: boolean): void { void import('electron').then(({ app }) => app.setLoginItemSettings({ openAtLogin })) }
