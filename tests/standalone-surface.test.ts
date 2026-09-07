import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  class FakeWindow {
    static instances: FakeWindow[] = []
    readonly options: Record<string, unknown>
    readonly listeners = new Map<string, Listener[]>()
    destroyed = false
    minimized = false
    currentUrl = ''
    loadFile = vi.fn(async (_path: string) => undefined)
    loadURL = vi.fn(async (url: string) => { this.currentUrl = url })
    show = vi.fn()
    focus = vi.fn()
    restore = vi.fn(() => { this.minimized = false })
    destroy = vi.fn(() => { this.destroyed = true; this.emit('closed') })
    isDestroyed = vi.fn(() => this.destroyed)
    isMinimized = vi.fn(() => this.minimized)
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, listener: Listener) => { this.listeners.set(`web:${event}`, [listener]) }),
      getURL: vi.fn(() => this.currentUrl)
    }
    constructor(options: Record<string, unknown>) { this.options = options; FakeWindow.instances.push(this) }
    on(event: string, listener: Listener): void { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]) }
    emit(event: string, ...args: unknown[]): void { for (const listener of this.listeners.get(event) ?? []) listener(...args) }
  }
  const disposeAppearance = vi.fn()
  const registerProductAppearance = vi.fn(async () => disposeAppearance)
  return { FakeWindow, disposeAppearance, registerProductAppearance }
})

vi.mock('electron', () => ({ BrowserWindow: fakes.FakeWindow }))
vi.mock('../packages/desktop-shell/src/main', () => ({
  desktopWindowChromeOptions: vi.fn(() => ({ titleBarStyle: 'hiddenInset' })),
  neutralWindowBackground: vi.fn(() => '#background'),
  registerProductAppearance: fakes.registerProductAppearance
}))

import { acquireStandaloneSurface, type StandaloneSurfaceOptions } from '../packages/desktop-shell/src/standalone-surface'

const options: StandaloneSurfaceOptions = {
  productId: 'amove',
  title: 'Amove',
  width: 1280,
  height: 820,
  minWidth: 860,
  minHeight: 600,
  preload: '/tmp/preload.cjs',
  renderer: '/tmp/index.html',
  appearanceFile: '/tmp/amove/appearance.json',
  defaultAppearance: 'system'
}

beforeEach(() => {
  vi.clearAllMocks()
  fakes.FakeWindow.instances = []
})

describe('acquireStandaloneSurface', () => {
  it('creates a guarded hidden window and waits for ready before loading', async () => {
    const surface = await acquireStandaloneSurface(options)
    const window = fakes.FakeWindow.instances[0]!
    expect(window.options).toMatchObject({
      title: 'Amove', width: 1280, height: 820, minWidth: 860, minHeight: 600,
      show: false, titleBarStyle: 'hiddenInset', backgroundColor: '#background',
      webPreferences: { preload: '/tmp/preload.cjs', contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
    })
    expect(window.webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1)
    expect(window.loadFile).not.toHaveBeenCalled()
    expect(fakes.registerProductAppearance).toHaveBeenCalledWith('amove', window, 'system', {
      applyNativeTheme: true,
      registryPath: '/tmp/amove/appearance.json'
    })

    await surface.ready()
    await surface.ready()
    expect(window.loadFile).toHaveBeenCalledTimes(1)
    expect(window.loadFile).toHaveBeenCalledWith('/tmp/index.html')
    expect(window.show).toHaveBeenCalledTimes(1)
  })

  it('loads development URLs and enforces the navigation policy', async () => {
    const surface = await acquireStandaloneSurface({ ...options, renderer: 'http://localhost:5173/index.html', navigation: 'allow-same-url' })
    const window = fakes.FakeWindow.instances[0]!
    await surface.ready()
    expect(window.loadURL).toHaveBeenCalledWith('http://localhost:5173/index.html')
    const navigate = window.listeners.get('web:will-navigate')![0]!
    const same = { preventDefault: vi.fn() }
    navigate(same, 'http://localhost:5173/index.html')
    expect(same.preventDefault).not.toHaveBeenCalled()
    const other = { preventDefault: vi.fn() }
    navigate(other, 'https://example.com')
    expect(other.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('restores on activation and disposes once', async () => {
    const surface = await acquireStandaloneSurface(options)
    const window = fakes.FakeWindow.instances[0]!
    window.minimized = true
    surface.activate()
    expect(window.restore).toHaveBeenCalledTimes(1)
    expect(window.show).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
    surface.dispose()
    surface.dispose()
    expect(fakes.disposeAppearance).toHaveBeenCalledTimes(1)
    expect(window.destroy).toHaveBeenCalledTimes(1)
  })

  it('rolls back the window and appearance when loading fails', async () => {
    const surface = await acquireStandaloneSurface(options)
    const window = fakes.FakeWindow.instances[0]!
    window.loadFile.mockRejectedValueOnce(new Error('load failed'))
    await expect(surface.ready()).rejects.toThrow('load failed')
    expect(fakes.disposeAppearance).toHaveBeenCalledTimes(1)
    expect(window.destroy).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid resources before constructing a window', async () => {
    await expect(acquireStandaloneSurface({ ...options, preload: 'relative.cjs' })).rejects.toThrow(/preload/)
    expect(fakes.FakeWindow.instances).toHaveLength(0)
  })
})
