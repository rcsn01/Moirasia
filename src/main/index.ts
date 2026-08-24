import { app, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppearanceRegistry, applyAppearance, applyWindowAppearance, desktopWindowChromeOptions, neutralWindowBackground } from '@moirasia/desktop-shell/main'
import { IPC } from '../shared/contracts'
import { ApplicationController } from './application-controller'
import { EmbeddedFeatureHost } from './features/embedded-host'
import { FeatureRuntime, suiteFeatureContext } from './features/runtime'
import { registerControllerIpc } from './ipc'
import { installApplicationMenu } from './menu'
import { paths } from './paths'
import { ShellSettingsStore } from './settings'

if (!app.requestSingleInstanceLock()) app.quit()
else app.whenReady().then(createApplication).catch((error) => { console.error(error); app.quit() })

async function createApplication(): Promise<void> {
  const settingsPath = join(app.getPath('appData'), 'Moirasia', 'settings.json')
  const legacyAppearance = await legacyShellAppearance(settingsPath)
  const settings = new ShellSettingsStore(settingsPath)
  await settings.load()
  const appearances = new AppearanceRegistry()
  await appearances.load(legacyAppearance ? { moirasia: legacyAppearance } : {})
  applyAppearance(nativeTheme, appearances.get().values.moirasia)
  app.setLoginItemSettings({ openAtLogin: settings.get().launchAtLogin })

  // Feature IPC targets must exist before any installed backend registers. The
  // feature host never gives a feature ownership of this BrowserWindow.
  const window = new BrowserWindow({
    title: 'Moirasia', width: 980, height: 700, minWidth: 760, minHeight: 560, show: false,
    ...desktopWindowChromeOptions(),
    backgroundColor: neutralWindowBackground(appearances.get().values.moirasia, nativeTheme.shouldUseDarkColors),
    webPreferences: { preload: paths.preload('shell'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  const host = new EmbeddedFeatureHost(window)
  const stopNavigation = host.subscribeNavigation((feature) => {
    if (!window.isDestroyed()) window.webContents.send(IPC.navigate, feature ?? 'apps')
  })
  const features = new FeatureRuntime(settings, {
    host,
    context: (id) => suiteFeatureContext(id, host.surface(id))
  })
  await features.syncAtLaunch()

  const controller = new ApplicationController(appearances, settings, features)
  const applyShellAppearance = (): void => applyWindowAppearance(nativeTheme, window, appearances.get().values.moirasia)
  const updateSystemBackground = (): void => { if (appearances.get().values.moirasia === 'system') window.setBackgroundColor(neutralWindowBackground('system', nativeTheme.shouldUseDarkColors)) }
  nativeTheme.on('updated', updateSystemBackground)
  const disposeIpc = registerControllerIpc({ window, controller, settings, applyShellAppearance })
  installApplicationMenu(window, (id) => void controller.open(id).catch((error) => console.error(error)), (page) => controller.reportPage(page))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.on('focus', () => void controller.refresh())

  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl) await window.loadURL(`${developmentUrl}/shell.html`)
  else await window.loadURL(pathToFileURL(paths.renderer('shell')).toString())
  await controller.refresh()
  window.show()

  let timer: NodeJS.Timeout | undefined
  const updatePolling = (): void => {
    if (timer) clearInterval(timer)
    timer = window.isVisible() ? setInterval(() => void controller.refresh().catch(console.error), 2_000) : undefined
  }
  window.on('show', updatePolling)
  window.on('hide', updatePolling)
  updatePolling()
  app.on('second-instance', () => { if (window.isMinimized()) window.restore(); window.show(); window.focus() })
  app.on('activate', () => { window.show(); window.focus() })

  let shuttingDown = false
  app.on('before-quit', (event) => {
    if (shuttingDown) return
    event.preventDefault()
    shuttingDown = true
    if (timer) clearInterval(timer)
    nativeTheme.removeListener('updated', updateSystemBackground)
    disposeIpc()
    controller.close()
    void features.disposeAll().finally(() => {
      stopNavigation()
      host.dispose()
      app.quit()
    })
  })
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
