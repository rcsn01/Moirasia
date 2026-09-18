import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => {
  class Emitter {
    listeners = new Map<string, Set<(...args: any[]) => void>>()
    on(event: string, listener: (...args: any[]) => void): this { const values = this.listeners.get(event) ?? new Set(); values.add(listener); this.listeners.set(event, values); return this }
    removeListener(event: string, listener: (...args: any[]) => void): this { this.listeners.get(event)?.delete(listener); return this }
    emit(event: string, ...args: any[]): boolean { for (const listener of this.listeners.get(event) ?? []) listener(...args); return true }
  }
  class WebContents extends Emitter {
    destroyed = false
    send = vi.fn()
    setWindowOpenHandler = vi.fn()
    isDestroyed(): boolean { return this.destroyed }
    isLoading(): boolean { return false }
    getURL(): string { return 'file:///shell.html' }
  }
  class BrowserWindow extends Emitter {
    static instances: BrowserWindow[] = []
    readonly webContents = new WebContents()
    destroyed = false
    visible = false
    loadURL = vi.fn(async () => {})
    show = vi.fn(() => { this.visible = true; this.emit('show') })
    hide = vi.fn(() => { this.visible = false; this.emit('hide') })
    focus = vi.fn(() => this.emit('focus'))
    restore = vi.fn()
    isFocused = vi.fn(() => false)
    isVisible = vi.fn(() => this.visible)
    isMinimized = vi.fn(() => false)
    isDestroyed = vi.fn(() => this.destroyed)
    destroy = vi.fn(() => { this.destroyed = true; this.webContents.destroyed = true; this.emit('closed') })
    constructor(readonly options: unknown) { super(); BrowserWindow.instances.push(this) }
  }
  return { BrowserWindow, disposeIpc: vi.fn(), registerIpc: vi.fn(() => fakes.disposeIpc), sendToRenderer: vi.fn(() => true) }
})

vi.mock('electron', () => ({ BrowserWindow: fakes.BrowserWindow, nativeTheme: { shouldUseDarkColors: false } }))
vi.mock('@moirasia/desktop-shell/main', () => ({
  applyWindowAppearance: vi.fn(), desktopWindowChromeOptions: vi.fn(() => ({})), neutralWindowBackground: vi.fn(() => '#fff'), sendToRenderer: fakes.sendToRenderer
}))
vi.mock('../src/main/ipc', () => ({ registerControllerIpc: fakes.registerIpc }))
vi.mock('../src/main/paths', () => ({ paths: { preload: () => '/tmp/preload.cjs', renderer: () => '/tmp/shell.html' } }))

import { EmbeddedFeatureHost } from '../src/main/features/embedded-host'
import { ShellWindowLifecycle } from '../src/main/shell-window'

function setup(mode: 'dock' | 'menu-bar') {
  const onMenuBarWindowClosed = vi.fn()
  const host = new EmbeddedFeatureHost()
  const controller = {
    refresh: vi.fn(async () => ({})), restorablePage: vi.fn(() => 'general'), rememberPage: vi.fn(), reportPage: vi.fn(), suspendRenderer: vi.fn(), subscribe: vi.fn(() => () => undefined)
  }
  const lifecycle = new ShellWindowLifecycle({
    controller: controller as never,
    settings: {} as never,
    host,
    appearance: () => 'system',
    presenceMode: () => mode,
    applyAppPresence: vi.fn(),
    onMenuBarWindowClosed,
    rendererUrl: 'http://localhost:5173'
  })
  return { host, controller, lifecycle, onMenuBarWindowClosed }
}

beforeEach(() => { fakes.BrowserWindow.instances.length = 0; vi.clearAllMocks(); fakes.registerIpc.mockImplementation(() => fakes.disposeIpc) })

describe('ShellWindowLifecycle', () => {
  it('destroys the primary renderer on close in menu bar mode and recreates one on open', async () => {
    const { host, controller, lifecycle, onMenuBarWindowClosed } = setup('menu-bar')
    await lifecycle.open('amove')
    const first = fakes.BrowserWindow.instances[0]!
    expect(host.renderer.current()).toBe(first.webContents)

    const close = { preventDefault: vi.fn() }
    first.emit('close', close)
    await lifecycle.suspend()

    expect(close.preventDefault).toHaveBeenCalled()
    expect(controller.suspendRenderer).toHaveBeenCalled()
    expect(first.destroy).toHaveBeenCalled()
    expect(host.renderer.current()).toBeUndefined()
    expect(fakes.disposeIpc).toHaveBeenCalled()
    expect(onMenuBarWindowClosed).toHaveBeenCalledOnce()

    await lifecycle.open()
    const second = fakes.BrowserWindow.instances[1]!
    expect(second).not.toBe(first)
    expect(host.renderer.current()).toBe(second.webContents)
    expect(fakes.BrowserWindow.instances).toHaveLength(2)
  })

  it('keeps the current renderer alive when a Dock window closes', async () => {
    const { host, lifecycle } = setup('dock')
    await lifecycle.open()
    const window = fakes.BrowserWindow.instances[0]!

    const close = { preventDefault: vi.fn() }
    window.emit('close', close)
    await Promise.resolve()

    expect(close.preventDefault).toHaveBeenCalled()
    expect(window.hide).toHaveBeenCalled()
    expect(window.destroy).not.toHaveBeenCalled()
    expect(host.renderer.current()).toBe(window.webContents)
  })

  it('coalesces concurrent opens into one primary window', async () => {
    const { lifecycle } = setup('menu-bar')

    await Promise.all([lifecycle.open(), lifecycle.open('features'), lifecycle.open()])

    expect(fakes.BrowserWindow.instances).toHaveLength(1)
    expect(fakes.sendToRenderer).toHaveBeenCalledWith(fakes.BrowserWindow.instances[0]!.webContents, 'controller:navigate', 'features')
  })
})
