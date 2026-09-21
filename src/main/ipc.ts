import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { isAppearance, isProductId } from '@moirasia/desktop-shell'
import { isFeatureId } from '@moirasia/desktop-shell/feature'
import { sendToRenderer } from '@moirasia/desktop-shell/main'
import { IPC, idleUpdateState, isApplicationId, isAppPresenceMode, isControllerPage, type AppPresenceMode } from '../shared/contracts'
import type { ApplicationController } from './application-controller'
import type { AppUpdater } from './app-updater'
import type { NativeHostClientLike } from '../shared/native-host-contracts'
import type { ShellSettingsStore } from './settings'

export function registerControllerIpc(options: { window: BrowserWindow; controller: ApplicationController; settings: ShellSettingsStore; applyShellAppearance(): void; applyAppPresence(mode: AppPresenceMode): void; nativeClient?: NativeHostClientLike; updater?: AppUpdater }): () => void {
  const authorize = (event: IpcMainEvent | IpcMainInvokeEvent) => { if (event.sender !== options.window.webContents || event.sender.isDestroyed()) throw new Error('Unauthorized IPC sender') }
  const applicationId = (value: unknown) => { if (!isApplicationId(value)) throw new TypeError('Invalid application id'); return value }
  const featureId = (value: unknown) => { if (!isFeatureId(value)) throw new TypeError('Invalid feature id'); return value }
  ipcMain.handle(IPC.getSnapshot, (event) => { authorize(event); return options.controller.snapshot() })
  ipcMain.handle(IPC.refresh, (event) => { authorize(event); return options.controller.refresh() })
  ipcMain.handle(IPC.getSettings, (event) => { authorize(event); return options.settings.get() })
  ipcMain.handle(IPC.getPage, (event) => { authorize(event); return options.controller.restorablePage() })
  ipcMain.handle(IPC.openApplication, (event, id) => { authorize(event); return options.controller.open(applicationId(id)) })
  ipcMain.handle(IPC.quitApplication, (event, id) => { authorize(event); return options.controller.quit(applicationId(id)) })
  ipcMain.handle(IPC.setAppearance, async (event, product, appearance) => { authorize(event); if (!isProductId(product) || !isAppearance(appearance)) throw new TypeError('Invalid appearance'); const result = await options.controller.setAppearance(product, appearance); if (product === 'moirasia') options.applyShellAppearance(); return result })
  ipcMain.handle(IPC.setAllAppearances, async (event, appearance) => { authorize(event); if (!isAppearance(appearance)) throw new TypeError('Invalid appearance'); const result = await options.controller.setAllAppearances(appearance); options.applyShellAppearance(); return result })
  ipcMain.handle(IPC.setLaunchAtLogin, async (event, enabled) => {
    authorize(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Invalid login setting')
    if (options.nativeClient) {
      await options.nativeClient.request('host.setLaunchAtLogin', { enabled })
      appSetLoginItem(enabled)
      const snapshot = await options.nativeClient.getSnapshot()
      if (snapshot) options.settings.setCached(snapshot.settings)
      return options.settings.get()
    }
    const result = await options.settings.update({ launchAtLogin: enabled }); appSetLoginItem(enabled); return result
  })
  ipcMain.handle(IPC.setAppPresence, async (event, mode) => {
    authorize(event)
    if (!isAppPresenceMode(mode)) throw new TypeError('Invalid app presence')
    options.applyAppPresence(mode)
    if (options.nativeClient) {
      await options.nativeClient.request('host.setPresence', { mode })
      const snapshot = await options.nativeClient.getSnapshot()
      if (snapshot) options.settings.setCached(snapshot.settings)
      return options.settings.get()
    }
    return options.settings.update({ appPresence: mode })
  })
  ipcMain.handle(IPC.setApplicationLoginItem, (event, id, enabled) => { authorize(event); if (typeof enabled !== 'boolean') throw new TypeError('Invalid login setting'); return options.controller.setLoginItem(applicationId(id), enabled) })
  ipcMain.handle(IPC.installFeature, (event, id) => { authorize(event); return options.controller.installFeature(featureId(id)) })
  ipcMain.handle(IPC.uninstallFeature, (event, id) => { authorize(event); return options.controller.uninstallFeature(featureId(id)) })
  ipcMain.handle(IPC.openFeature, (event, id) => { authorize(event); return options.controller.openFeature(featureId(id)) })
  ipcMain.handle(IPC.reportPage, (event, page) => { authorize(event); if (!isControllerPage(page)) throw new TypeError('Invalid controller page'); options.controller.reportPage(page) })
  ipcMain.handle(IPC.relaunch, (event) => { authorize(event); options.controller.relaunch() })
  ipcMain.handle(IPC.openLoginItemsSettings, (event) => { authorize(event); return options.controller.openLoginItemsSettings() })
  ipcMain.handle(IPC.getUpdateState, (event) => { authorize(event); return options.updater?.state() ?? idleUpdateState() })
  ipcMain.handle(IPC.checkForUpdate, (event) => { authorize(event); return options.updater ? options.updater.check() : idleUpdateState() })
  ipcMain.handle(IPC.downloadUpdate, (event) => { authorize(event); return options.updater ? options.updater.download() : idleUpdateState() })
  ipcMain.handle(IPC.openReleasePage, (event) => { authorize(event); return options.updater?.openRelease() })
  const unsubscribe = options.controller.subscribe((snapshot) => { sendToRenderer(options.window.webContents, IPC.snapshot, snapshot) })
  const unsubscribeUpdater = options.updater?.subscribe((state) => { sendToRenderer(options.window.webContents, IPC.updateState, state) })
  const push = new Set<string>([IPC.snapshot, IPC.navigate, IPC.updateState])
  const handlers = Object.values(IPC).filter((value) => !push.has(value))
  return () => { unsubscribe(); unsubscribeUpdater?.(); handlers.forEach((channel) => ipcMain.removeHandler(channel)) }
}

function appSetLoginItem(openAtLogin: boolean): void {
  void import('electron').then(({ app }) => {
    if (process.platform === 'darwin' && !app.isPackaged) return
    if (process.platform === 'darwin') app.setLoginItemSettings({ openAtLogin, type: 'loginItemService', serviceName: 'com.moirasia.desktop.host' })
    else app.setLoginItemSettings({ openAtLogin })
  })
}
