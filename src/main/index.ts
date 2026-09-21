import { app, nativeTheme, shell } from 'electron'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { AppearanceRegistry, applyAppearance } from '@moirasia/desktop-shell/main'
import { ApplicationController } from './application-controller'
import { AppUpdater, type AppUpdaterHost } from './app-updater'
import { AppPresence } from './app-presence'
import { EmbeddedFeatureHost } from './features/embedded-host'
import { FeatureRuntime, suiteFeatureContext } from './features/runtime'
import { installMemoryDiagnostics } from './memory-diagnostics'
import { installApplicationMenu } from './menu'
import { applicationAgentPath, moirasiaFeatureServicePath, moirasiaHostPath, moirasiaHostSocketPath, moirasiaNativeFeaturePaths } from './paths'
import { NativeHostClient } from './native-host/client'
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
  const nativeRuntimeAvailable = process.platform === 'darwin' && existsSync(moirasiaHostPath()) && existsSync(moirasiaFeatureServicePath())
  const nativeFeaturePaths = nativeRuntimeAvailable ? moirasiaNativeFeaturePaths() : undefined
  const nativeHostOptions = nativeRuntimeAvailable ? {
    executable: moirasiaHostPath(),
    featureServicePath: moirasiaFeatureServicePath(),
    applicationPath: resolve(process.execPath, '../../..'),
    userData: app.getPath('userData'),
    iconPath: menuBarIconPath,
    pidPath: join(app.getPath('userData'), 'menu-host.pid'),
    bondedHelperPath: nativeFeaturePaths!.bondedHelperPath,
    shoutDriverPath: nativeFeaturePaths!.shoutDriverPath
  } : undefined
  const localHostOptions = process.platform === 'darwin' ? {
    executable: applicationAgentPath(),
    applicationPath: resolve(process.execPath, '../../..'),
    pidPath: join(app.getPath('userData'), 'menu-host.pid')
  } : undefined

  let shellWindow: ShellWindowLifecycle
  let openShell: (page?: import('../shared/contracts').ControllerPage) => Promise<void>
  let presence: AppPresence
  let nativeClient: NativeHostClient | undefined
  let nativeSelected = false

  if (nativeRuntimeAvailable && nativeHostOptions) {
    const candidate = new AppPresence({
      menuBarIconPath,
      open: () => void openShell().catch(console.error),
      nativeHost: nativeHostOptions
    })
    nativeClient = new NativeHostClient({
      socketPath: moirasiaHostSocketPath(app.getPath('userData')),
      tokenPath: join(app.getPath('userData'), 'runtime', 'client.token')
    })
    try {
      candidate.apply(settings.get().appPresence)
      if (!await candidate.waitForNativeHost() || !await connectNativeHost(nativeClient)) throw new Error('MoirasiaHost.app did not become ready.')
      presence = candidate
      nativeSelected = true
    } catch (error) {
      candidate.abortNativeBootstrap()
      nativeClient.close()
      console.error('Native Moirasia bootstrap failed; local ownership was not selected.', error)
      throw error
    }
  } else {
    presence = new AppPresence({
      menuBarIconPath,
      open: () => void openShell().catch(console.error),
      ...(localHostOptions ? { nativeHost: localHostOptions } : {})
    })
    presence.apply(settings.get().appPresence)
  }

  const host = new EmbeddedFeatureHost()
  const featureOptions = nativeSelected && nativeClient ? { nativeClient } : {}
  const features = new FeatureRuntime(settings, { host, context: (id) => suiteFeatureContext(id, host.surface(id)), ...featureOptions })
  await features.syncAtLaunch()
  const controller = new ApplicationController(appearances, settings, features)
  const updater = new AppUpdater(createAppUpdaterHost())

  let preserveNativeMenuHost = false
  let uiLifetime: UiLifetime
  shellWindow = new ShellWindowLifecycle({
    controller,
    settings,
    host,
    appearance: () => appearances.get().values.moirasia,
    presenceMode: () => presence.mode,
    applyAppPresence: (mode) => presence.apply(mode),
    updater,
    ...(nativeSelected && nativeClient ? { nativeClient } : {}),
    onMenuBarWindowClosed: () => uiLifetime.shellClosed(),
    ...(process.env.ELECTRON_RENDERER_URL ? { rendererUrl: process.env.ELECTRON_RENDERER_URL } : {})
  })
  openShell = async (page) => { await shellWindow.open(page); uiLifetime.shellOpened() }
  uiLifetime = new UiLifetime({
    mode: () => presence.mode,
    canExitToNativeHost: () => nativeSelected && nativeClient?.isConnected() === true,
    onFinalWindowGone: () => {
      preserveNativeMenuHost = nativeSelected && nativeClient?.isConnected() === true
      app.quit()
    }
  })
  const commandRouter = new UiCommandRouter({ openShell, openShelf: () => features.openShelf(), toggleShelf: () => features.toggleShelf() })
  const stopNavigation = host.subscribeNavigation((feature) => { if (feature) void openShell(feature).catch(console.error) })
  let nativeWillQuit = false
  let reconnecting: Promise<void> | undefined
  const reconnectNativeHost = async (): Promise<void> => {
    if (!nativeSelected || !nativeClient || nativeWillQuit || reconnecting) return reconnecting
    reconnecting = (async () => {
      if (!await presence.restartNativeHost()) return
      await nativeClient.connect()
    })().catch((error) => { console.error('Could not reconnect to MoirasiaHost', error) }).finally(() => { reconnecting = undefined })
    return reconnecting
  }
  const stopNativeConnection = nativeSelected && nativeClient?.subscribeConnection
    ? nativeClient.subscribeConnection((event) => {
      uiLifetime.nativeHostAvailabilityChanged()
      if (event.state === 'disconnected') void reconnectNativeHost()
    })
    : () => undefined
  const stopNativeWillQuit = nativeSelected && nativeClient ? nativeClient.subscribe('host.willQuit', () => { nativeWillQuit = true }) : () => undefined
  const stopNativeUi = nativeSelected && nativeClient ? [
    nativeClient.subscribe('ui.openShell', () => commandRouter.route({ kind: 'shell' })),
    nativeClient.subscribe('ui.toggleShelf', () => commandRouter.route({ kind: 'toggle-shelf' })),
    nativeClient.subscribe('host.uiStateChanged', (payload) => {
      if (payload && typeof payload === 'object' && typeof (payload as { shelfVisible?: unknown }).shelfVisible === 'boolean') uiLifetime.shelfVisible((payload as { shelfVisible: boolean }).shelfVisible)
    })
  ] : []
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
    stopNativeConnection()
    stopNativeUi.forEach((stop) => stop())
    stopNativeWillQuit()
    commandRouter.dispose()
    if (preserveNativeMenuHost && nativeSelected && nativeClient?.isConnected()) presence.preserveNativeHost()
    presence.dispose()
    const finish = async (): Promise<void> => {
      await shellWindow.dispose()
      controller.close()
      await features.disposeAll()
      host.dispose()
      nativeClient?.close()
      app.quit()
    }
    const shouldStopNativeRuntime = Boolean(nativeSelected && nativeClient?.isConnected() && !preserveNativeMenuHost && !nativeWillQuit)
    if (shouldStopNativeRuntime) void nativeClient!.request('host.quitSuite').catch((error) => console.error('Could not coordinate native suite quit', error)).finally(() => void finish())
    else void finish()
  })
}

