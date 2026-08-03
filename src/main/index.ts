import { app, BrowserWindow, dialog, nativeTheme, type WebContentsView } from 'electron'
import { join } from 'node:path'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { registerShellIpc } from './ipc'
import { installApplicationMenu } from './menu'
import { ModuleManager } from './modules/manager'
import type { ElectronModuleView } from './modules/placeholder'
import { createModuleRegistry } from './modules/registry'
import type { ModuleView, ModuleViewHost } from './modules/types'
import { paths } from './paths'
import { ShellSettingsStore } from './settings'
import { SHELL_RAIL_WIDTHS, type ModuleId } from '../shared/contracts'
import { isNativeViewSurface } from './modules/native-view-bridge'
import { DirectoryLockConflictError } from '@moirasia/module-sdk'
import { MODULE_CATALOG } from './modules/catalog'
import { windowBackgrounds } from '@moirasia/ui-react/tokens'

const execFile = promisify(execFileCallback)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(createApplication)
}

async function createApplication(): Promise<void> {
  const settings = new ShellSettingsStore(join(app.getPath('appData'), 'Moirasia', 'settings.json'))
  await settings.load()
  const applySettings = (): void => {
    const current = settings.get()
    nativeTheme.themeSource = current.appearance
    app.setLoginItemSettings({ openAtLogin: current.launchAtLogin })
  }
  applySettings()
  let railWidth: number = settings.get().compactRail ? SHELL_RAIL_WIDTHS.compact : SHELL_RAIL_WIDTHS.expanded
  let attached: ModuleView | undefined
  const focusHandlersInstalled = new WeakSet<WebContentsView>()
  let shutdownCommitted = false
  let shutdownPrompt: Promise<void> | undefined
  let disposeIpc = (): void => {}

  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Moirasia',
    backgroundColor: nativeTheme.shouldUseDarkColors ? windowBackgrounds.moirasia.dark : windowBackgrounds.moirasia.light,
    webPreferences: {
      preload: paths.preload('shell'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const layoutView = (): void => {
    if (attached === undefined) return
    const { width, height } = window.getContentBounds()
    const bounds = {
      x: railWidth,
      y: 0,
      width: Math.max(0, width - railWidth),
      height
    }
    if (isNativeViewSurface(attached)) attached.nativeSurface.setBounds(bounds)
    else electronView(attached).setBounds(bounds)
  }

  const host: ModuleViewHost = {
    attach(view: ModuleView) {
      if (isNativeViewSurface(view)) {
        attached = view
        const { width, height } = window.getContentBounds()
        view.nativeSurface.attach(window.getNativeWindowHandle(), { x: railWidth, y: 0, width: Math.max(0, width - railWidth), height })
        return
      }
      const nativeView = electronView(view)
      if (attached === view) return
      attached = view
      if (!focusHandlersInstalled.has(nativeView)) {
        nativeView.webContents.on('before-input-event', (event, input) => {
          if (input.type === 'keyDown' && input.key === 'F6') {
            event.preventDefault()
            window.webContents.focus()
          }
        })
        focusHandlersInstalled.add(nativeView)
      }
      window.contentView.addChildView(nativeView)
      layoutView()
    },
    detach(view: ModuleView) {
      if (isNativeViewSurface(view)) {
        if (attached === view) { view.nativeSurface.detach(); attached = undefined }
        return
      }
      const nativeView = electronView(view)
      if (attached !== view) return
      window.contentView.removeChildView(nativeView)
      attached = undefined
    }
  }
  const manager = new ModuleManager(await createModuleRegistry(settings), host)

  const confirmWarnings = async (ids?: readonly ModuleId[]): Promise<boolean> => {
    const warnings = await manager.stopWarnings(ids)
    if (warnings.length === 0) return true
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      title: warnings.length === 1 ? warnings[0]!.title : 'Quit Moirasia?',
      message: warnings.length === 1
        ? warnings[0]!.title
        : 'Some modules have work in progress.',
      detail: warnings.map((warning) => `${warning.title}\n${warning.detail}`).join('\n\n'),
      buttons: ['Cancel', ids ? 'Quit Module' : 'Quit Moirasia'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    return result.response === 1
  }

  const requestStopModule = async (id: ModuleId) => {
    if (!await confirmWarnings([id])) return manager.snapshot()
    return manager.stop(id)
  }

  const withStandaloneHandoff = async <T>(id: ModuleId, operation: () => Promise<T>): Promise<T> => {
    try { return await operation() }
    catch (error) {
      if (!(error instanceof DirectoryLockConflictError) || error.owner.mode !== 'standalone') throw error
      const result = await dialog.showMessageBox(window, {
        type: 'warning', title: `${id} is already open`,
        message: `Quit the standalone ${id} app and switch to its Moirasia module?`,
        detail: 'Moirasia will request a graceful quit and will not force the application to close.',
        buttons: ['Cancel', 'Quit and Switch'], defaultId: 0, cancelId: 0, noLink: true
      })
      if (result.response !== 1) throw error
      const bundleId = MODULE_CATALOG.find((entry) => entry.id === id)!.bundleId
      await execFile('/usr/bin/osascript', ['-e', `tell application id "${bundleId}" to quit`])
      const released = await waitForExit(error.owner.pid, 10_000)
      if (!released) throw new Error(`${id} did not quit. Close it manually, then try again.`)
      return await operation()
    }
  }

  const requestShutdown = (): void => {
    if (shutdownCommitted || shutdownPrompt !== undefined) return
    shutdownPrompt = (async () => {
      if (!await confirmWarnings()) return
      shutdownCommitted = true
      await manager.stopAll().catch((error: unknown) => console.error('Module shutdown failed', error))
      disposeIpc()
      if (!window.isDestroyed()) window.destroy()
      app.quit()
    })().finally(() => {
      shutdownPrompt = undefined
    })
  }

  disposeIpc = registerShellIpc({
    window,
    manager,
    settings,
    setRailWidth(width) {
      railWidth = width
      layoutView()
    },
    requestShutdown,
    requestStopModule,
    requestStartModule: (id) => withStandaloneHandoff(id, () => manager.start(id)),
    requestActivateModule: (id) => withStandaloneHandoff(id, () => manager.activate(id)),
    applySettings
  })
  installApplicationMenu(window, manager, requestShutdown, async (priorSelection) => {
    await settings.update({ priorSelection })
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('before-input-event', (event, input) => {
    if (attached !== undefined && input.type === 'keyDown' && input.key === 'F6') {
      event.preventDefault()
      if (isNativeViewSurface(attached)) attached.nativeSurface.focus()
      else electronView(attached).webContents.focus()
    }
  })
  window.on('resize', layoutView)
  window.on('close', (event) => {
    if (!shutdownCommitted) {
      event.preventDefault()
      requestShutdown()
    }
  })
  window.once('ready-to-show', () => window.show())

  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl) {
    await window.loadURL(`${developmentUrl}/shell.html`)
  } else {
    await window.loadURL(pathToFileURL(paths.renderer('shell')).toString())
  }

  const initialSettings = settings.get()
  for (const id of Object.keys(initialSettings.autoStart) as ModuleId[]) {
    if (initialSettings.autoStart[id]) {
      await manager.start(id).catch((error: unknown) => console.error(`Could not auto-start ${id}`, error))
    }
  }
  if (initialSettings.restoreLastSelection) {
    window.webContents.send('shell:navigate', initialSettings.priorSelection)
  }

  app.on('second-instance', () => {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  app.on('before-quit', (event) => {
    if (!shutdownCommitted) {
      event.preventDefault()
      requestShutdown()
    }
  })
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { process.kill(pid, 0) } catch { return true }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

function electronView(view: ModuleView): WebContentsView {
  if (!('nativeView' in view)) throw new TypeError(`Module ${view.id} did not provide an Electron view`)
  return (view as ElectronModuleView).nativeView
}
