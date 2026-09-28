import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppPresenceMode, ControllerPage } from '../src/shared/contracts'
import type { NativeHostClientLike, NativeHostSnapshot } from '../src/shared/native-host-contracts'
import type { HostOwnershipOptions, OwnedPresence } from '../src/main/host-ownership'
import type { NativeMenuBarHostOptions } from '../src/main/app-presence'

const electron = vi.hoisted(() => ({
  app: { dock: { hide: vi.fn(), show: vi.fn(async () => undefined) } },
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: { createFromPath: vi.fn() },
  Tray: vi.fn()
}))
vi.mock('electron', () => ({ app: electron.app, Menu: electron.Menu, nativeImage: electron.nativeImage, Tray: electron.Tray }))

const fs = vi.hoisted(() => ({ existsSync: vi.fn((): boolean => true) }))
vi.mock('node:fs', () => ({ existsSync: fs.existsSync }))

import { join } from 'node:path'
import { HostOwnership } from '../src/main/host-ownership'
import { applicationAgentPath, moirasiaFeatureServicePath, moirasiaHostPath, moirasiaHostSocketPath, moirasiaNativeFeaturePaths } from '../src/main/paths'

const USER_DATA = '/tmp/moirasia-user-data'
const RESOURCES = '/tmp/moirasia-resources'
const ICON = '/tmp/trayTemplate.png'
const APPLICATION = '/Applications/Moirasia.app'

const nativeBinaries = (present: boolean): void => { fs.existsSync.mockImplementation(() => present) }
const flush = async (): Promise<void> => { await new Promise<void>((resolve) => setImmediate(resolve)) }