function createAppUpdaterHost(): AppUpdaterHost {
  return {
    currentVersion: () => app.getVersion(),
    packaged: () => app.isPackaged,
    downloadsDirectory: () => app.getPath('downloads'),
    fetch: async (url, init) => {
      const response = await fetch(url, init)
      return { ok: response.ok, status: response.status, text: () => response.text(), arrayBuffer: () => response.arrayBuffer() }
    },
    writeFile: (path, data) => writeFile(path, data),
    openPath: (path) => shell.openPath(path),
    openExternal: (url) => shell.openExternal(url)
  }
}

function setLoginItemSettings(openAtLogin: boolean): void {
  if (process.platform === 'darwin' && !app.isPackaged) return
  if (process.platform === 'darwin') app.setLoginItemSettings({ openAtLogin, type: 'loginItemService', serviceName: 'com.moirasia.desktop.host' })
  else app.setLoginItemSettings({ openAtLogin })
}

async function connectNativeHost(client: NativeHostClient): Promise<boolean> {
  try {
    await client.connect()
    const snapshot = await client.getSnapshot()
    if (!snapshot) { console.error('MoirasiaHost returned an invalid snapshot.'); return false }
    return true
  } catch (error) {
    console.error('Could not connect to MoirasiaHost', error)
    return false
  }
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
