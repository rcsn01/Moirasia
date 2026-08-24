import { join } from 'node:path'
import { app, BrowserWindow, Menu, nativeImage, shell, systemPreferences, Tray } from 'electron'
import type { EmbeddedFeatureSurface, FeatureContext } from '@moirasia/desktop-shell/feature'
import type { AccessibilityState, CommandResult, MainState, Platform, PresenceMode, ShortcutBinding, WindowActionId } from '../shared/contracts'
import { IPC } from '../shared/contracts'
import { actionMeta, defaultBindings } from '../shared/defaults'
import { isReservedShortcut, validateBindings } from '../shared/shortcuts'
import { NativeBackend } from './native-backend'
import { SettingsStore } from './settings-store'
import { ShelfController } from './shelf-controller'
import { desktopWindowChromeOptions, neutralWindowBackground, registerProductAppearance } from '@moirasia/desktop-shell/main'

export class AppController {
  readonly platform: Platform
  readonly native: NativeBackend
  readonly settings: SettingsStore
  readonly shelf: ShelfController
  private mainWindow: BrowserWindow | undefined
  private readonly surface: EmbeddedFeatureSurface | undefined
  private disposeSurface: (() => void) | undefined
  private disposeShelfState: (() => void) | undefined
  private disposeAppearance: (() => void) | undefined
  private readonly shortcutDisposers: Array<{ dispose(): void }> = []
  private tray: Tray | undefined
  private dockHideRetry: NodeJS.Timeout | undefined
  private shortcutRecording = false
  private quitting = false
  private disposed = false
  private shortcutIssues: MainState['shortcutIssues'] = []
  private statusMessage = 'Amove is ready.'
  private lastActionMessage = 'No window actions have been triggered yet.'
  private readonly nativeHotkeysEnabled = process.env.AMOVE_DISABLE_NATIVE_HOTKEYS !== '1'
  private readonly assetsRoot: string
  private readonly appIconPath: string
  private readonly rendererMain: string | undefined

  constructor(private readonly ctx: FeatureContext) {
    this.surface = ctx.mode === 'suite' ? ctx.surface : undefined
    this.assetsRoot = ctx.paths.assetsDirectory ?? (app.isPackaged ? app.getAppPath() : process.cwd())
    this.appIconPath = join(this.assetsRoot, 'app', 'icon.png')
    this.rendererMain = namedResource(ctx, 'renderers', 'main', ctx.paths.rendererUrl ?? ctx.paths.rendererFile)
    this.platform = currentPlatform()
    this.native = new NativeBackend(this.platform, namedResource(ctx, 'native', 'addon'))
    const dataDirectory = ctx.paths.dataDirectory ?? app.getPath('userData')
    const settingsOptions = ctx.paths.legacyDataDirectories ? { legacyDataDirectories: ctx.paths.legacyDataDirectories } : undefined
    this.settings = new SettingsStore(join(dataDirectory, 'settings.json'), this.platform, settingsOptions)
    const shelfPreload = namedResource(ctx, 'preloads', 'shelf', ctx.paths.preload)
    const shelfRenderer = namedResource(ctx, 'renderers', 'shelf')
    if (!shelfPreload) throw new Error('Amove shelf preload resource is missing')
    this.shelf = new ShelfController(shelfPreload, this.appIconPath, shelfRenderer)
    this.disposeShelfState = this.shelf.store.subscribe(() => { this.updateHotkeyPolicy(); this.broadcast() })
    this.disposeSurface = this.surface?.subscribe(() => { this.updateHotkeyPolicy(); this.broadcast() })
  }

  async start(): Promise<void> {
    if (this.disposed) throw new Error('Amove controller has already been disposed')
    if (this.ctx.mode === 'suite' && !this.surface) throw new Error('Embedded Amove requires the shell feature surface')
    if (this.ctx.mode === 'standalone') this.setDockIcon()
    await this.settings.load(() => this.native.readLegacyPreferences())
    if (this.ctx.mode === 'standalone') await this.createMainWindow()
    this.applyPresence()
    if (this.nativeHotkeysEnabled) {
      this.registerHotkeys()
      this.native.startPolling((action) => void this.performAction(action))
    } else {
      this.statusMessage = 'Global shortcuts are disabled for automated testing.'
    }
    this.broadcast()
  }

  getMainWindow(): BrowserWindow | undefined { return this.mainWindow }
  getMainWebContents(): Electron.WebContents | undefined { return this.surface?.webContents ?? this.mainWindow?.webContents }
  focusMainSurface(): void { if (this.surface) this.surface.focus(); else this.mainWindow?.webContents.focus() }
  get hostMode(): 'suite' | 'standalone' { return this.ctx.mode }