function createHarness(): {
  order: string[]
  presence: OwnedPresence & { apply: ReturnType<typeof vi.fn>; waitForNativeHost: ReturnType<typeof vi.fn>; restartNativeHost: ReturnType<typeof vi.fn>; preserveNativeHost: ReturnType<typeof vi.fn>; abortNativeBootstrap: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }
  client: NativeHostClientLike & { isConnected: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; getSnapshot: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; subscribeConnection: ReturnType<typeof vi.fn> }
  callbacks: { openShell: ReturnType<typeof vi.fn>; toggleShelf: ReturnType<typeof vi.fn>; shelfVisible: ReturnType<typeof vi.fn>; onAvailabilityChanged: ReturnType<typeof vi.fn> }
  presenceOptions: Array<Record<string, unknown>>
  clientOptions: Array<Record<string, unknown>>
  state: { connected: boolean; waitForNativeHost: boolean; connectError: Error | undefined; restartError: Error | undefined; snapshot: NativeHostSnapshot | undefined; resolveRestart: ((ready: boolean) => void) | undefined; quitSuite: { resolve(value: unknown): void; reject(error: Error): void } | undefined }
  options: (overrides?: Partial<HostOwnershipOptions>) => HostOwnershipOptions
  emit: (event: string, payload?: unknown) => void
  emitConnection: (state: 'connected' | 'reconnected' | 'disconnected') => void
} {
  const order: string[] = []
  const presenceOptions: Array<Record<string, unknown>> = []
  const clientOptions: Array<Record<string, unknown>> = []
  const uiListeners = new Map<string, (payload: unknown, revision: number) => void>()
  const connectionListeners = new Set<(event: { state: 'connected' | 'reconnected' | 'disconnected' }) => void>()
  const state = {
    connected: true,
    waitForNativeHost: true,
    connectError: undefined as Error | undefined,
    restartError: undefined as Error | undefined,
    snapshot: { revision: 0 } as NativeHostSnapshot,
    resolveRestart: undefined as ((ready: boolean) => void) | undefined,
    quitSuite: undefined as { resolve(value: unknown): void; reject(error: Error): void } | undefined
  }

  let presenceMode: AppPresenceMode = 'dock'
  const presence: OwnedPresence & Record<'apply' | 'waitForNativeHost' | 'restartNativeHost' | 'preserveNativeHost' | 'abortNativeBootstrap' | 'dispose', ReturnType<typeof vi.fn>> = {
    get mode(): AppPresenceMode { return presenceMode },
    apply: vi.fn((mode: AppPresenceMode): void => { presenceMode = mode; order.push(`apply:${mode}`) }),
    waitForNativeHost: vi.fn(async (): Promise<boolean> => { order.push('waitForNativeHost'); return state.waitForNativeHost }),
    restartNativeHost: vi.fn((): Promise<boolean> => {
      order.push('restartNativeHost')
      if (state.restartError) return Promise.reject(state.restartError)
      return new Promise<boolean>((resolve) => { state.resolveRestart = resolve })
    }),
    preserveNativeHost: vi.fn((): void => { order.push('preserveNativeHost') }),
    abortNativeBootstrap: vi.fn((): void => { order.push('abortNativeBootstrap') }),
    dispose: vi.fn((): void => { order.push('presence.dispose') })
  }

  const client: NativeHostClientLike & { isConnected: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; getSnapshot: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; subscribeConnection: ReturnType<typeof vi.fn> } = {
    isConnected: vi.fn((): boolean => state.connected),
    connect: vi.fn(async (): Promise<void> => { order.push('connect'); if (state.connectError) throw state.connectError }),
    close: vi.fn((): void => { order.push('client.close') }),
    getSnapshot: vi.fn(async (): Promise<NativeHostSnapshot | undefined> => { order.push('getSnapshot'); return state.snapshot }),
    request: <T,>(method: string, _params?: Record<string, unknown>): Promise<T> => {
      order.push(`request:${method}`)
      return new Promise<T>((resolve, reject) => { state.quitSuite = { resolve: (value: unknown) => resolve(value as T), reject } })
    },
    subscribe: vi.fn((event: string, listener: (payload: unknown, revision: number) => void): (() => void) => {
      uiListeners.set(event, listener)
      order.push(`subscribe:${event}`)
      return () => { uiListeners.delete(event); order.push(`unsubscribe:${event}`) }
    }),
    subscribeConnection: vi.fn((listener: (event: { state: 'connected' | 'reconnected' | 'disconnected' }) => void): (() => void) => {
      connectionListeners.add(listener)
      order.push('subscribe:connection')
      return () => { connectionListeners.delete(listener); order.push('unsubscribe:connection') }
    })
  }

  const callbacks = {
    openShell: vi.fn((page?: ControllerPage): void => { order.push(`openShell:${page ?? ''}`) }),
    toggleShelf: vi.fn((): void => { order.push('toggleShelf') }),
    shelfVisible: vi.fn((visible: boolean): void => { order.push(`shelfVisible:${visible}`) }),
    onAvailabilityChanged: vi.fn((): void => { order.push('onAvailabilityChanged') })
  }

  const options = (overrides: Partial<HostOwnershipOptions> = {}): HostOwnershipOptions => ({
    userData: USER_DATA,
    menuBarIconPath: ICON,
    applicationPath: APPLICATION,
    resourcesPath: RESOURCES,
    platform: 'darwin',
    initialPresence: 'menu-bar',
    openShell: callbacks.openShell,
    toggleShelf: callbacks.toggleShelf,
    shelfVisible: callbacks.shelfVisible,
    onAvailabilityChanged: callbacks.onAvailabilityChanged,
    createPresence: (presenceOptionsValue: { menuBarIconPath: string; open(): void; nativeHost?: NativeMenuBarHostOptions }): OwnedPresence => { presenceOptions.push(presenceOptionsValue); return presence },
    createClient: (clientOptionsValue: { socketPath: string; tokenPath: string }): NativeHostClientLike => { clientOptions.push(clientOptionsValue); return client },
    ...overrides
  })

  const emit = (event: string, payload?: unknown): void => { uiListeners.get(event)?.(payload, 1) }
  const emitConnection = (event: { state: 'connected' | 'reconnected' | 'disconnected' }): void => { for (const listener of [...connectionListeners]) listener(event) }

  return { order, presence, client, callbacks, presenceOptions, clientOptions, state, options, emit, emitConnection: (value) => emitConnection({ state: value }) }
}

