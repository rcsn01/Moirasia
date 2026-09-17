import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => {
  type Listener = (...args: any[]) => void

  class FakeWebContents {
    currentUrl = ''
    readonly listeners = new Map<string, Listener[]>()
    windowOpenHandler: (() => { action: string }) | undefined
    setWindowOpenHandler = vi.fn((handler: () => { action: string }): void => {
      if (FakeWindow.nextWindowOpenError) {
        const error = FakeWindow.nextWindowOpenError
        FakeWindow.nextWindowOpenError = undefined
        throw error
      }
      this.windowOpenHandler = handler
    })
    on = vi.fn((event: string, listener: Listener): void => {
      if (event === 'will-navigate' && FakeWindow.nextNavigationError) {
        const error = FakeWindow.nextNavigationError
        FakeWindow.nextNavigationError = undefined
        throw error
      }
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    })
    getURL = vi.fn(() => this.currentUrl)
    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args)
    }
  }

  class FakeWindow {
    static instances: FakeWindow[] = []
    static nextWindowOpenError: Error | undefined
    static nextNavigationError: Error | undefined
    readonly options: Record<string, any>
    readonly webContents = new FakeWebContents()
    readonly listeners = new Map<string, Listener[]>()
    destroyed = false
    minimized = false
    loadFile = vi.fn(async (path: string): Promise<void> => { this.webContents.currentUrl = `file://${path}` })
    loadURL = vi.fn(async (url: string): Promise<void> => { this.webContents.currentUrl = url })
    show = vi.fn()
    focus = vi.fn()
    restore = vi.fn((): void => { this.minimized = false })
    destroy = vi.fn((): void => { this.destroyed = true; this.emit('closed') })
    isDestroyed = vi.fn(() => this.destroyed)
    isMinimized = vi.fn(() => this.minimized)

    constructor(options: Record<string, any>) {
      this.options = options
      FakeWindow.instances.push(this)
    }

    on(event: string, listener: Listener): void {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args)
    }

    simulateClose(): void {
      this.destroyed = true
      this.emit('closed')
    }
  }

  const disposeAppearance = vi.fn()
  const registerProductAppearance = vi.fn<() => Promise<() => void>>()

  return { FakeWindow, disposeAppearance, registerProductAppearance }
})

vi.mock('electron', () => ({ BrowserWindow: fakes.FakeWindow }))
vi.mock('../packages/desktop-shell/src/main', () => ({
  desktopWindowChromeOptions: vi.fn(() => ({ titleBarStyle: 'hiddenInset' })),
  neutralWindowBackground: vi.fn((appearance: string) => `background-${appearance}`),
  registerProductAppearance: fakes.registerProductAppearance
}))

import { acquireOwnedWindowSurface, type OwnedWindowSurfaceOptions } from '../packages/desktop-shell/src/owned-window-surface'

const sharedOptions: OwnedWindowSurfaceOptions = {
  productId: 'bonded',
  title: 'Bonded',
  width: 430,
  height: 600,
  minWidth: 390,
  minHeight: 500,
  preload: '/tmp/preload.cjs',
  renderer: '/tmp/index.html',
  appearance: { initial: 'dark', registry: 'shared' }
}

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function emitNavigation(window: InstanceType<typeof fakes.FakeWindow>, url: string) {
  const event = { preventDefault: vi.fn() }
  window.webContents.emit('will-navigate', event, url)
  return event
}

