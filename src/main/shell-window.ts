import { BrowserWindow, nativeTheme } from 'electron'
import { pathToFileURL } from 'node:url'
import { applyWindowAppearance, desktopWindowChromeOptions, neutralWindowBackground, sendToRenderer } from '@moirasia/desktop-shell/main'
import { IPC, type AppPresenceMode, type ControllerPage } from '../shared/contracts'
import type { NativeHostClientLike } from '../shared/native-host-contracts'
import type { ApplicationController } from './application-controller'
import type { AppUpdater } from '@moirasia/desktop-shell/app-updater'
import type { EmbeddedFeatureHost } from './features/embedded-host'
import { registerControllerIpc } from './ipc'
import { paths } from './paths'
import type { ShellSettingsStore } from './settings'

type Generation = {
  window: BrowserWindow
  disposeIpc: () => void
  timer: NodeJS.Timeout | undefined
  closing: boolean
  onClose: (event: Electron.Event) => void
  onClosed: () => void
  onFocus: () => void
  onShow: () => void
  onHide: () => void
  onRenderProcessGone: () => void
}

export interface ShellWindowLifecycleOptions {
  controller: ApplicationController
  settings: ShellSettingsStore
  host: EmbeddedFeatureHost
  appearance(): 'system' | 'light' | 'dark'
  presenceMode(): AppPresenceMode
  applyAppPresence(mode: AppPresenceMode): void
  nativeClient?: NativeHostClientLike
  updater?: AppUpdater
  onMenuBarWindowClosed?(): void
  rendererUrl?: string
}

/** Owns replaceable primary-window generations while feature backends persist. */
export class ShellWindowLifecycle {
  #generation: Generation | undefined
  #queue: Promise<void> = Promise.resolve()
  #disposed = false
  #quitting = false

  constructor(private readonly options: ShellWindowLifecycleOptions) {}

  currentWindow(): BrowserWindow | undefined { return this.#generation?.window }

  open(page?: ControllerPage): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#disposed) return
      const generation = this.#generation
      if (generation && !generation.window.isDestroyed()) {
        this.#activate(generation.window)
        if (page) this.#navigate(generation.window, page)
        return
      }
      await this.#create(page)
    })
  }

  suspend(): Promise<void> { return this.#enqueue(() => this.#suspendCurrent()) }

  applyAppearance(): void {
    const window = this.#generation?.window
    if (window && !window.isDestroyed()) applyWindowAppearance(nativeTheme, window, this.options.appearance())
  }

  async dispose(): Promise<void> {
    this.#quitting = true
    this.#disposed = true
    await this.#enqueue(() => this.#suspendCurrent())
  }

  #enqueue(operation: () => Promise<void> | void): Promise<void> {
    const next = this.#queue.catch(() => undefined).then(operation)
    this.#queue = next
    return next
  }

  async #create(page?: ControllerPage): Promise<void> {
    const targetPage = page ?? this.options.controller.restorablePage()
    this.options.controller.rememberPage(targetPage)
    const window = new BrowserWindow({
      title: 'Moirasia', width: 980, height: 700, minWidth: 760, minHeight: 560, show: false,
      ...desktopWindowChromeOptions(),
      backgroundColor: neutralWindowBackground(this.options.appearance(), nativeTheme.shouldUseDarkColors),
      webPreferences: { preload: paths.preload('shell'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    this.options.host.attach(window)

    let generation: Generation | undefined
    const updatePolling = (): void => {
      if (!generation) return
      if (generation.timer) clearInterval(generation.timer)
      generation.timer = window.isVisible() ? setInterval(() => void this.options.controller.refresh().catch(console.error), 2_000) : undefined
    }
    const onClose = (event: Electron.Event): void => {
      if (this.#quitting || generation?.closing) return
      event.preventDefault()
      if (this.options.presenceMode() === 'menu-bar') {
        void this.suspend().then(() => this.options.onMenuBarWindowClosed?.()).catch(console.error)
      } else window.hide()
    }
    const onClosed = (): void => {
      if (this.#generation === generation) void this.suspend().catch(console.error)
    }
    const onFocus = (): void => { void this.options.controller.refresh().catch(console.error) }
    const onShow = (): void => { updatePolling(); this.options.controller.setShellVisible(true) }
    const onHide = (): void => { updatePolling(); this.options.controller.setShellVisible(false) }
    const onRenderProcessGone = (): void => {
      if (this.#quitting) return
      void this.#enqueue(async () => {
        await this.#suspendCurrent()
        this.options.onMenuBarWindowClosed?.()
      }).catch(console.error)
    }

    let disposeIpc: (() => void) | undefined
    try {
      disposeIpc = registerControllerIpc({
        window,
        controller: this.options.controller,
        settings: this.options.settings,
        applyShellAppearance: () => this.applyAppearance(),
        applyAppPresence: this.options.applyAppPresence,
        ...(this.options.nativeClient ? { nativeClient: this.options.nativeClient } : {}),
        ...(this.options.updater ? { updater: this.options.updater } : {})
      })
      generation = { window, disposeIpc, timer: undefined, closing: false, onClose, onClosed, onFocus, onShow, onHide, onRenderProcessGone }
      this.#generation = generation
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      window.webContents.on('render-process-gone', onRenderProcessGone)
      window.on('close', onClose)
      window.on('closed', onClosed)
      window.on('focus', onFocus)
      window.on('show', onShow)
      window.on('hide', onHide)
      if (this.options.rendererUrl) await window.loadURL(`${this.options.rendererUrl}/src/renderer/shell.html`)
      else await window.loadURL(pathToFileURL(paths.renderer('shell')).toString())
      await this.options.controller.refresh()
      if (this.#generation !== generation || this.#disposed) return
      this.#activate(window)
      updatePolling()
      this.options.controller.reportPage(targetPage)
    } catch (error) {
      if (generation && this.#generation === generation) await this.#release(generation)
      else {
        disposeIpc?.()
        this.options.host.detach(window)
        if (!window.isDestroyed()) window.destroy()
      }
      throw error
    }
  }

  async #suspendCurrent(): Promise<void> {
    const generation = this.#generation
    if (!generation) return
    this.options.controller.suspendRenderer()
    await this.#release(generation)
  }

  async #release(generation: Generation): Promise<void> {
    if (this.#generation !== generation) return
    this.#generation = undefined
    generation.closing = true
    if (generation.timer) clearInterval(generation.timer)
    if (!this.#quitting) this.options.controller.setShellVisible(false)
    generation.disposeIpc()
    const { window } = generation
    window.removeListener('close', generation.onClose)
    window.removeListener('closed', generation.onClosed)
    window.removeListener('focus', generation.onFocus)
    window.removeListener('show', generation.onShow)
    window.removeListener('hide', generation.onHide)
    window.webContents.removeListener('render-process-gone', generation.onRenderProcessGone)
    this.options.host.detach(window)
    if (!window.isDestroyed()) window.destroy()
  }

  #activate(window: BrowserWindow): void {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  #navigate(window: BrowserWindow, page: ControllerPage): void {
    this.options.controller.reportPage(page)
    sendToRenderer(window.webContents, IPC.navigate, page)
  }
}