  getState(): MainState {
    const warning = this.settings.getWarning()
    return {
      hostMode: this.ctx.mode,
      platform: this.platform,
      settings: this.settings.get(),
      statusMessage: this.statusMessage,
      lastActionMessage: this.lastActionMessage,
      shelfVisible: this.shelf.isVisible(),
      accessibility: this.accessibilityState(),
      shortcutIssues: this.shortcutIssues,
      ...(warning ? { migrationWarning: warning } : {})
    }
  }

  async showMainWindow(): Promise<void> {
    if (this.ctx.mode === 'suite') {
      if (!this.surface) throw new Error('Embedded Amove requires the shell feature surface')
      this.surface.activate()
    } else {
      if (!this.mainWindow || mainViewDestroyed(this.mainWindow)) await this.createMainWindow()
      this.mainWindow?.show(); this.mainWindow?.focus()
    }
    this.applyPresence()
    this.updateHotkeyPolicy()
  }

  setActive(_active: boolean): void { this.updateHotkeyPolicy() }

  async performAction(action: WindowActionId): Promise<CommandResult> {
    if (action === 'toggleShelf') {
      if (this.shelf.isVisible()) { this.shelf.hideAndClearItems(); this.statusMessage = 'Shelf hidden.' }
      else { await this.shelf.show(); this.statusMessage = this.shelf.store.getState().items.length === 0 ? 'Shelf opened. Drop files or folders into it to stage them.' : `Shelf reopened with ${this.shelf.store.getState().items.length} staged item(s).` }
      this.updateHotkeyPolicy(); this.broadcast()
      return { ok: true, value: undefined, message: this.statusMessage }
    }
    const result = this.native.moveWindow(action)
    const message = result.ok ? `${actionMeta[action].title} applied to the active window.` : result.message
    this.statusMessage = message; this.lastActionMessage = message; this.broadcast()
    return result.ok ? { ...result, message } : result
  }

  async recordShortcut(action: WindowActionId, binding: ShortcutBinding): Promise<CommandResult> {
    if (binding.modifiers.length === 0) return { ok: false, code: 'modifier-required', message: 'Shortcuts must include at least one modifier key.' }
    if (isReservedShortcut(binding, this.platform)) return { ok: false, code: 'reserved-shortcut', message: `That shortcut is commonly reserved by ${platformName(this.platform)} or active apps. Choose a less risky combination.` }
    await this.settings.update((settings) => {
      const bindings = settings.shortcutsByPlatform[this.platform] ?? defaultBindings(this.platform)
      settings.shortcutsByPlatform[this.platform] = { ...bindings, [action]: binding }
    })
    this.registerHotkeys()
    this.statusMessage = `${actionMeta[action].title} shortcut updated.`
    this.broadcast()
    return { ok: true, value: undefined, message: this.statusMessage }
  }

  setShortcutRecording(active: boolean): CommandResult { this.shortcutRecording = active; this.updateHotkeyPolicy(); return { ok: true, value: undefined } }

  async resetShortcut(action?: WindowActionId): Promise<CommandResult> {
    await this.settings.update((settings) => {
      const bindings = settings.shortcutsByPlatform[this.platform] ?? defaultBindings(this.platform)
      settings.shortcutsByPlatform[this.platform] = action ? { ...bindings, [action]: defaultBindings(this.platform)[action] } : defaultBindings(this.platform)
    })
    this.registerHotkeys()
    this.statusMessage = action ? `${actionMeta[action].title} reverted to its default shortcut.` : 'All shortcuts were restored to their defaults.'
    this.broadcast()
    return { ok: true, value: undefined, message: this.statusMessage }
  }

  async setPresenceMode(mode: PresenceMode): Promise<CommandResult> {
    await this.settings.update((settings) => { settings.presenceMode = mode })
    this.applyPresence()
    this.statusMessage = this.ctx.mode === 'suite' ? 'App presence is managed by Moirasia.' : `${presenceLabels(this.platform)[mode]} mode is active.`
    this.broadcast()
    return { ok: true, value: undefined, message: this.statusMessage }
  }

  refreshAccessibility(): CommandResult<AccessibilityState> { const value = this.accessibilityState(); this.statusMessage = 'Accessibility status refreshed.'; this.broadcast(); return { ok: true, value } }

  async requestAccessibility(): Promise<CommandResult<AccessibilityState>> {
    if (this.platform !== 'darwin') {
      const value = this.accessibilityState()
      this.statusMessage = this.platform === 'linux' ? 'Accessibility permission is not used on Linux because native window controls are unavailable.' : 'Windows does not require Accessibility permission.'
      this.broadcast()
      return { ok: true, value, message: this.statusMessage }
    }
    const granted = systemPreferences.isTrustedAccessibilityClient(true)
    if (!granted) await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    const value = this.accessibilityState()
    this.statusMessage = value.granted ? 'Accessibility access is granted.' : 'Accessibility Settings opened. Enable Amove, then click Refresh.'
    this.broadcast()
    return { ok: true, value, message: this.statusMessage }
  }

