import { app, nativeTheme } from 'electron'
import { join, resolve } from 'node:path'
import { AppearanceRegistry, applyAppearance } from '@moirasia/desktop-shell/main'
import { ApplicationController } from './application-controller'
import { AppUpdater } from '@moirasia/desktop-shell/app-updater'
import { createElectronAppUpdaterHost } from '@moirasia/desktop-shell/app-updater-electron'
import { EmbeddedFeatureHost } from './features/embedded-host'
import { FeatureRuntime, suiteFeatureContext } from './features/runtime'
import { HostOwnership } from './host-ownership'
import { installMemoryDiagnostics } from './memory-diagnostics'
import { installApplicationMenu } from './menu'
import { ShellWindowLifecycle } from './shell-window'
import { ShellSettingsStore } from './settings'
import { UiCommandRouter, parseUiIntent } from './ui-command-router'
import { UiLifetime } from './ui-lifetime'
import { isControllerPage } from '../shared/contracts'

app.setName('Moirasia')
app.setAppUserModelId('com.moirasia.desktop')
// Suppress Electron's implicit final-window quit. The controlled lifecycle
// either retains in-process feature services or performs coordinated teardown.
app.on('window-all-closed', () => undefined)

if (!app.requestSingleInstanceLock()) app.quit()
else app.whenReady().then(createApplication).catch((error) => { console.error(error); app.quit() })

async function createApplication(): Promise<void> {
  if (!app.isPackaged && app.dock) app.dock.setIcon(join(app.getAppPath(), 'build', 'icon.png'))
  const settingsPath = join(app.getPath('userData'), 'settings.json')
  const legacyAppearance = await legacyShellAppearance(settingsPath)
  const settings = new ShellSettingsStore(settingsPath)
  await settings.load()
  const appearances = new AppearanceRegistry()
  await appearances.load(legacyAppearance ? { moirasia: legacyAppearance } : {})
  applyAppearance(nativeTheme, appearances.get().values.moirasia)
  setLoginItemSettings(settings.get().launchAtLogin)

  const menuBarIconPath = app.isPackaged ? join(process.resourcesPath, 'tray', 'trayTemplate.png') : join(app.getAppPath(), 'build', 'trayTemplate.png')
  let shellWindow: ShellWindowLifecycle
  let openShell: (page?: import('../shared/contracts').ControllerPage) => Promise<void>
  let uiLifetime: UiLifetime
  let commandRouter: UiCommandRouter

  const ownership = await HostOwnership.acquire({
    userData: app.getPath('userData'),
    menuBarIconPath,
    applicationPath: resolve(process.execPath, '../../..'),
    resourcesPath: process.resourcesPath,
    platform: process.platform,
    initialPresence: settings.get().appPresence,
    openShell: (page) => openShell(page),
    toggleShelf: () => commandRouter.route({ kind: 'toggle-shelf' }),
    shelfVisible: (visible) => uiLifetime.shelfVisible(visible),
    onAvailabilityChanged: () => uiLifetime.nativeHostAvailabilityChanged()
  })

  const host = new EmbeddedFeatureHost()
  const features = new FeatureRuntime(settings, { host, context: (id) => suiteFeatureContext(id, host.surface(id)), ...(ownership.nativeClient ? { nativeClient: ownership.nativeClient } : {}) })
  await features.syncAtLaunch()
  const controller = new ApplicationController(appearances, settings, features)
  const updater = new AppUpdater(createElectronAppUpdaterHost(), { owner: 'rcsn01', repo: 'Moirasia', userAgent: 'Moirasia' })

  shellWindow = new ShellWindowLifecycle({
    controller,
    settings,
    host,
    appearance: () => appearances.get().values.moirasia,
    presenceMode: () => ownership.presence.mode,
    applyAppPresence: (mode) => ownership.presence.apply(mode),
    updater,
    ...(ownership.nativeClient ? { nativeClient: ownership.nativeClient } : {}),
    onMenuBarWindowClosed: () => uiLifetime.shellClosed(),
    ...(process.env.ELECTRON_RENDERER_URL ? { rendererUrl: process.env.ELECTRON_RENDERER_URL } : {})
  })
  openShell = async (page) => { await shellWindow.open(page); uiLifetime.shellOpened() }
  uiLifetime = new UiLifetime({
    mode: () => ownership.presence.mode,
    canExitToNativeHost: () => ownership.canExitToNativeHost(),
    onFinalWindowGone: () => {
      ownership.exitToHost()
      app.quit()
    }
  })
  commandRouter = new UiCommandRouter({ openShell, openShelf: () => features.openShelf(), toggleShelf: () => features.toggleShelf() })
  const stopNavigation = host.subscribeNavigation((feature) => { if (feature) void openShell(feature).catch(console.error) })
  ownership.start()
  installApplicationMenu(
    (id) => void controller.open(id).catch(console.error),
    (page) => void openShell(page).catch(console.error),
    () => {
      void openShell('general').then(() => updater.check()).catch(console.error)
    }
  )
  const updateSystemAppearance = (): void => {
    if (appearances.get().values.moirasia === 'system') shellWindow.applyAppearance()
  }
  nativeTheme.on('updated', updateSystemAppearance)

  const intent = parseUiIntent(process.argv)
  if (intent.kind === 'shelf') {
    uiLifetime.shelfVisible(true)
    await features.openShelf()
  } else if (intent.kind === 'shell') {
    await openShell(intent.page)
  }
  const disposeMemoryDiagnostics = installMemoryDiagnostics({
    suspend: () => shellWindow.suspend(),
    closeWindow: () => shellWindow.currentWindow()?.close(),
    openPage: async (page) => {
      if (!isControllerPage(page)) throw new TypeError(`Invalid benchmark page '${page}'`)
      await openShell(page)
    }
  })
  app.on('second-instance', (_event, argv) => { commandRouter.route(parseUiIntent(argv)) })
  app.on('activate', () => { void openShell().catch(console.error) })

  let shuttingDown = false
  app.on('before-quit', (event) => {
    if (shuttingDown) return
    event.preventDefault()
    shuttingDown = true
    nativeTheme.removeListener('updated', updateSystemAppearance)
    disposeMemoryDiagnostics()
    stopNavigation()
    commandRouter.dispose()
    void ownership.coordinateQuit(async () => {
      await shellWindow.dispose()
      controller.close()
      await features.disposeAll()
      host.dispose()
    }).then(() => app.quit())
  })
}

function setLoginItemSettings(openAtLogin: boolean): void {
  if (process.platform === 'darwin' && !app.isPackaged) return
  if (process.platform === 'darwin') app.setLoginItemSettings({ openAtLogin, type: 'loginItemService', serviceName: 'com.moirasia.desktop.host' })
  else app.setLoginItemSettings({ openAtLogin })
}

async function legacyShellAppearance(path: string): Promise<'system' | 'light' | 'dark' | undefined> {
  const { readFile } = await import('node:fs/promises')
  for (const candidate of [path, `${path}.backup`]) {
    try {
      const value = JSON.parse(await readFile(candidate, 'utf8')) as { appearance?: unknown }
      if (value.appearance === 'system' || value.appearance === 'light' || value.appearance === 'dark') return value.appearance
    } catch { /* Try the last known good copy. */ }
  }
  return undefined
}
