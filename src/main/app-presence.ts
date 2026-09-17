import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import type { AppPresenceMode } from '../shared/contracts'

export class AppPresence {
  #tray: Tray | undefined
  #quitting = false

  constructor(private readonly window: BrowserWindow, private readonly menuBarIconPath: string) {
    this.window.on('close', this.#handleWindowClose)
    app.on('before-quit', this.#handleBeforeQuit)
  }

  apply(mode: AppPresenceMode): void {
    if (mode === 'menu-bar') {
      this.#installTray()
      this.#hideDockPreservingWindow()
      return
    }

    this.#tray?.destroy()
    this.#tray = undefined
    if (app.dock) void app.dock.show()
  }

  dispose(): void {
    this.window.removeListener('close', this.#handleWindowClose)
    app.removeListener('before-quit', this.#handleBeforeQuit)
    this.#tray?.destroy()
    this.#tray = undefined
  }

  #handleBeforeQuit = (): void => { this.#quitting = true }

  #handleWindowClose = (event: Electron.Event): void => {
    if (this.#quitting) return
    event.preventDefault()
    this.window.hide()
  }

  #showWindow = (): void => {
    if (this.window.isDestroyed()) return
    if (this.window.isMinimized()) this.window.restore()
    this.window.show()
    this.window.focus()
  }

  #installTray(): void {
    if (this.#tray) return
    const image = nativeImage.createFromPath(this.menuBarIconPath)
    if (image.isEmpty()) throw new Error(`Moirasia menu bar icon could not be loaded from ${this.menuBarIconPath}.`)
    image.setTemplateImage(true)
    this.#tray = new Tray(image)
    this.#tray.setToolTip('Moirasia')
    this.#tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Moirasia', click: this.#showWindow },
      { type: 'separator' },
      { label: 'Quit Moirasia', click: () => app.quit() }
    ]))
    this.#tray.on('click', this.#showWindow)
  }

  #hideDockPreservingWindow(): void {
    if (!app.dock) return
    const wasVisible = this.window.isVisible()
    const wasFocused = this.window.isFocused()
    app.dock.hide()
    if (!wasVisible || this.window.isDestroyed()) return
    this.window.show()
    if (wasFocused) this.window.focus()
  }
}