  async openAccessibilitySettings(): Promise<CommandResult> {
    if (this.platform === 'darwin') await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    return { ok: true, value: undefined }
  }

  async showShelf(): Promise<CommandResult> { await this.shelf.show(); this.statusMessage = 'Shelf opened.'; this.updateHotkeyPolicy(); this.broadcast(); return { ok: true, value: undefined } }

  closeShelf(): CommandResult {
    const shelfFocused = Boolean(this.shelf.getWindow()?.isFocused())
    const mainWindow = this.mainWindow
    const restoreMainInactive = Boolean(!this.surface && shelfFocused && mainWindow && !mainViewDestroyed(mainWindow) && mainWindow.isVisible())
    if (restoreMainInactive) mainWindow?.hide()
    this.shelf.hideAndClearItems()
    if (this.surface && shelfFocused) this.surface.focus()
    else if (restoreMainInactive && mainWindow && !mainViewDestroyed(mainWindow)) mainWindow.showInactive()
    this.statusMessage = 'Shelf closed.'; this.updateHotkeyPolicy(); this.broadcast()
    return { ok: true, value: undefined }
  }

  cancelShelf(): CommandResult { this.shelf.cancelAndClear(); this.statusMessage = 'Shelf canceled and cleared.'; this.updateHotkeyPolicy(); this.broadcast(); return { ok: true, value: undefined } }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.quitting = true
    if (this.dockHideRetry) clearTimeout(this.dockHideRetry)
    this.dockHideRetry = undefined
    for (const registration of this.shortcutDisposers.splice(0)) registration.dispose()
    this.native.dispose()
    this.shelf.dispose()
    this.tray?.destroy(); this.tray = undefined
    this.disposeShelfState?.(); this.disposeShelfState = undefined
    this.disposeSurface?.(); this.disposeSurface = undefined
    this.disposeAppearance?.(); this.disposeAppearance = undefined
    if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.destroy()
    this.mainWindow = undefined
  }

  prepareToQuit(): void { this.quitting = true }

  private async createMainWindow(): Promise<void> {
    if (this.surface) return
    const renderer = this.rendererMain
    const preload = namedResource(this.ctx, 'preloads', 'main', this.ctx.paths.preload)
    if (!renderer || !preload) throw new Error('Amove main renderer resources are missing')
    const window = new BrowserWindow({
      title: 'Amove', width: 1180, height: 760, minWidth: 980, minHeight: 700, ...desktopWindowChromeOptions(), show: false,
      backgroundColor: neutralWindowBackground('system'), icon: this.appIconPath,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !process.env.CI }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => { if (url !== window.webContents.getURL()) event.preventDefault() })
    window.on('focus', () => this.updateHotkeyPolicy())
    window.on('blur', () => this.updateHotkeyPolicy())
    window.on('close', (event) => {
      if (this.quitting) return
      if (this.ctx.mode === 'standalone' && this.platform !== 'darwin' && this.settings.get().presenceMode === 'taskbar') return
      event.preventDefault(); window.hide(); this.applyPresence(); this.updateHotkeyPolicy()
    })
    window.on('closed', () => {
      if (this.mainWindow === window) {
        this.mainWindow = undefined
        this.disposeAppearance?.()
        this.disposeAppearance = undefined
      }
      if (!this.quitting && this.ctx.mode === 'standalone' && this.platform !== 'darwin' && this.settings.get().presenceMode === 'taskbar') app.quit()
    })
    this.mainWindow = window
    this.disposeAppearance = await registerProductAppearance(this.ctx.productId, window, undefined, { applyNativeTheme: this.ctx.mode === 'standalone' })
    if (isRendererUrl(renderer)) await window.loadURL(renderer); else await window.loadFile(renderer)
    window.show()
  }

  private registerHotkeys(): void {
    if (!this.nativeHotkeysEnabled) return
    const bindings = { ...defaultBindings(this.platform), ...this.settings.get().shortcutsByPlatform[this.platform] } as Record<WindowActionId, ShortcutBinding>
    const validationIssues = validateBindings(bindings, this.platform)
    const nativeIssues = this.native.registerHotkeys(bindings)
    this.shortcutIssues = mergeIssues(validationIssues, nativeIssues)
    this.statusMessage = this.shortcutIssues.length === 0 ? 'Global shortcuts are active in the background.' : this.shortcutIssues[0]?.message ?? 'Some shortcuts could not be registered.'
    this.updateHotkeyPolicy()
  }

  private applyPresence(): void {
    if (this.ctx.mode === 'suite') return
    const background = this.settings.get().presenceMode === 'background'
    if (background && !this.tray) this.installTray()
    if (!background && this.tray) { this.tray.destroy(); this.tray = undefined }
    if (this.platform === 'darwin') {
      if (this.dockHideRetry) clearTimeout(this.dockHideRetry)
      this.dockHideRetry = undefined
      if (background) {
        this.hideDockPreservingMainWindow()
        this.dockHideRetry = setTimeout(() => {
          this.dockHideRetry = undefined
          if (this.settings.get().presenceMode === 'background') this.hideDockPreservingMainWindow()
        }, 1100)
      } else this.showDockWithAppIcon()
    }
  }

  private setDockIcon(): void {
    if (this.ctx.mode !== 'standalone' || this.platform !== 'darwin' || !app.dock) return
    const appIcon = nativeImage.createFromPath(this.appIconPath)
    if (!appIcon.isEmpty()) app.dock.setIcon(appIcon)
  }

  private showDockWithAppIcon(): void {
    if (this.ctx.mode !== 'standalone' || !app.dock) return
    this.setDockIcon(); void app.dock.show().then(() => this.setDockIcon())
  }

  private hideDockPreservingMainWindow(): void {
    if (this.ctx.mode !== 'standalone') return
    const window = this.mainWindow
    if (!(window instanceof BrowserWindow)) return
    const wasVisible = window.isVisible(); const wasFocused = window.isFocused()
    app.dock?.hide()
    if (!wasVisible || window.isDestroyed()) return
    window.show(); if (wasFocused) window.focus()
  }

  private installTray(): void {
    if (this.ctx.mode !== 'standalone') return
    const imagePath = this.platform === 'darwin' ? join(this.assetsRoot, 'tray', 'macos', 'trayTemplate.png') : this.appIconPath
    const image = nativeImage.createFromPath(imagePath)
    if (image.isEmpty()) throw new Error(`Amove ${this.platform === 'darwin' ? 'menu bar' : 'system tray'} icon could not be loaded from ${imagePath}.`)
    if (this.platform === 'darwin') image.setTemplateImage(true)
    this.tray = new Tray(image)
    this.tray.setToolTip('Amove')
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Amove', click: () => void this.showMainWindow() }, { type: 'separator' },
      { label: 'Toggle Shelf', click: () => void this.performAction('toggleShelf') }, { type: 'separator' },
      { label: 'Quit Amove', click: () => app.quit() }
    ]))
    this.tray.on('click', () => this.tray?.popUpContextMenu())
  }

  private accessibilityState(): AccessibilityState {
    if (this.platform === 'linux') return { required: false, granted: true, label: 'Not applicable on Linux' }
    const required = this.platform === 'darwin'
    const granted = required ? systemPreferences.isTrustedAccessibilityClient(false) : true
    return { required, granted, label: required ? (granted ? 'Granted' : 'Not granted') : 'Not required on Windows' }
  }

  private updateHotkeyPolicy(): void {
    const shelfFocused = Boolean(this.shelf.getWindow()?.isFocused())
    const appFocused = this.surface
      ? Boolean((this.surface.state.active && this.surface.state.focused) || shelfFocused)
      : Boolean((this.mainWindow instanceof BrowserWindow && this.mainWindow.isFocused()) || shelfFocused)
    this.native.setHotkeyPolicy(appFocused, this.shelf.isVisible(), this.shortcutRecording)
  }

  private broadcast(): void {
    const target = this.getMainWebContents()
    if (target && !target.isDestroyed()) target.send(IPC.mainStateChanged, this.getState())
  }
}

function namedResource(ctx: FeatureContext, kind: 'preloads' | 'renderers' | 'native', name: string, fallback?: string): string | undefined {
  return ctx.paths[kind]?.[name] ?? fallback
}

function isRendererUrl(value: string): boolean { return value.startsWith('http://') || value.startsWith('https://') }
function presenceLabels(platform: Platform): Record<PresenceMode, string> { return platform === 'darwin' ? { background: 'Menu Bar', taskbar: 'Dock' } : { background: 'System Tray', taskbar: 'Taskbar' } }
function mergeIssues(...groups: MainState['shortcutIssues'][]): MainState['shortcutIssues'] { const seen = new Set<string>(); return groups.flat().filter((issue) => { const key = `${issue.action}:${issue.code}`; if (seen.has(key)) return false; seen.add(key); return true }) }
function currentPlatform(): Platform { if (process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux') return process.platform; throw new Error(`Unsupported platform: ${process.platform}`) }
function platformName(platform: Platform): string { return platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux' }
function mainViewDestroyed(view: BrowserWindow): boolean { return view.isDestroyed() }