describe('owned window surface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakes.FakeWindow.instances = []
    fakes.FakeWindow.nextWindowOpenError = undefined
    fakes.FakeWindow.nextNavigationError = undefined
    fakes.registerProductAppearance.mockReset().mockResolvedValue(fakes.disposeAppearance)
  })

  it('acquires one hidden unloaded shared-registry window with fixed security policy', async () => {
    const surface = await acquireOwnedWindowSurface(sharedOptions)
    const window = fakes.FakeWindow.instances[0]!

    expect(fakes.FakeWindow.instances).toHaveLength(1)
    expect(window.options).toEqual({
      title: 'Bonded', width: 430, height: 600, minWidth: 390, minHeight: 500,
      show: false, titleBarStyle: 'hiddenInset', fullscreenable: true,
      backgroundColor: 'background-dark',
      webPreferences: {
        preload: '/tmp/preload.cjs', contextIsolation: true, nodeIntegration: false,
        sandbox: true, spellcheck: false
      }
    })
    expect(window.loadFile).not.toHaveBeenCalled()
    expect(window.loadURL).not.toHaveBeenCalled()
    expect(window.show).not.toHaveBeenCalled()
    expect(fakes.registerProductAppearance).toHaveBeenCalledWith('bonded', window, undefined, { applyNativeTheme: true })
    expect(surface.window).toBe(window)
    expect(surface.webContents).toBe(window.webContents)
  })

  it('forwards app-local appearance and optional window facts', async () => {
    await acquireOwnedWindowSurface({
      ...sharedOptions,
      appearance: { initial: 'system', registry: { path: '/tmp/appearance.json' } },
      icon: '/tmp/icon.png', devTools: false, spellcheck: true,
      fullscreenable: false, navigation: 'allow-same-url'
    })
    const window = fakes.FakeWindow.instances[0]!
    expect(window.options).toMatchObject({
      icon: '/tmp/icon.png', fullscreenable: false, backgroundColor: 'background-system',
      webPreferences: { devTools: false, spellcheck: true }
    })
    expect(fakes.registerProductAppearance).toHaveBeenCalledWith('bonded', window, 'system', {
      applyNativeTheme: true,
      registryPath: '/tmp/appearance.json'
    })
  })

  it.each([
    ['width', 0], ['width', -1], ['width', 1.5], ['width', Number.NaN],
    ['width', Number.POSITIVE_INFINITY], ['width', Number.MAX_SAFE_INTEGER + 1],
    ['height', 0], ['minWidth', 0], ['minHeight', 0]
  ] as const)('rejects invalid %s %s before construction', async (name, value) => {
    await expect(acquireOwnedWindowSurface({ ...sharedOptions, [name]: value })).rejects.toThrow(`Standalone window ${name} must be a positive integer.`)
    expect(fakes.FakeWindow.instances).toHaveLength(0)
  })

  it('accepts equal minimums and rejects either minimum above its initial size', async () => {
    const equal = await acquireOwnedWindowSurface({ ...sharedOptions, minWidth: 430, minHeight: 600 })
    equal.dispose()
    await expect(acquireOwnedWindowSurface({ ...sharedOptions, minWidth: 431 })).rejects.toThrow('Standalone window minimum size exceeds its initial size.')
    await expect(acquireOwnedWindowSurface({ ...sharedOptions, minHeight: 601 })).rejects.toThrow('Standalone window minimum size exceeds its initial size.')
    expect(fakes.FakeWindow.instances).toHaveLength(1)
  })

  it.each(['/tmp/preload.cjs', '\\\\server\\share\\preload.cjs', 'C:\\app\\preload.cjs', 'C:/app/preload.cjs'])('accepts the supported absolute path family: %s', async (preload) => {
    const surface = await acquireOwnedWindowSurface({ ...sharedOptions, preload })
    expect(surface.window).toBe(fakes.FakeWindow.instances[0])
    surface.dispose()
  })

  it.each(['relative.cjs', 'C:relative.cjs', '\\rooted.cjs'])('rejects unsupported preload path %s before construction', async (preload) => {
    await expect(acquireOwnedWindowSurface({ ...sharedOptions, preload })).rejects.toThrow('Standalone window preload must be an absolute path.')
    expect(fakes.FakeWindow.instances).toHaveLength(0)
  })

  it.each(['relative.html', 'file:///tmp/index.html', 'ftp://example.com/index.html', 'https://'])('rejects invalid renderer %s before construction', async (renderer) => {
    await expect(acquireOwnedWindowSurface({ ...sharedOptions, renderer })).rejects.toThrow('Standalone window renderer must be an absolute path or HTTP URL.')
    expect(fakes.FakeWindow.instances).toHaveLength(0)
  })

  it('rejects a relative app-local appearance path before construction', async () => {
    const appearance = { initial: 'dark', registry: { path: 'appearance.json' } } as const
    await expect(acquireOwnedWindowSurface({ ...sharedOptions, appearance })).rejects.toThrow('Standalone appearance file must be an absolute path.')
    expect(fakes.FakeWindow.instances).toHaveLength(0)
  })

  it('always denies window.open', async () => {
    await acquireOwnedWindowSurface(sharedOptions)
    expect(fakes.FakeWindow.instances[0]!.webContents.windowOpenHandler?.()).toEqual({ action: 'deny' })
  })

  it('deny prevents every navigation', async () => {
    await acquireOwnedWindowSurface(sharedOptions)
    const window = fakes.FakeWindow.instances[0]!
    window.webContents.currentUrl = 'file:///tmp/index.html'
    expect(emitNavigation(window, 'file:///tmp/index.html').preventDefault).toHaveBeenCalledTimes(1)
    expect(emitNavigation(window, 'https://example.com').preventDefault).toHaveBeenCalledTimes(1)
  })

  it('allow-same-url permits only exact equality with the current URL', async () => {
    const surface = await acquireOwnedWindowSurface({ ...sharedOptions, navigation: 'allow-same-url' })
    const window = fakes.FakeWindow.instances[0]!
    expect(emitNavigation(window, 'file:///tmp/index.html').preventDefault).toHaveBeenCalledTimes(1)
    await surface.ready()
    const current = window.webContents.getURL()
    expect(emitNavigation(window, current).preventDefault).not.toHaveBeenCalled()
    expect(emitNavigation(window, `${current}?changed`).preventDefault).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['http://localhost:5173/index.html', 'loadURL'],
    ['HTTPS://example.com/index.html', 'loadURL'],
    ['http:localhost', 'loadURL'],
    ['/tmp/index.html', 'loadFile']
  ] as const)('loads %s through %s', async (renderer, method) => {
    const surface = await acquireOwnedWindowSurface({ ...sharedOptions, renderer })
    const window = fakes.FakeWindow.instances[0]!
    await surface.ready()
    expect(window[method]).toHaveBeenCalledWith(renderer)
  })

  it('coalesces concurrent and repeated readiness into one load and one show', async () => {
    const surface = await acquireOwnedWindowSurface(sharedOptions)
    const window = fakes.FakeWindow.instances[0]!
    const load = deferred<void>()
    window.loadFile.mockReturnValueOnce(load.promise)

    const first = surface.ready()
    const second = surface.ready()
    expect(first).toBe(second)
    expect(window.loadFile).toHaveBeenCalledTimes(1)
    load.resolve()
    await first
    await surface.ready()
    expect(window.loadFile).toHaveBeenCalledTimes(1)
    expect(window.show).toHaveBeenCalledTimes(1)
  })

  it('disposes immediately during an in-flight load and never shows afterward', async () => {
    const surface = await acquireOwnedWindowSurface(sharedOptions)
    const window = fakes.FakeWindow.instances[0]!
    const load = deferred<void>()
    window.loadFile.mockReturnValueOnce(load.promise)
    const readiness = surface.ready()

    surface.dispose()
    expect(fakes.disposeAppearance).toHaveBeenCalledTimes(1)
    expect(window.destroy).toHaveBeenCalledTimes(1)
    load.resolve()
    await readiness
    expect(window.show).not.toHaveBeenCalled()
    expect(fakes.disposeAppearance).toHaveBeenCalledTimes(1)
  })

  it('rolls back a failed renderer load and leaves later readiness inert', async () => {
    const surface = await acquireOwnedWindowSurface(sharedOptions)
    const window = fakes.FakeWindow.instances[0]!
    const error = new Error('load failed')
    window.loadFile.mockRejectedValueOnce(error)
    await expect(surface.ready()).rejects.toBe(error)
    expect(fakes.disposeAppearance).toHaveBeenCalledTimes(1)
    expect(window.destroy).toHaveBeenCalledTimes(1)
    await expect(surface.ready()).resolves.toBeUndefined()
    expect(window.loadFile).toHaveBeenCalledTimes(1)
  })

  it('rolls back a synchronous show failure and rethrows it', async () => {
    const surface = await acquireOwnedWindowSurface(sharedOptions)
    const window = fakes.FakeWindow.instances[0]!
    const error = new Error('show failed')
    window.show.mockImplementationOnce(() => { throw error })
    await expect(surface.ready()).rejects.toBe(error)
    expect(fakes.disposeAppearance).toHaveBeenCalledTimes(1)
    expect(window.destroy).toHaveBeenCalledTimes(1)
  })

  it('restores, shows, and focuses on activation, then becomes inert', async () => {
    const surface = await acquireOwnedWindowSurface(sharedOptions)
    const window = fakes.FakeWindow.instances[0]!
    window.minimized = true
    surface.activate()
    expect(window.restore).toHaveBeenCalledTimes(1)
    expect(window.restore.mock.invocationCallOrder[0]).toBeLessThan(window.show.mock.invocationCallOrder[0]!)
    expect(window.show.mock.invocationCallOrder[0]).toBeLessThan(window.focus.mock.invocationCallOrder[0]!)
    surface.dispose()
    surface.activate()
    expect(window.show).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it('cleans appearance before explicit destruction and remains idempotent', async () => {
    const surface = await acquireOwnedWindowSurface(sharedOptions)
    const window = fakes.FakeWindow.instances[0]!
    surface.dispose()
    surface.dispose()
    expect(fakes.disposeAppearance).toHaveBeenCalledTimes(1)
    expect(window.destroy).toHaveBeenCalledTimes(1)
    expect(fakes.disposeAppearance.mock.invocationCallOrder[0]).toBeLessThan(window.destroy.mock.invocationCallOrder[0]!)
  })

  it('cleans once on external close without destroying again and leaves methods inert', async () => {
    const surface = await acquireOwnedWindowSurface(sharedOptions)
    const window = fakes.FakeWindow.instances[0]!
    window.simulateClose()
    expect(fakes.disposeAppearance).toHaveBeenCalledTimes(1)
    surface.dispose()
    surface.activate()
    await surface.ready()
    expect(window.destroy).not.toHaveBeenCalled()
    expect(window.loadFile).not.toHaveBeenCalled()
    expect(window.show).not.toHaveBeenCalled()
  })

  it('destroys the window and rethrows an appearance registration failure', async () => {
    const error = new Error('appearance failed')
    fakes.registerProductAppearance.mockRejectedValueOnce(error)
    await expect(acquireOwnedWindowSurface(sharedOptions)).rejects.toBe(error)
    expect(fakes.FakeWindow.instances[0]!.destroy).toHaveBeenCalledTimes(1)
    expect(fakes.disposeAppearance).not.toHaveBeenCalled()
  })

  it('disposes eventual appearance state when externally closed during registration', async () => {
    const registration = deferred<() => void>()
    fakes.registerProductAppearance.mockReturnValueOnce(registration.promise)
    const acquisition = acquireOwnedWindowSurface(sharedOptions)
    const window = fakes.FakeWindow.instances[0]!
    window.simulateClose()
    registration.resolve(fakes.disposeAppearance)
    const surface = await acquisition

    expect(fakes.disposeAppearance).toHaveBeenCalledTimes(1)
    expect(window.destroy).not.toHaveBeenCalled()
    await surface.ready()
    surface.activate()
    surface.dispose()
    expect(window.loadFile).not.toHaveBeenCalled()
    expect(window.show).not.toHaveBeenCalled()
    expect(fakes.disposeAppearance).toHaveBeenCalledTimes(1)
  })

  it.each(['window-open', 'navigation'] as const)('rolls back a synchronous %s guard failure', async (guard) => {
    const error = new Error(`${guard} failed`)
    if (guard === 'window-open') fakes.FakeWindow.nextWindowOpenError = error
    else fakes.FakeWindow.nextNavigationError = error
    await expect(acquireOwnedWindowSurface(sharedOptions)).rejects.toBe(error)
    const window = fakes.FakeWindow.instances[0]!
    expect(window.destroy).toHaveBeenCalledTimes(1)
    expect(fakes.registerProductAppearance).not.toHaveBeenCalled()
    if (guard === 'navigation') expect(window.webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1)
  })
})
