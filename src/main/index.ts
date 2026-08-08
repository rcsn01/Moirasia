import { app, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppearanceRegistry, applyAppearance } from '@moirasia/desktop-shell/main'
import { windowBackgrounds } from '@moirasia/ui-react/tokens'
import { ApplicationController } from './application-controller'
import { registerControllerIpc } from './ipc'
import { installApplicationMenu } from './menu'
import { paths } from './paths'
import { ShellSettingsStore } from './settings'

if (!app.requestSingleInstanceLock()) app.quit()
else app.whenReady().then(createApplication).catch((error) => { console.error(error); app.quit() })

async function createApplication(): Promise<void> {
  const settingsPath = join(app.getPath('appData'), 'Moirasia', 'settings.json')
  const legacyAppearance = await legacyShellAppearance(settingsPath)
  const settings = new ShellSettingsStore(settingsPath); await settings.load()
  const appearances = new AppearanceRegistry(); await appearances.load(legacyAppearance ? { moirasia: legacyAppearance } : {})
  applyAppearance(nativeTheme, appearances.get().values.moirasia)
  app.setLoginItemSettings({ openAtLogin: settings.get().launchAtLogin })
  const controller = new ApplicationController(appearances, settings)
  const macChrome = process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } } : {}
  const window = new BrowserWindow({
    title: 'Moirasia', width: 980, height: 700, minWidth: 760, minHeight: 560, show: false,
    ...macChrome,
    backgroundColor: nativeTheme.shouldUseDarkColors ? windowBackgrounds.moirasia.dark : windowBackgrounds.moirasia.light,
    webPreferences: { preload: paths.preload('shell'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  const applyShellAppearance = (): void => applyAppearance(nativeTheme, appearances.get().values.moirasia)
  const disposeIpc = registerControllerIpc({ window, controller, settings, applyShellAppearance })
  installApplicationMenu(window, (id) => void controller.open(id).catch((error) => console.error(error)))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.on('focus', () => void controller.refresh()); window.once('ready-to-show', () => window.show())
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl) await window.loadURL(`${developmentUrl}/shell.html`); else await window.loadURL(pathToFileURL(paths.renderer('shell')).toString())
  await controller.refresh()
  let timer: NodeJS.Timeout | undefined
  const updatePolling = (): void => { if (timer) clearInterval(timer); timer = window.isVisible() ? setInterval(() => void controller.refresh().catch(console.error), 2_000) : undefined }
  window.on('show', updatePolling); window.on('hide', updatePolling); updatePolling()
  app.on('second-instance', () => { if (window.isMinimized()) window.restore(); window.show(); window.focus() })
  app.on('activate', () => { window.show(); window.focus() })
  app.on('before-quit', () => { if (timer) clearInterval(timer); disposeIpc(); controller.close() })
}

async function legacyShellAppearance(path: string): Promise<'system' | 'light' | 'dark' | undefined> {
  try { const value = JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8')) as { appearance?: unknown }; return value.appearance === 'system' || value.appearance === 'light' || value.appearance === 'dark' ? value.appearance : undefined } catch { return undefined }
}
