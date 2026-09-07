import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureContext } from '../packages/desktop-shell/src/feature'
import { defaultProductAppearance, desktopWindowChromeOptions, neutralWindowBackground } from '../packages/desktop-shell/src/main'

const fakes = vi.hoisted(() => {
  class FakeWebContents {
    static instances: FakeWebContents[] = []
    destroyed = false
    url = ''
    windowOpenHandler: ((details: unknown) => { action: string }) | undefined
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    constructor() { FakeWebContents.instances.push(this) }
    setWindowOpenHandler(handler: (details: unknown) => { action: string }): void { this.windowOpenHandler = handler }
    on(event: string, listener: (event: never, ...args: never[]) => void): void {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener as unknown as (...args: unknown[]) => void])
    }
    emit(event: string, ...args: unknown[]): void {
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args)
    }
    getURL(): string { return this.url }
    isDestroyed(): boolean { return this.destroyed }
    getOSProcessId(): number { return 321 }
    send = vi.fn()
  }
  class FakeWindow {
    static instances: FakeWindow[] = []
    readonly webContents = new FakeWebContents()
    readonly options: unknown
    /** When set, the next loadURL/loadFile rejects with it. */
    nextLoadError: Error | undefined
    minimized = false
    destroyed = false
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    constructor(options: unknown) { this.options = options; FakeWindow.instances.push(this) }
    loadURL = vi.fn(async (url: string): Promise<void> => { this.webContents.url = url; this.failLoad() })
    loadFile = vi.fn(async (path: string): Promise<void> => { this.webContents.url = `file://${path}`; this.failLoad() })
    private failLoad(): void {
      const error = this.nextLoadError
      this.nextLoadError = undefined
      if (error) throw error
    }
    show = vi.fn()
    focus = vi.fn()
    restore = vi.fn()
    isMinimized = vi.fn((): boolean => this.minimized)
    setFullScreenable = vi.fn()
    isDestroyed = (): boolean => this.destroyed
    destroy = vi.fn((): void => { this.destroyed = true; this.emit('closed') })
    on(event: string, listener: (...args: unknown[]) => void): void {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    }
    emit(event: string, ...args: unknown[]): void {
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args)
    }
    /** An external close (user close): closed is emitted without dispose(). */
    simulateClose(): void { this.destroyed = true; this.webContents.destroyed = true; this.emit('closed') }
  }
  const appearanceDispose = vi.fn()
  const appearanceRegister = vi.fn(async (): Promise<() => void> => appearanceDispose)
  return { FakeWindow, FakeWebContents, appearanceDispose, appearanceRegister }
})

vi.mock('electron', () => ({ BrowserWindow: fakes.FakeWindow }))
vi.mock('../packages/desktop-shell/src/main', () => ({
  desktopWindowChromeOptions: vi.fn(() => ({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 11 } })),
  neutralWindowBackground: vi.fn((appearance: string): string => `neutral-${appearance}`),
  defaultProductAppearance: vi.fn((product: string): string => (product === 'exithibition' ? 'dark' : 'system')),
  registerProductAppearance: fakes.appearanceRegister
}))

import { acquireFeatureSurface, type FeatureSurfaceHandle } from '../packages/desktop-shell/src/feature-surface-host'

/** Validated standalone contexts, one per feature: the fact joins are pinned against the real catalog tables. */
const standaloneContexts = {
  amove: {
    id: 'amove', mode: 'standalone', productId: 'amove',
    paths: {
      preloads: { main: '/tmp/amove-main.cjs', shelf: '/tmp/amove-shelf.cjs' },
      renderers: { main: '/tmp/amove.html', shelf: '/tmp/amove-shelf.html' },
      native: { addon: '/tmp/amove-native.darwin-arm64.node' },
      assetsDirectory: '/tmp/amove-assets',
      dataDirectory: '/tmp/amove-data'
    }
  },
  exithibition: {
    id: 'exithibition', mode: 'standalone', productId: 'exithibition',
    paths: { preloads: { main: '/tmp/exithibition-preload.cjs' }, renderers: { main: '/tmp/exithibition.html' }, native: { executable: '/tmp/ExithibitionNative' }, dataDirectory: '/tmp/exithibition-data' }
  },
  bonded: {
    id: 'bonded', mode: 'standalone', productId: 'bonded',
    paths: { preloads: { main: '/tmp/bonded-preload.cjs' }, renderers: { main: '/tmp/bonded.html' }, native: { helper: '/tmp/BondedFirewallHelper' }, dataDirectory: '/tmp/bonded-data' }
  },
  orbis: {
    id: 'orbis', mode: 'standalone', productId: 'orbis',
    paths: { preloads: { main: '/tmp/orbis-preload.cjs' }, renderers: { main: '/tmp/orbis.html' }, workers: { scan: '/tmp/scan-worker.mjs' }, dataDirectory: '/tmp/orbis-data' }
  }
} as const