const nativeOwnership = async (): Promise<{ ownership: HostOwnership } & ReturnType<typeof createHarness>> => {
  const harness = createHarness()
  nativeBinaries(true)
  const ownership = await HostOwnership.acquire(harness.options())
  return { ownership, ...harness }
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })
afterEach(() => { vi.restoreAllMocks() })

describe('HostOwnership', () => {
  it('selects the native runtime and bootstraps in order', async () => {
    const { ownership, presenceOptions, clientOptions, order, presence, client, callbacks } = await nativeOwnership()

    expect(presenceOptions).toEqual([{
      menuBarIconPath: ICON,
      open: expect.any(Function),
      nativeHost: {
        executable: moirasiaHostPath(RESOURCES),
        featureServicePath: moirasiaFeatureServicePath(RESOURCES),
        applicationPath: APPLICATION,
        userData: USER_DATA,
        iconPath: ICON,
        pidPath: join(USER_DATA, 'menu-host.pid'),
        bondedHelperPath: moirasiaNativeFeaturePaths(RESOURCES).bondedHelperPath,
        shoutDriverPath: moirasiaNativeFeaturePaths(RESOURCES).shoutDriverPath
      }
    }])
    expect(clientOptions).toEqual([{ socketPath: moirasiaHostSocketPath(USER_DATA), tokenPath: join(USER_DATA, 'runtime', 'client.token') }])
    expect(order).toEqual(['apply:menu-bar', 'waitForNativeHost', 'connect', 'getSnapshot'])
    expect(ownership.nativeClient).toBe(client)
    expect(ownership.presence).toBe(presence)
    expect(ownership.presence.mode).toBe('menu-bar')
    expect(ownership.canExitToNativeHost()).toBe(true)
    ;(presenceOptions[0]!.open as () => void)()
    expect(callbacks.openShell).toHaveBeenCalledTimes(1)
  })

  it('aborts and rethrows without a local fallback when the native host never becomes ready', async () => {
    const harness = createHarness()
    nativeBinaries(true)
    harness.state.waitForNativeHost = false

    await expect(HostOwnership.acquire(harness.options())).rejects.toThrow('MoirasiaHost.app did not become ready.')
    expect(harness.order).toEqual(['apply:menu-bar', 'waitForNativeHost', 'abortNativeBootstrap', 'client.close'])
    expect(harness.presence.abortNativeBootstrap).toHaveBeenCalledTimes(1)
    expect(harness.client.close).toHaveBeenCalledTimes(1)
    expect(harness.presenceOptions).toHaveLength(1)
    expect(console.error).toHaveBeenCalledWith('Native Moirasia bootstrap failed; local ownership was not selected.', expect.any(Error))
  })

  it('aborts and rethrows when connecting to the native host fails', async () => {
    const harness = createHarness()
    nativeBinaries(true)
    harness.state.connectError = new Error('socket unavailable')

    await expect(HostOwnership.acquire(harness.options())).rejects.toThrow('MoirasiaHost.app did not become ready.')
    expect(harness.order).toEqual(['apply:menu-bar', 'waitForNativeHost', 'connect', 'abortNativeBootstrap', 'client.close'])
    expect(console.error).toHaveBeenCalledWith('Could not connect to MoirasiaHost', expect.any(Error))
    expect(console.error).toHaveBeenCalledWith('Native Moirasia bootstrap failed; local ownership was not selected.', expect.any(Error))
  })

  it('aborts and rethrows when the bootstrap snapshot is invalid', async () => {
    const harness = createHarness()
    nativeBinaries(true)
    harness.state.snapshot = undefined

    await expect(HostOwnership.acquire(harness.options())).rejects.toThrow('MoirasiaHost.app did not become ready.')
    expect(harness.order).toEqual(['apply:menu-bar', 'waitForNativeHost', 'connect', 'getSnapshot', 'abortNativeBootstrap', 'client.close'])
    expect(console.error).toHaveBeenCalledWith('MoirasiaHost returned an invalid snapshot.')
    expect(console.error).toHaveBeenCalledWith('Native Moirasia bootstrap failed; local ownership was not selected.', expect.any(Error))
  })

  it('falls back to the local agent options on darwin when binaries are absent', async () => {
    const harness = createHarness()
    nativeBinaries(false)

    const ownership = await HostOwnership.acquire(harness.options())
    expect(harness.presenceOptions).toEqual([{
      menuBarIconPath: ICON,
      open: expect.any(Function),
      nativeHost: { executable: applicationAgentPath(RESOURCES), applicationPath: APPLICATION, pidPath: join(USER_DATA, 'menu-host.pid') }
    }])
    expect(harness.clientOptions).toEqual([])
    expect(ownership.nativeClient).toBeUndefined()
    expect(ownership.canExitToNativeHost()).toBe(false)
    expect(ownership.presence.mode).toBe('menu-bar')
  })

  it('passes no native host off darwin', async () => {
    const harness = createHarness()
    nativeBinaries(false)

    const ownership = await HostOwnership.acquire(harness.options({ platform: 'linux' }))
    expect(harness.presenceOptions).toEqual([{ menuBarIconPath: ICON, open: expect.any(Function) }])
    expect(ownership.nativeClient).toBeUndefined()
    expect(ownership.presence.mode).toBe('menu-bar')
  })

  it('reconnects once after a disconnect and skips a failed or throwing restart', async () => {
    const { ownership, emitConnection, state, presence, client, callbacks } = await nativeOwnership()
    ownership.start()

    emitConnection('disconnected')
    expect(callbacks.onAvailabilityChanged).toHaveBeenCalledTimes(1)
    expect(presence.restartNativeHost).toHaveBeenCalledTimes(1)
    emitConnection('disconnected')
    expect(presence.restartNativeHost).toHaveBeenCalledTimes(1)
    expect(callbacks.onAvailabilityChanged).toHaveBeenCalledTimes(2)

    state.resolveRestart!(true)
    await flush()
    expect(client.connect).toHaveBeenCalledTimes(2)

    emitConnection('disconnected')
    expect(presence.restartNativeHost).toHaveBeenCalledTimes(2)
    state.resolveRestart!(false)
    await flush()
    expect(client.connect).toHaveBeenCalledTimes(2)

    state.restartError = new Error('restart crashed')
    emitConnection('disconnected')
    await flush()
    expect(presence.restartNativeHost).toHaveBeenCalledTimes(3)
    expect(client.connect).toHaveBeenCalledTimes(2)
    expect(console.error).toHaveBeenCalledWith('Could not reconnect to MoirasiaHost', expect.any(Error))
  })

  it('reports reconnections without restarting the host', async () => {
    const { ownership, emitConnection, presence, callbacks } = await nativeOwnership()
    ownership.start()

    emitConnection('reconnected')
    expect(callbacks.onAvailabilityChanged).toHaveBeenCalledTimes(1)
    expect(presence.restartNativeHost).not.toHaveBeenCalled()
  })

  it('does not restart after the host initiated its quit', async () => {
    const { ownership, emit, emitConnection, presence, callbacks } = await nativeOwnership()
    ownership.start()

    emit('host.willQuit')
    emitConnection('disconnected')
    expect(callbacks.onAvailabilityChanged).toHaveBeenCalledTimes(1)
    expect(presence.restartNativeHost).not.toHaveBeenCalled()
  })

  it('routes native UI events to the shell callbacks', async () => {
    const { ownership, emit, callbacks } = await nativeOwnership()
    ownership.start()

    emit('ui.openShell')
    expect(callbacks.openShell).toHaveBeenCalledTimes(1)
    emit('ui.toggleShelf')
    expect(callbacks.toggleShelf).toHaveBeenCalledTimes(1)
    emit('host.uiStateChanged', { shelfVisible: true })
    expect(callbacks.shelfVisible).toHaveBeenCalledTimes(1)
    expect(callbacks.shelfVisible).toHaveBeenCalledWith(true)
    emit('host.uiStateChanged', { shelfVisible: 'yes' })
    emit('host.uiStateChanged', null)
    emit('host.uiStateChanged', 42)
    expect(callbacks.shelfVisible).toHaveBeenCalledTimes(1)
  })

  it('preserves the host for a recorded exit-to-host and skips the request', async () => {
    const { ownership, order, presence, client } = await nativeOwnership()
    ownership.start()
    ownership.exitToHost()
    const teardown = vi.fn(async (): Promise<void> => { order.push('teardown') })

    await ownership.coordinateQuit(teardown)
    expect(order.slice(order.indexOf('unsubscribe:connection'))).toEqual([
      'unsubscribe:connection',
      'unsubscribe:host.willQuit',
      'unsubscribe:ui.openShell',
      'unsubscribe:ui.toggleShelf',
      'unsubscribe:host.uiStateChanged',
      'preserveNativeHost',
      'presence.dispose',
      'teardown',
      'client.close'
    ])
    expect(order).not.toContain('request:host.quitSuite')
    expect(presence.preserveNativeHost).toHaveBeenCalledTimes(1)

    const disconnected = await nativeOwnership()
    disconnected.state.connected = false
    disconnected.ownership.exitToHost()
    await disconnected.ownership.coordinateQuit(vi.fn(async () => undefined))
    expect(disconnected.presence.preserveNativeHost).not.toHaveBeenCalled()
    expect(disconnected.order).not.toContain('request:host.quitSuite')
  })

  it('requests host.quitSuite and closes the client only after the request settles', async () => {
    const { ownership, order, state, client, presence } = await nativeOwnership()
    ownership.start()
    const teardown = vi.fn(async (): Promise<void> => { order.push('teardown') })

    const quit = ownership.coordinateQuit(teardown)
    expect(order.slice(order.indexOf('request:host.quitSuite'))).toEqual(['request:host.quitSuite'])
    expect(teardown).not.toHaveBeenCalled()
    expect(client.close).not.toHaveBeenCalled()

    state.quitSuite!.resolve(undefined)
    await quit
    expect(order.slice(order.indexOf('presence.dispose'))).toEqual(['presence.dispose', 'request:host.quitSuite', 'teardown', 'client.close'])
    expect(presence.dispose).toHaveBeenCalledTimes(1)
  })

  it('still tears down when the quitSuite request rejects', async () => {
    const { ownership, order, state, client } = await nativeOwnership()
    ownership.start()
    const teardown = vi.fn(async (): Promise<void> => { order.push('teardown') })

    const quit = ownership.coordinateQuit(teardown)
    state.quitSuite!.reject(new Error('host refused'))
    await quit
    expect(console.error).toHaveBeenCalledWith('Could not coordinate native suite quit', expect.any(Error))
    expect(teardown).toHaveBeenCalledTimes(1)
    expect(client.close).toHaveBeenCalledTimes(1)
  })

  it('quits without a request after the host will quit', async () => {
    const { ownership, emit, order, client } = await nativeOwnership()
    ownership.start()
    emit('host.willQuit')
    const teardown = vi.fn(async (): Promise<void> => { order.push('teardown') })

    await ownership.coordinateQuit(teardown)
    expect(order).not.toContain('request:host.quitSuite')
    expect(order.slice(order.indexOf('presence.dispose'))).toEqual(['presence.dispose', 'teardown', 'client.close'])
  })

  it('quits in local mode with no request and no client', async () => {
    const harness = createHarness()
    nativeBinaries(false)
    const ownership = await HostOwnership.acquire(harness.options())
    ownership.start()
    const teardown = vi.fn(async (): Promise<void> => { harness.order.push('teardown') })

    await ownership.coordinateQuit(teardown)
    expect(harness.order).toEqual(['apply:menu-bar', 'presence.dispose', 'teardown'])
    expect(teardown).toHaveBeenCalledTimes(1)
    expect(harness.order).not.toContain('request:host.quitSuite')
    expect(harness.client.close).not.toHaveBeenCalled()
  })

  it('registers each native subscription exactly once per start', async () => {
    const { ownership, client } = await nativeOwnership()
    ownership.start()
    ownership.start()
    expect(client.subscribe).toHaveBeenCalledTimes(4)
    expect(client.subscribeConnection).toHaveBeenCalledTimes(1)
  })
})