interface SuiteSurfaceDouble {
  webContents: InstanceType<typeof fakes.FakeWebContents>
  state: { active: boolean; focused: boolean }
  activate: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
}

function suiteContext(): { context: FeatureContext; surface: SuiteSurfaceDouble } {
  const surface: SuiteSurfaceDouble = {
    webContents: new fakes.FakeWebContents(),
    state: { active: true, focused: true },
    activate: vi.fn(),
    focus: vi.fn(),
    subscribe: vi.fn(() => () => undefined)
  }
  const context = {
    id: 'bonded', mode: 'suite', productId: 'bonded', surface,
    paths: { native: { helper: '/tmp/BondedFirewallHelper' }, dataDirectory: '/tmp/bonded-data' }
  } as unknown as FeatureContext
  return { context, surface }
}

function emitNavigation(window: InstanceType<typeof fakes.FakeWindow>, url: string): { preventDefault: ReturnType<typeof vi.fn> } {
  const event = { preventDefault: vi.fn() }
  window.webContents.emit('will-navigate', event, url)
  return event
}

describe('feature surface host', () => {
  beforeEach(() => {
    fakes.FakeWindow.instances.length = 0
    fakes.FakeWebContents.instances.length = 0
    vi.clearAllMocks()
  })

  it('resolves the shell surface in suite mode without constructing a window', async () => {
    const { context, surface } = suiteContext()
    const handle = await acquireFeatureSurface(context)
    expect(handle.mode).toBe('suite')
    expect(handle.window).toBeUndefined()
    expect(handle.webContents).toBe(surface.webContents)

    await handle.ready()
    handle.activate()
    handle.dispose()
    expect(surface.activate).toHaveBeenCalledTimes(1)
    expect(surface.focus).toHaveBeenCalledTimes(1)
    expect(fakes.FakeWindow.instances).toHaveLength(0)
    expect(fakes.appearanceRegister).not.toHaveBeenCalled()
  })

  it('creates the standalone window from the catalog facts and shared appearance defaults (Bonded seed)', async () => {
    const handle = await acquireFeatureSurface(standaloneContexts.bonded)
    expect(fakes.FakeWindow.instances).toHaveLength(1)
    const window = fakes.FakeWindow.instances[0]!
    expect(window.options).toMatchObject({
      title: 'Bonded',
      width: 430,
      height: 600,
      minWidth: 390,
      minHeight: 500,
      show: false,
      fullscreenable: false,
      ...desktopWindowChromeOptions(),
      backgroundColor: neutralWindowBackground(defaultProductAppearance('bonded')),
      webPreferences: { preload: '/tmp/bonded-preload.cjs', contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
    })
    expect(handle.window).toBe(window)
    expect(handle.webContents).toBe(window.webContents)
    expect(fakes.appearanceRegister).toHaveBeenCalledWith('bonded', window, undefined, { applyNativeTheme: true })
  })

  it('passes through the icon and devTools options (Amove seed)', async () => {
    await acquireFeatureSurface(standaloneContexts.amove, { icon: '/tmp/amove-icon.png', devTools: false })
    const options = fakes.FakeWindow.instances[0]!.options as { icon?: string; webPreferences: { devTools?: boolean } }
    expect(options.icon).toBe('/tmp/amove-icon.png')
    expect(options.webPreferences.devTools).toBe(false)
  })

  it('validates the context before any window exists', async () => {
    const { renderers: _missing, ...paths } = standaloneContexts.orbis.paths
    const broken = { ...standaloneContexts.orbis, paths }
    await expect(acquireFeatureSurface(broken)).rejects.toThrow(/renderers\.main/)
    expect(fakes.FakeWindow.instances).toHaveLength(0)
  })

  it('cleans up if validation passed through a deprecated renderer alias but the named renderer is absent', async () => {
    const { renderers: _legacy, ...paths } = standaloneContexts.bonded.paths
    const context = { ...standaloneContexts.bonded, paths: { ...paths, rendererFile: '/tmp/legacy-bonded.html' } } as FeatureContext
    const handle = await acquireFeatureSurface(context)
    const window = fakes.FakeWindow.instances[0]!

    await expect(handle.ready()).rejects.toThrow(/renderers\.main/)
    expect(fakes.appearanceDispose).toHaveBeenCalledTimes(1)
    expect(window.destroy).toHaveBeenCalledTimes(1)
  })

  it('leaves the window unloaded after acquire, loads it on ready, and shows it exactly once', async () => {
    const handle = await acquireFeatureSurface(standaloneContexts.bonded)
    const window = fakes.FakeWindow.instances[0]!
    expect(window.loadFile).not.toHaveBeenCalled()
    expect(window.loadURL).not.toHaveBeenCalled()
    expect(window.show).not.toHaveBeenCalled()

    await handle.ready()
    expect(window.loadFile).toHaveBeenCalledWith('/tmp/bonded.html')
    expect(window.show).toHaveBeenCalledTimes(1)

    await handle.ready()
    expect(window.loadFile).toHaveBeenCalledTimes(1)
    expect(window.show).toHaveBeenCalledTimes(1)
  })

  it('loads http renderers by URL and file renderers by file', async () => {
    const context = { ...standaloneContexts.orbis, paths: { ...standaloneContexts.orbis.paths, renderers: { main: 'http://localhost:5173/index.html' } } }
    const handle = await acquireFeatureSurface(context)
    await handle.ready()
    const window = fakes.FakeWindow.instances[0]!
    expect(window.loadURL).toHaveBeenCalledWith('http://localhost:5173/index.html')
    expect(window.loadFile).not.toHaveBeenCalled()
  })

  it('denies window-open and applies the catalog navigation policy', async () => {
    const bonded = await acquireFeatureSurface(standaloneContexts.bonded)
    const bondedWindow = fakes.FakeWindow.instances[0]!
    expect(bondedWindow.webContents.windowOpenHandler?.({})).toEqual({ action: 'deny' })
    bondedWindow.webContents.url = 'file:///tmp/bonded.html'
    expect(emitNavigation(bondedWindow, 'file:///tmp/bonded.html').preventDefault).toHaveBeenCalled()

    const amove = await acquireFeatureSurface(standaloneContexts.amove)
    const amoveWindow = fakes.FakeWindow.instances[1]!
    await amove.ready()
    const current = amoveWindow.webContents.getURL()
    expect(emitNavigation(amoveWindow, current).preventDefault).not.toHaveBeenCalled()
    expect(emitNavigation(amoveWindow, 'https://elsewhere.example').preventDefault).toHaveBeenCalled()
  })

  it('registers and disposes the product appearance exactly once', async () => {
    const handle = await acquireFeatureSurface(standaloneContexts.orbis)
    const window = fakes.FakeWindow.instances[0]!
    expect(fakes.appearanceRegister).toHaveBeenCalledWith('orbis', window, undefined, { applyNativeTheme: true })

    handle.dispose()
    handle.dispose()
    expect(fakes.appearanceDispose).toHaveBeenCalledTimes(1)
    expect(window.destroy).toHaveBeenCalledTimes(1)
  })

  it('cleans up and stays inert when ready() fails to load', async () => {
    const handle = await acquireFeatureSurface(standaloneContexts.bonded)
    const window = fakes.FakeWindow.instances[0]!
    window.nextLoadError = new Error('renderer failed')
    await expect(handle.ready()).rejects.toThrow('renderer failed')

    expect(fakes.appearanceDispose).toHaveBeenCalledTimes(1)
    expect(window.destroy).toHaveBeenCalledTimes(1)
    await expect(handle.ready()).resolves.toBeUndefined()
    expect(window.loadFile).toHaveBeenCalledTimes(1)
    handle.dispose()
    expect(fakes.appearanceDispose).toHaveBeenCalledTimes(1)
  })

  it('restores a minimized standalone window on activate and tolerates a destroyed one', async () => {
    const handle = await acquireFeatureSurface(standaloneContexts.orbis)
    const window = fakes.FakeWindow.instances[0]!
    window.minimized = true
    handle.activate()
    expect(window.restore).toHaveBeenCalledTimes(1)
    expect(window.show).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(window.restore.mock.invocationCallOrder[0]).toBeLessThan(window.show.mock.invocationCallOrder[0]!)
    expect(window.show.mock.invocationCallOrder[0]).toBeLessThan(window.focus.mock.invocationCallOrder[0]!)

    window.destroyed = true
    expect(() => handle.activate()).not.toThrow()
    expect(window.restore).toHaveBeenCalledTimes(1)
  })

  it('marks the handle disposed on an external close', async () => {
    const handle = await acquireFeatureSurface(standaloneContexts.orbis)
    const window = fakes.FakeWindow.instances[0]!
    window.simulateClose()

    expect(fakes.appearanceDispose).toHaveBeenCalledTimes(1)
    handle.dispose()
    expect(fakes.appearanceDispose).toHaveBeenCalledTimes(1)
    expect(window.destroy).not.toHaveBeenCalled()
    await expect(handle.ready()).resolves.toBeUndefined()
    expect(window.loadFile).not.toHaveBeenCalled()
  })

  it('destroys the window and rethrows when appearance registration fails', async () => {
    fakes.appearanceRegister.mockRejectedValueOnce(new Error('appearance registry locked'))
    await expect(acquireFeatureSurface(standaloneContexts.exithibition)).rejects.toThrow('appearance registry locked')
    const window = fakes.FakeWindow.instances[0]!
    expect(window.destroyed).toBe(true)
    expect(fakes.appearanceDispose).not.toHaveBeenCalled()
  })
})