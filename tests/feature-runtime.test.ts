import { EventEmitter } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureContext, FeatureId, MoirasiaFeature } from '../packages/desktop-shell/src/feature'

const electron = vi.hoisted(() => ({ app: { relaunch: vi.fn(), exit: vi.fn((code?: number) => code) } }))
vi.mock('electron', () => electron)

import { EmbeddedFeatureHost } from '../src/main/features/embedded-host'
import { FeatureRuntime } from '../src/main/features/runtime'
import { ShellSettingsStore } from '../src/main/settings'
import { isNativeHostSnapshot, type NativeHostClientLike, type NativeHostConnectionEvent, type NativeHostSnapshot } from '../src/shared/native-host-contracts'

class FakeShellWindow extends EventEmitter {
  webContents = {}
  destroyed = false
  isDestroyed(): boolean { return this.destroyed }
  isFocused(): boolean { return false }
  show(): void {}
  focus(): void {}
}

const CONTEXT: FeatureContext = {
  id: 'amove', mode: 'suite', productId: 'amove',
  surface: { renderer: { current: () => undefined, send: () => false, subscribe: () => () => undefined }, state: { active: false, focused: false }, activate: () => undefined, focus: () => undefined, subscribe: () => () => undefined },
  paths: { preloads: { shelf: '/tmp/feature.cjs' }, renderers: { shelf: '/tmp/feature.html' }, native: { addon: '/tmp/AmoveNative' } }
}

function fakeFeature(): { feature: MoirasiaFeature; register: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; activate: ReturnType<typeof vi.fn> } {
  const register = vi.fn(async (_ctx: FeatureContext) => {}), dispose = vi.fn(async () => {}), activate = vi.fn()
  return { feature: { id: 'amove', register, dispose, activate }, register, dispose, activate }
}

async function settingsWith(features: Record<string, boolean> | undefined): Promise<ShellSettingsStore> {
  const directory = await mkdtemp(join(tmpdir(), 'moirasia-runtime-'))
  const path = join(directory, 'settings.json')
  if (features !== undefined) await writeFile(path, JSON.stringify({ version: 3, launchAtLogin: false, pendingLoginItems: {}, features }))
  const store = new ShellSettingsStore(path)
  await store.load()
  return store
}

function nativeSnapshot(revision: number, amove: { installed: boolean; state: 'stopped' | 'starting' | 'running' | 'error'; error?: string } = { installed: true, state: 'running' }): NativeHostSnapshot {
  return {
    version: 1,
    revision,
    settings: { version: 4, launchAtLogin: false, appPresence: 'dock', pendingLoginItems: {}, features: {} },
    features: [
      { id: 'amove', ...amove },
      { id: 'bonded', installed: false, state: 'stopped' },
      { id: 'shout', installed: false, state: 'stopped' }
    ]
  }
}

describe('FeatureRuntime', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => { vi.restoreAllMocks() })

  it('never invokes the loader for a feature uninstalled at launch', async () => {
    const loader = vi.fn(async () => ({ feature: fakeFeature().feature }))
    const runtime = new FeatureRuntime(await settingsWith({ amove: false }), { loaders: { amove: loader }, context: () => CONTEXT })

    await runtime.syncAtLaunch()

    expect(loader).not.toHaveBeenCalled()
    expect(runtime.statuses()).toEqual([{ id: 'amove', installed: false, loaded: false, restartPending: false }])
  })

  it('registers installed features at launch with the suite context', async () => {
    const fake = fakeFeature()
    const runtime = new FeatureRuntime(await settingsWith(undefined), { loaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })

    await runtime.syncAtLaunch()

    expect(fake.register).toHaveBeenCalledTimes(1)
    expect(fake.register).toHaveBeenCalledWith(CONTEXT)
    expect(runtime.statuses()).toEqual([{ id: 'amove', installed: true, loaded: true, restartPending: false }])
  })

  it('pauses Bonded when the shell hides without unloading other features, then disposes them on quit', async () => {
    const bonded = { setShellVisible: vi.fn(), dispose: vi.fn(async () => {}) }
    const amove = { setShellVisible: vi.fn(), dispose: vi.fn(async () => {}) }
    const runtime = new FeatureRuntime(await settingsWith(undefined), {
      loaders: {
        bonded: async () => ({ feature: { id: 'bonded', register: vi.fn(), ...bonded } }),
        amove: async () => ({ feature: { id: 'amove', register: vi.fn(), ...amove } })
      },
      context: (id) => ({ ...CONTEXT, id, productId: id })
    })

    await runtime.syncAtLaunch()
    runtime.setShellVisible(false)

    expect(bonded.setShellVisible).toHaveBeenCalledWith(false)
    expect(amove.setShellVisible).toHaveBeenCalledWith(false)
    expect(bonded.dispose).not.toHaveBeenCalled()
    expect(amove.dispose).not.toHaveBeenCalled()
    expect(runtime.statuses().every((status) => status.loaded)).toBe(true)

    await runtime.disposeAll()
    expect(bonded.dispose).toHaveBeenCalledOnce()
    expect(amove.dispose).toHaveBeenCalledOnce()
  })

  it('installs mid-session once and treats repeated installs as no-ops', async () => {
    const fake = fakeFeature()
    const loader = vi.fn(async () => ({ feature: fake.feature }))
    const settings = await settingsWith({ amove: false })
    const runtime = new FeatureRuntime(settings, { loaders: { amove: loader }, context: () => CONTEXT })
    await runtime.syncAtLaunch()

    await runtime.setInstalled('amove', true)
    await runtime.setInstalled('amove', true)

    expect(loader).toHaveBeenCalledTimes(1)
    expect(fake.register).toHaveBeenCalledTimes(1)
    expect(settings.get().features.amove).toBe(true)
  })

  it('serializes an uninstall that arrives during registration', async () => {
    let release!: () => void
    let registrationStarted!: () => void
    const started = new Promise<void>((resolve) => { registrationStarted = resolve })
    const register = vi.fn(async (_ctx: FeatureContext) => {
      registrationStarted()
      await new Promise<void>((resolve) => { release = resolve })
    })
    const dispose = vi.fn(async () => {})
    const feature: MoirasiaFeature = { id: 'amove', register, dispose, activate: vi.fn() }
    const settings = await settingsWith({ amove: false })
    const runtime = new FeatureRuntime(settings, { loaders: { amove: async () => ({ feature }) }, context: () => CONTEXT })

    const installing = runtime.setInstalled('amove', true)
    await started
    const uninstalling = runtime.setInstalled('amove', false)
    release()
    await Promise.all([installing, uninstalling])

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(runtime.statuses()[0]).toMatchObject({ installed: false, loaded: true, restartPending: true })
  })

  it('disposes exactly once on mid-session uninstall and flags the restart', async () => {
    const fake = fakeFeature()
    const settings = await settingsWith(undefined)
    const runtime = new FeatureRuntime(settings, { loaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })
    await runtime.syncAtLaunch()

    await runtime.setInstalled('amove', false)
    await runtime.setInstalled('amove', false)

    expect(fake.dispose).toHaveBeenCalledTimes(1)
    expect(settings.get().features.amove).toBe(false)
    expect(runtime.statuses()).toEqual([{ id: 'amove', installed: false, loaded: true, restartPending: true }])
  })

  it('keeps a failed disposal installed so uninstall can be retried', async () => {
    const fake = fakeFeature()
    fake.dispose.mockRejectedValueOnce(new Error('native process did not stop'))
    const settings = await settingsWith(undefined)
    const runtime = new FeatureRuntime(settings, { loaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })
    await runtime.syncAtLaunch()

    await expect(runtime.setInstalled('amove', false)).rejects.toThrow('native process did not stop')
    expect(settings.get().features.amove).toBe(true)
    expect(runtime.isLoaded('amove')).toBe(true)
    expect(runtime.statuses()[0]).toMatchObject({ installed: true, loaded: true })

    await runtime.setInstalled('amove', false)
    expect(fake.dispose).toHaveBeenCalledTimes(2)
    expect(settings.get().features.amove).toBe(false)
  })

  it('does not flag a restart when the feature was never loaded this session', async () => {
    const fake = fakeFeature()
    const runtime = new FeatureRuntime(await settingsWith({ amove: false }), { loaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })
    await runtime.syncAtLaunch()

    await runtime.setInstalled('amove', false)

    expect(fake.dispose).not.toHaveBeenCalled()
    expect(runtime.statuses()[0]).toMatchObject({ installed: false, loaded: false, restartPending: false })
  })

  it('re-registers a fresh controller when reinstalled after teardown', async () => {
    const fake = fakeFeature()
    const runtime = new FeatureRuntime(await settingsWith(undefined), { loaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })
    await runtime.syncAtLaunch()
    await runtime.setInstalled('amove', false)

    await runtime.setInstalled('amove', true)

    expect(fake.register).toHaveBeenCalledTimes(2)
    expect(runtime.statuses()[0]).toMatchObject({ installed: true, loaded: true, restartPending: false })
  })

  it('disposes every loaded feature exactly once and is idempotent', async () => {
    const fake = fakeFeature()
    const runtime = new FeatureRuntime(await settingsWith(undefined), { loaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })
    await runtime.syncAtLaunch()

    await runtime.disposeAll()
    await runtime.disposeAll()

    expect(fake.dispose).toHaveBeenCalledTimes(1)
  })

  it('cleans up and stays unloaded when register fails', async () => {
    const fake = fakeFeature()
    fake.register.mockRejectedValueOnce(new Error('native helper missing'))
    const runtime = new FeatureRuntime(await settingsWith(undefined), { loaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })

    await runtime.syncAtLaunch()

    expect(fake.dispose).toHaveBeenCalledTimes(1)
    expect(runtime.statuses()[0]).toMatchObject({ installed: true, loaded: false, loadError: 'native helper missing' })
    expect(() => runtime.activate('amove')).toThrow(/not running/)
  })

  it('rolls back a newly enabled feature when registration fails', async () => {
    const fake = fakeFeature()
    fake.register.mockRejectedValueOnce(new Error('Vox is already using Vox.'))
    const settings = await settingsWith({ amove: false })
    const runtime = new FeatureRuntime(settings, { loaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })

    await runtime.setInstalled('amove', true)

    expect(settings.get().features.amove).toBe(false)
    expect(runtime.statuses()[0]).toMatchObject({ installed: false, loaded: false, loadError: 'Vox is already using Vox.' })
  })

  it('surfaces a Bonded registration error and clears it after a successful retry', async () => {
    const register = vi.fn().mockRejectedValueOnce(new Error('Bonded is already running in Bonded.')).mockResolvedValue(undefined)
    const dispose = vi.fn(async () => {})
    const feature: MoirasiaFeature = { id: 'bonded', register, dispose }
    const context = { ...CONTEXT, id: 'bonded', productId: 'bonded' } as FeatureContext
    const runtime = new FeatureRuntime(await settingsWith(undefined), { loaders: { bonded: async () => ({ feature }) }, context: () => context })

    await runtime.syncAtLaunch()
    expect(runtime.statuses()[0]).toMatchObject({ id: 'bonded', loaded: false, loadError: 'Bonded is already running in Bonded.' })
    expect(dispose).toHaveBeenCalledTimes(1)

    await runtime.setInstalled('bonded', true)
    expect(register).toHaveBeenCalledTimes(2)
    expect(runtime.statuses()[0]).toEqual({ id: 'bonded', installed: true, loaded: true, restartPending: false })
  })

  it('activates a running feature and rejects foreign application ids', async () => {
    const fake = fakeFeature()
    const runtime = new FeatureRuntime(await settingsWith(undefined), { loaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })
    await runtime.syncAtLaunch()

    runtime.activate('amove')

    expect(fake.activate).toHaveBeenCalledTimes(1)
    expect(() => runtime.activate('not-a-feature' as never)).toThrow(TypeError)
  })

  it('disposes every feature after the shell window has been destroyed', async () => {
    const firstDispose = vi.fn(async () => {})
    const secondDispose = vi.fn(async () => {})
    const window = new FakeShellWindow()
    const host = new EmbeddedFeatureHost(window as never)
    const runtime = new FeatureRuntime(await settingsWith(undefined), {
      host,
      context: () => CONTEXT,
      loaders: {
        amove: async () => ({ feature: { id: 'amove', register: vi.fn(), dispose: firstDispose } }),
        bonded: async () => ({ feature: { id: 'bonded', register: vi.fn(), dispose: secondDispose } })
      }
    })
    await runtime.syncAtLaunch()
    runtime.setActive('amove')
    window.destroyed = true

    await runtime.disposeAll()

    expect(firstDispose).toHaveBeenCalledTimes(1)
    expect(secondDispose).toHaveBeenCalledTimes(1)
  })

  it('disposes every feature even when one disposer fails', async () => {
    const firstDispose = vi.fn(async () => { throw new Error('first cleanup failed') })
    const secondDispose = vi.fn(async () => {})
    const runtime = new FeatureRuntime(await settingsWith(undefined), {
      loaders: {
        amove: async () => ({ feature: { id: 'amove', register: vi.fn(), dispose: firstDispose, activate: vi.fn() } }),
        bonded: async () => ({ feature: { id: 'bonded', register: vi.fn(), dispose: secondDispose, activate: vi.fn() } })
      },
      context: () => CONTEXT
    })

    await runtime.syncAtLaunch()
    await runtime.disposeAll()

    expect(firstDispose).toHaveBeenCalledTimes(1)
    expect(secondDispose).toHaveBeenCalledTimes(1)
  })

  it('relaunches the suite on request', () => {
    const runtime = new FeatureRuntime(new ShellSettingsStore('/tmp/unused-moirasia-settings.json'))

    runtime.relaunch()

    expect(electron.app.relaunch).toHaveBeenCalledTimes(1)
    expect(electron.app.exit).toHaveBeenCalledWith(0)
  })

  it('falls back locally when shelf methods are missing', async () => {
    const activate = vi.fn()
    const openShelf = vi.fn(async () => {})
    const shelfFeature: MoirasiaFeature = { id: 'amove', register: vi.fn(), dispose: vi.fn(), activate, openShelf }
    const shelfRuntime = new FeatureRuntime(await settingsWith(undefined), { loaders: { amove: async () => ({ feature: shelfFeature }) }, context: () => CONTEXT })
    await shelfRuntime.syncAtLaunch()

    await shelfRuntime.toggleShelf()

    expect(openShelf).toHaveBeenCalledTimes(1)
    expect(activate).not.toHaveBeenCalled()

    const bareFeature: MoirasiaFeature = { id: 'amove', register: vi.fn(), dispose: vi.fn(), activate }
    const bareRuntime = new FeatureRuntime(await settingsWith(undefined), { loaders: { amove: async () => ({ feature: bareFeature }) }, context: () => CONTEXT })
    await bareRuntime.syncAtLaunch()

    await bareRuntime.openShelf()

    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('delegates local activation to the embedded host and rejects unloaded features', async () => {
    const window = new FakeShellWindow()
    const host = new EmbeddedFeatureHost(window as never)
    const navigated: Array<FeatureId | undefined> = []
    host.subscribeNavigation((feature) => { navigated.push(feature) })
    const feature: MoirasiaFeature = { id: 'amove', register: vi.fn(), dispose: vi.fn() }
    const runtime = new FeatureRuntime(await settingsWith(undefined), { host, loaders: { amove: async () => ({ feature }) }, context: () => CONTEXT })
    await runtime.syncAtLaunch()

    runtime.activate('amove')

    expect(navigated).toContain('amove')

    const unloadedRuntime = new FeatureRuntime(await settingsWith({ amove: false }), {
      host: new EmbeddedFeatureHost(new FakeShellWindow() as never),
      loaders: { amove: async () => ({ feature }) },
      context: () => CONTEXT
    })
    await unloadedRuntime.syncAtLaunch()

    expect(() => unloadedRuntime.activate('amove')).toThrow('Feature is not loaded. Relaunch or reinstall it.')
  })

  describe('native adapters', () => {
    function fakeNativeClient(snapshot: unknown = { features: [] }): {
      client: NativeHostClientLike
      requests: string[]
      requestCalls: Array<{ method: string; params: Record<string, unknown> | undefined }>
      unsubscribes: string[]
      emitSnapshot: (payload: unknown) => void
      emitConnection: (event: NativeHostConnectionEvent) => void
      setSnapshot: (payload: unknown) => void
      setMutationBehavior: (behavior: (method: string, params: Record<string, unknown> | undefined) => Promise<void>) => void
      failNextSnapshotRead: (error: Error) => void
      observeRequest: (observer: (method: string) => void) => void
    } {
      let currentSnapshot = snapshot
      let mutationBehavior: ((method: string, params: Record<string, unknown> | undefined) => Promise<void>) | undefined
      let nextSnapshotReadError: Error | undefined
      let requestObserver: ((method: string) => void) | undefined
      let maxRevision = isNativeHostSnapshot(snapshot) ? snapshot.revision : 0
      const requests: string[] = []
      const requestCalls: Array<{ method: string; params: Record<string, unknown> | undefined }> = []
      const unsubscribes: string[] = []
      const snapshotListeners = new Set<(payload: unknown, revision: number) => void>()
      const connectionListeners = new Set<(event: NativeHostConnectionEvent) => void>()
      const client: NativeHostClientLike = {
        connect: async () => undefined,
        close: () => undefined,
        request: async <T,>(method: string, params?: Record<string, unknown>): Promise<T> => {
          requests.push(String(method))
          requestCalls.push({ method: String(method), params })
          requestObserver?.(String(method))
          if (method === 'host.getSnapshot') {
            if (nextSnapshotReadError) {
              const error = nextSnapshotReadError
              nextSnapshotReadError = undefined
              throw error
            }
            return currentSnapshot as T
          }
          if (method === 'host.setFeatureInstalled' || method === 'host.retryFeature') {
            if (mutationBehavior) await mutationBehavior(String(method), params)
            else if (isNativeHostSnapshot(currentSnapshot)) {
              const installed = method === 'host.retryFeature' || params?.installed === true
              currentSnapshot = {
                ...currentSnapshot,
                revision: Math.max(maxRevision, currentSnapshot.revision) + 1,
                features: currentSnapshot.features.map((feature) => feature.id === 'amove'
                  ? { id: 'amove' as const, installed, state: installed ? 'running' as const : 'stopped' as const }
                  : feature)
              }
              maxRevision = (currentSnapshot as NativeHostSnapshot).revision
            }
          }
          return undefined as T
        },
        getSnapshot: async () => currentSnapshot as NativeHostSnapshot | undefined,
        subscribe: (event, listener) => {
          if (event === 'host.snapshotChanged') snapshotListeners.add(listener)
          return () => { unsubscribes.push(event); snapshotListeners.delete(listener) }
        },
        subscribeConnection: (listener) => {
          connectionListeners.add(listener)
          return () => { unsubscribes.push('host.connection'); connectionListeners.delete(listener) }
        },
        isConnected: () => true
      }
      return {
        client,
        requests,
        requestCalls,
        unsubscribes,
        emitSnapshot: (payload) => {
          currentSnapshot = payload
          if (isNativeHostSnapshot(payload)) maxRevision = Math.max(maxRevision, payload.revision)
          const revision = isNativeHostSnapshot(payload) ? payload.revision : 0
          for (const listener of snapshotListeners) listener(payload, revision)
        },
        emitConnection: (event) => { for (const listener of connectionListeners) listener(event) },
        setSnapshot: (payload) => {
          currentSnapshot = payload
          if (isNativeHostSnapshot(payload)) maxRevision = Math.max(maxRevision, payload.revision)
        },
        setMutationBehavior: (behavior) => { mutationBehavior = behavior },
        failNextSnapshotRead: (error) => { nextSnapshotReadError = error },
        observeRequest: (observer) => { requestObserver = observer }
      }
    }

    it('loads native adapters for installed features at launch instead of the legacy feature', async () => {
      const fake = fakeFeature()
      const legacyLoader = vi.fn(async () => ({ feature: fakeFeature().feature }))
      const nativeLoader = vi.fn(async () => ({ feature: fake.feature }))
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: legacyLoader }, nativeLoaders: { amove: nativeLoader }, context: () => CONTEXT, nativeClient: fakeNativeClient().client
      })

      await runtime.syncAtLaunch()

      expect(legacyLoader).not.toHaveBeenCalled()
      expect(nativeLoader).toHaveBeenCalledTimes(1)
      expect(fake.register).toHaveBeenCalledWith(CONTEXT)
      expect(runtime.statuses()[0]).toMatchObject({ id: 'amove', installed: true, loaded: true, restartPending: false })
    })

    it('keeps the adapter and releases the queue when the host mutation rejects', async () => {
      const fake = fakeFeature()
      const mutationError = new Error('native host rejected uninstall')
      const native = fakeNativeClient(nativeSnapshot(1))
      native.setMutationBehavior(async () => { throw mutationError })
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT, nativeClient: native.client
      })
      await runtime.syncAtLaunch()

      await expect(runtime.setInstalled('amove', false)).rejects.toBe(mutationError)
      await runtime.activate('amove')

      expect(native.requestCalls.filter(({ method }) => method === 'host.getSnapshot')).toHaveLength(2)
      expect(fake.dispose).not.toHaveBeenCalled()
      expect(fake.activate).toHaveBeenCalledTimes(1)
    })

    it('cleans up from a fresh snapshot when settings persistence rejects after native uninstall', async () => {
      const fake = fakeFeature()
      const mutationError = new Error('Shell settings persistence failed')
      const native = fakeNativeClient(nativeSnapshot(1))
      native.setMutationBehavior(async () => {
        native.setSnapshot(nativeSnapshot(2, { installed: false, state: 'stopped' }))
        throw mutationError
      })
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT, nativeClient: native.client
      })
      await runtime.syncAtLaunch()

      await expect(runtime.setInstalled('amove', false)).rejects.toBe(mutationError)

      expect(native.requestCalls.filter(({ method }) => method === 'host.getSnapshot')).toHaveLength(2)
      expect(fake.dispose).toHaveBeenCalledTimes(1)
      expect(runtime.statuses()[0]).toMatchObject({ installed: false, loaded: false })
    })

    it('uses a matching full event to confirm uninstall when the follow-up read fails', async () => {
      const fake = fakeFeature()
      const native = fakeNativeClient(nativeSnapshot(1))
      const snapshotError = new Error('snapshot unavailable')
      let releaseMutation!: () => void
      let signalMutationStarted!: () => void
      const mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve })
      const mutationStarted = new Promise<void>((resolve) => { signalMutationStarted = resolve })
      native.setMutationBehavior(async () => {
        signalMutationStarted()
        await mutationGate
        native.setSnapshot(nativeSnapshot(2, { installed: false, state: 'stopped' }))
      })
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT, nativeClient: native.client
      })
      let uninstalling: Promise<void> | undefined

      try {
        await runtime.syncAtLaunch()
        native.failNextSnapshotRead(snapshotError)
        uninstalling = runtime.setInstalled('amove', false)
        await mutationStarted
        native.emitSnapshot(nativeSnapshot(2, { installed: false, state: 'stopped' }))
        native.emitSnapshot({ features: [{ id: 'amove', installed: true, state: 'running' }] })
        expect(runtime.statuses()[0]).toMatchObject({ installed: false, loaded: false, loadError: expect.stringContaining('confirm') })
        releaseMutation()
        await uninstalling

        expect(fake.dispose).toHaveBeenCalledTimes(1)
        expect(runtime.statuses()[0]).toMatchObject({ installed: false, loaded: false })
        expect(runtime.statuses()[0]).not.toHaveProperty('loadError')
      } finally {
        releaseMutation()
        await uninstalling?.catch(() => undefined)
        await runtime.disposeAll()
      }
    })

    it('confirms a pending install from a full event when the follow-up read fails', async () => {
      const fake = fakeFeature()
      const native = fakeNativeClient(nativeSnapshot(1, { installed: false, state: 'stopped' }))
      const snapshotError = new Error('snapshot unavailable')
      let releaseMutation!: () => void
      let signalMutationStarted!: () => void
      const mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve })
      const mutationStarted = new Promise<void>((resolve) => { signalMutationStarted = resolve })
      native.setMutationBehavior(async () => {
        signalMutationStarted()
        await mutationGate
        native.failNextSnapshotRead(snapshotError)
      })
      const nativeLoader = vi.fn(async () => ({ feature: fake.feature }))
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: nativeLoader }, context: () => CONTEXT, nativeClient: native.client
      })
      let installing: Promise<void> | undefined

      try {
        await runtime.syncAtLaunch()
        installing = runtime.setInstalled('amove', true)
        await mutationStarted
        native.emitSnapshot(nativeSnapshot(2, { installed: true, state: 'running' }))
        releaseMutation()
        await installing

        expect(native.requestCalls.filter(({ method }) => method === 'host.getSnapshot')).toHaveLength(2)
        expect(nativeLoader).toHaveBeenCalledTimes(1)
        expect(fake.register).toHaveBeenCalledTimes(1)
        expect(runtime.statuses()[0]).toMatchObject({ installed: true, loaded: true })
      } finally {
        releaseMutation()
        await installing?.catch(() => undefined)
        await runtime.disposeAll()
      }
    })

    it('uses a confirming uninstall event after mutation rejection without a follow-up read', async () => {
      const fake = fakeFeature()
      const native = fakeNativeClient(nativeSnapshot(1))
      const mutationError = new Error('native host rejected uninstall')
      let releaseMutation!: () => void
      let signalMutationStarted!: () => void
      const mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve })
      const mutationStarted = new Promise<void>((resolve) => { signalMutationStarted = resolve })
      native.setMutationBehavior(async () => {
        signalMutationStarted()
        await mutationGate
        throw mutationError
      })
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT, nativeClient: native.client
      })
      let uninstalling: Promise<void> | undefined

      try {
        await runtime.syncAtLaunch()
        uninstalling = runtime.setInstalled('amove', false)
        await mutationStarted
        native.emitSnapshot(nativeSnapshot(2, { installed: false, state: 'stopped' }))
        releaseMutation()
        await expect(uninstalling).rejects.toBe(mutationError)

        expect(native.requestCalls.filter(({ method }) => method === 'host.getSnapshot')).toHaveLength(1)
        expect(fake.dispose).toHaveBeenCalledTimes(1)
        expect(runtime.statuses()[0]).toMatchObject({ installed: false, loaded: false })
      } finally {
        releaseMutation()
        await uninstalling?.catch(() => undefined)
        await runtime.disposeAll()
      }
    })

    it('accepts an equal-revision full snapshot with conflicting installed status', async () => {
      const native = fakeNativeClient(nativeSnapshot(1, { installed: false, state: 'stopped' }))
      const nativeLoader = vi.fn(async () => ({ feature: fakeFeature().feature }))
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: nativeLoader }, context: () => CONTEXT, nativeClient: native.client
      })
      await runtime.syncAtLaunch()

      native.emitSnapshot(nativeSnapshot(1, { installed: true, state: 'stopped' }))

      expect(runtime.statuses()[0]).toMatchObject({ installed: true, state: 'stopped', loaded: false })
      expect(nativeLoader).not.toHaveBeenCalled()
      await runtime.disposeAll()
    })

    it('keeps a successful install fenced by equal and conflicting full snapshots', async () => {
      const fake = fakeFeature()
      const native = fakeNativeClient(nativeSnapshot(1, { installed: false, state: 'stopped' }))
      let releaseMutation!: () => void
      let signalMutationStarted!: () => void
      const mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve })
      const mutationStarted = new Promise<void>((resolve) => { signalMutationStarted = resolve })
      native.setMutationBehavior(async () => {
        signalMutationStarted()
        await mutationGate
      })
      const nativeLoader = vi.fn(async () => ({ feature: fake.feature }))
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: nativeLoader }, context: () => CONTEXT, nativeClient: native.client
      })
      let installing: Promise<void> | undefined

      try {
        await runtime.syncAtLaunch()
        installing = runtime.setInstalled('amove', true)
        await mutationStarted
        native.emitSnapshot(nativeSnapshot(1, { installed: true, state: 'running' }))
        releaseMutation()
        await expect(installing).rejects.toThrow('Waiting for the native host to confirm Amove installation state.')
        expect(native.requestCalls.filter(({ method }) => method === 'host.getSnapshot')).toHaveLength(2)
        expect(nativeLoader).not.toHaveBeenCalled()

        native.emitSnapshot(nativeSnapshot(2, { installed: false, state: 'stopped' }))
        expect(nativeLoader).not.toHaveBeenCalled()
        expect(runtime.statuses()[0]).toMatchObject({ installed: true, loaded: false, loadError: expect.stringContaining('confirm') })

        native.emitSnapshot(nativeSnapshot(3, { installed: true, state: 'running' }))
        await vi.waitFor(() => expect(fake.register).toHaveBeenCalledTimes(1))
        expect(nativeLoader).toHaveBeenCalledTimes(1)
      } finally {
        releaseMutation()
        await installing?.catch(() => undefined)
        await runtime.disposeAll()
      }
    })

    it('resolves a retained rejected transition from a full read after reconnect', async () => {
      const fake = fakeFeature()
      const native = fakeNativeClient(nativeSnapshot(1))
      const mutationError = new Error('native host rejected uninstall')
      const snapshotError = new Error('snapshot unavailable')
      native.setMutationBehavior(async () => {
        native.failNextSnapshotRead(snapshotError)
        throw mutationError
      })
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT, nativeClient: native.client
      })
      await runtime.syncAtLaunch()

      await expect(runtime.setInstalled('amove', false)).rejects.toBe(mutationError)
      expect(runtime.statuses()[0]).toMatchObject({ installed: false, loaded: false, loadError: expect.stringContaining('confirm') })

      native.emitConnection({ state: 'disconnected', generation: 1, error: new Error('socket closed') })
      native.emitConnection({ state: 'reconnected', generation: 2 })
      await vi.waitFor(() => expect(runtime.statuses()[0]).toMatchObject({ installed: true, state: 'running', loaded: true }))

      expect(runtime.statuses()[0]).not.toHaveProperty('loadError')
      expect(fake.dispose).not.toHaveBeenCalled()
      expect(native.requestCalls.filter(({ method }) => method === 'host.getSnapshot')).toHaveLength(3)
      await runtime.disposeAll()
    })

    it('keeps the adapter fenced when mutation and snapshot reads both fail', async () => {
      const fake = fakeFeature()
      const native = fakeNativeClient(nativeSnapshot(1))
      const mutationError = new Error('native host rejected uninstall')
      native.setMutationBehavior(async () => { throw mutationError })
      const nativeLoader = vi.fn(async () => ({ feature: fake.feature }))
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: nativeLoader }, context: () => CONTEXT, nativeClient: native.client
      })
      await runtime.syncAtLaunch()
      native.failNextSnapshotRead(new Error('snapshot unavailable'))

      await expect(runtime.setInstalled('amove', false)).rejects.toBe(mutationError)
      expect(fake.dispose).not.toHaveBeenCalled()
      expect(runtime.statuses()[0]).toMatchObject({ installed: false, loaded: false, loadError: expect.stringContaining('confirm') })
      await expect(runtime.activate('amove')).rejects.toThrow('confirm')
      expect(nativeLoader).toHaveBeenCalledTimes(1)

      native.emitSnapshot(nativeSnapshot(2, { installed: false, state: 'stopped' }))
      await expect(runtime.activate('amove')).rejects.toThrow("Feature 'amove' is not installed.")
      expect(fake.dispose).toHaveBeenCalledTimes(1)
      expect(nativeLoader).toHaveBeenCalledTimes(1)
    })

    it('fails closed after uninstall when native snapshot confirmation fails', async () => {
      const fake = fakeFeature()
      const native = fakeNativeClient(nativeSnapshot(1))
      const snapshotError = new Error('snapshot unavailable')
      const nativeLoader = vi.fn(async () => ({ feature: fake.feature }))
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: nativeLoader }, context: () => CONTEXT, nativeClient: native.client
      })
      await runtime.syncAtLaunch()
      native.failNextSnapshotRead(snapshotError)

      await expect(runtime.setInstalled('amove', false)).rejects.toBe(snapshotError)
      expect(fake.dispose).toHaveBeenCalledTimes(1)
      expect(runtime.statuses()[0]).toMatchObject({ installed: false, loaded: false, loadError: expect.stringContaining('confirm') })
      await expect(runtime.activate('amove')).rejects.toThrow('confirm')
      await expect(runtime.openShelf()).rejects.toThrow('confirm')
      native.emitSnapshot({ features: [{ id: 'amove', installed: false, state: 'stopped' }] })
      expect(runtime.statuses()[0]).toMatchObject({ installed: false, loaded: false, loadError: expect.stringContaining('confirm') })
      native.emitSnapshot(nativeSnapshot(3))
      runtime.setActive('amove')
      expect(runtime.activeFeature).toBeUndefined()
      expect(nativeLoader).toHaveBeenCalledTimes(1)
      expect(runtime.statuses()[0]).toMatchObject({ installed: false, loaded: false, loadError: expect.stringContaining('confirm') })
      native.emitSnapshot(nativeSnapshot(2, { installed: false, state: 'stopped' }))
      expect(runtime.statuses()[0]).toMatchObject({ installed: false, loaded: false, loadError: expect.stringContaining('confirm') })
      native.emitSnapshot(nativeSnapshot(4, { installed: false, state: 'stopped' }))
      await expect(runtime.activate('amove')).rejects.toThrow("Feature 'amove' is not installed.")
      await expect(runtime.openShelf()).rejects.toThrow('Amove is not installed.')
      expect(nativeLoader).toHaveBeenCalledTimes(1)
    })

    it('fails closed after install until a newer running snapshot triggers recovery', async () => {
      const fake = fakeFeature()
      const native = fakeNativeClient(nativeSnapshot(1, { installed: false, state: 'stopped' }))
      const snapshotError = new Error('snapshot unavailable')
      const nativeLoader = vi.fn(async () => ({ feature: fake.feature }))
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: nativeLoader }, context: () => CONTEXT, nativeClient: native.client
      })
      await runtime.syncAtLaunch()
      native.failNextSnapshotRead(snapshotError)

      await expect(runtime.setInstalled('amove', true)).rejects.toBe(snapshotError)
      expect(nativeLoader).not.toHaveBeenCalled()
      expect(runtime.statuses()[0]).toMatchObject({ installed: true, loaded: false, loadError: expect.stringContaining('confirm') })
      await expect(runtime.activate('amove')).rejects.toThrow('confirm')
      expect(nativeLoader).not.toHaveBeenCalled()

      const opening = Promise.resolve(runtime.activate('amove'))
      native.emitSnapshot(nativeSnapshot(3))
      await opening

      expect(nativeLoader).toHaveBeenCalledTimes(1)
      expect(fake.register).toHaveBeenCalledTimes(1)
      expect(fake.activate).toHaveBeenCalledTimes(1)
    })

    it('acquires an installed native adapter in the current queue turn without deadlocking', async () => {
      const fake = fakeFeature()
      const nativeLoader = vi.fn(async () => ({ feature: fake.feature }))
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: nativeLoader }, context: () => CONTEXT,
        nativeClient: fakeNativeClient(nativeSnapshot(1, { installed: false, state: 'stopped' })).client
      })

      await runtime.syncAtLaunch()
      await runtime.setInstalled('amove', true)
      await runtime.activate('amove')

      expect(nativeLoader).toHaveBeenCalledTimes(1)
      expect(fake.register).toHaveBeenCalledTimes(1)
      expect(fake.activate).toHaveBeenCalledTimes(1)
      await runtime.disposeAll()
    })

    it('serializes native shelf toggles so two hotkeys open then close the shelf', async () => {
      let visible = false
      const openShelf = vi.fn(async () => { visible = true })
      const toggleShelf = vi.fn(async () => { visible = !visible })
      const feature: MoirasiaFeature = {
        id: 'amove',
        register: vi.fn(),
        dispose: vi.fn(),
        openShelf,
        toggleShelf
      }
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) },
        nativeLoaders: { amove: async () => ({ feature }) },
        context: () => CONTEXT,
        nativeClient: fakeNativeClient().client
      })

      await runtime.syncAtLaunch()
      await Promise.all([runtime.toggleShelf(), runtime.toggleShelf()])

      expect(toggleShelf).toHaveBeenCalledTimes(2)
      expect(openShelf).not.toHaveBeenCalled()
      expect(visible).toBe(false)
    })

    it('leaves features uninstalled at launch unloaded', async () => {
      const nativeLoader = vi.fn(async () => ({ feature: fakeFeature().feature }))
      const runtime = new FeatureRuntime(await settingsWith({ amove: false }), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: nativeLoader }, context: () => CONTEXT, nativeClient: fakeNativeClient().client
      })

      await runtime.syncAtLaunch()

      expect(nativeLoader).not.toHaveBeenCalled()
      expect(runtime.statuses()[0]).toMatchObject({ id: 'amove', installed: false, loaded: false })
    })

    it('reloads a native adapter when its native state reaches running after a failed first load', async () => {
      const fake = fakeFeature()
      const nativeLoader = vi.fn(async () => ({ feature: fake.feature })).mockRejectedValueOnce(new Error('feature service is starting'))
      const { client, emitSnapshot } = fakeNativeClient()
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: nativeLoader }, context: () => CONTEXT, nativeClient: client
      })
      await runtime.syncAtLaunch()
      expect(runtime.statuses()[0]).toMatchObject({ installed: true, loaded: false, loadError: 'feature service is starting' })

      emitSnapshot({ features: [{ id: 'amove', installed: true, state: 'running' }] })
      await vi.waitFor(() => { expect(fake.register).toHaveBeenCalledTimes(1) })

      expect(runtime.statuses()[0]).toMatchObject({ installed: true, loaded: true, restartPending: false })
      expect(runtime.statuses()[0]).not.toHaveProperty('loadError')
    })

    it('serializes native activation behind a running-adapter recovery', async () => {
      let releaseRegistration!: () => void
      let signalRegistrationStarted!: () => void
      const registrationGate = new Promise<void>((resolve) => { releaseRegistration = resolve })
      const registrationStarted = new Promise<void>((resolve) => { signalRegistrationStarted = resolve })
      const recoveryFeature = fakeFeature()
      recoveryFeature.register.mockImplementation(async () => {
        signalRegistrationStarted()
        await registrationGate
      })
      const activationFeature = fakeFeature()
      let loaderCalls = 0
      const nativeLoader = vi.fn(async () => {
        loaderCalls += 1
        if (loaderCalls === 1) throw new Error('feature service is starting')
        return { feature: loaderCalls === 2 ? recoveryFeature.feature : activationFeature.feature }
      })
      const { client, emitSnapshot } = fakeNativeClient({ features: [{ id: 'amove', installed: true, state: 'starting' }] })
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) },
        nativeLoaders: { amove: nativeLoader },
        context: () => CONTEXT,
        nativeClient: client
      })
      let activation: Promise<void> | undefined

      try {
        await runtime.syncAtLaunch()
        emitSnapshot({ features: [{ id: 'amove', installed: true, state: 'running' }] })
        await registrationStarted
        expect(runtime.statuses()[0]).toMatchObject({ installed: true, loaded: true })

        activation = Promise.resolve(runtime.activate('amove'))
        expect(nativeLoader).toHaveBeenCalledTimes(2)

        releaseRegistration()
        await activation
        expect(nativeLoader).toHaveBeenCalledTimes(2)
        expect(recoveryFeature.register).toHaveBeenCalledTimes(1)
        expect(recoveryFeature.activate).toHaveBeenCalledTimes(1)
        expect(activationFeature.register).not.toHaveBeenCalled()
      } finally {
        releaseRegistration()
        if (activation) await activation.catch(() => undefined)
        await runtime.disposeAll()
      }
    })

    it('retries native activation after recovery registration fails and clears the later load error', async () => {
      let rejectRegistration!: (error: Error) => void
      let signalRegistrationStarted!: () => void
      const registrationGate = new Promise<void>((_resolve, reject) => { rejectRegistration = reject })
      const registrationStarted = new Promise<void>((resolve) => { signalRegistrationStarted = resolve })
      const recoveryFeature = fakeFeature()
      recoveryFeature.register.mockImplementation(async () => {
        signalRegistrationStarted()
        await registrationGate
      })
      const retryFeature = fakeFeature()
      let loaderCalls = 0
      const nativeLoader = vi.fn(async () => {
        loaderCalls += 1
        if (loaderCalls === 1) throw new Error('feature service is starting')
        if (loaderCalls === 2) return { feature: recoveryFeature.feature }
        if (loaderCalls === 3) throw new Error('activation retry failed')
        return { feature: retryFeature.feature }
      })
      const { client, emitSnapshot } = fakeNativeClient({ features: [{ id: 'amove', installed: true, state: 'starting' }] })
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) },
        nativeLoaders: { amove: nativeLoader },
        context: () => CONTEXT,
        nativeClient: client
      })
      let activation: Promise<void> | undefined

      try {
        await runtime.syncAtLaunch()
        emitSnapshot({ features: [{ id: 'amove', installed: true, state: 'running' }] })
        await registrationStarted

        activation = Promise.resolve(runtime.activate('amove'))
        expect(nativeLoader).toHaveBeenCalledTimes(2)
        rejectRegistration(new Error('recovery registration failed'))
        await expect(activation).rejects.toThrow('activation retry failed')
        expect(nativeLoader).toHaveBeenCalledTimes(3)
        expect(runtime.statuses()[0]).toMatchObject({ loadError: 'activation retry failed' })

        await runtime.activate('amove')
        expect(nativeLoader).toHaveBeenCalledTimes(4)
        expect(retryFeature.register).toHaveBeenCalledTimes(1)
        expect(retryFeature.activate).toHaveBeenCalledTimes(1)
        expect(runtime.statuses()[0]).toMatchObject({ loaded: true })
        expect(runtime.statuses()[0]).not.toHaveProperty('loadError')
      } finally {
        rejectRegistration(new Error('test cleanup'))
        if (activation) await activation.catch(() => undefined)
        await runtime.disposeAll()
      }
    })

    it('overlays service health without losing installation and replaces it on full recovery', async () => {
      const fake = fakeFeature()
      const { client, emitSnapshot } = fakeNativeClient({ features: [{ id: 'amove', installed: true, state: 'running' }] })
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) },
        nativeLoaders: { amove: async () => ({ feature: fake.feature }) },
        context: () => CONTEXT,
        nativeClient: client
      })

      await runtime.syncAtLaunch()
      emitSnapshot({ featureService: { state: 'error', error: 'service exited', restartCount: 1 } })
      expect(runtime.statuses()[0]).toMatchObject({ installed: true, state: 'error', loadError: 'service exited', loaded: false })

      emitSnapshot({ features: [{ id: 'amove', installed: true, state: 'running' }] })
      await vi.waitFor(() => expect(runtime.statuses()[0]).toMatchObject({ installed: true, state: 'running', loaded: true }))
      expect(runtime.statuses()[0]).not.toHaveProperty('loadError')
    })

    it('rejects Open queued behind an uninstall without loading another adapter', async () => {
      const fake = fakeFeature()
      const native = fakeNativeClient(nativeSnapshot(1))
      let releaseMutation!: () => void
      let signalMutationStarted!: () => void
      const mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve })
      const mutationStarted = new Promise<void>((resolve) => { signalMutationStarted = resolve })
      native.setMutationBehavior(async () => {
        signalMutationStarted()
        await mutationGate
        native.setSnapshot(nativeSnapshot(2, { installed: false, state: 'stopped' }))
      })
      const nativeLoader = vi.fn(async () => ({ feature: fake.feature }))
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: nativeLoader }, context: () => CONTEXT, nativeClient: native.client
      })
      let uninstalling: Promise<void> | undefined
      let opening: Promise<void> | undefined

      try {
        await runtime.syncAtLaunch()
        uninstalling = runtime.setInstalled('amove', false)
        await mutationStarted
        opening = Promise.resolve(runtime.activate('amove'))
        expect(nativeLoader).toHaveBeenCalledTimes(1)
        expect(fake.activate).not.toHaveBeenCalled()

        releaseMutation()
        await uninstalling
        await expect(opening).rejects.toThrow("Feature 'amove' is not installed.")
        expect(nativeLoader).toHaveBeenCalledTimes(1)
        expect(fake.dispose).toHaveBeenCalledTimes(1)
      } finally {
        releaseMutation()
        await Promise.all([uninstalling?.catch(() => undefined), opening?.catch(() => undefined)])
        await runtime.disposeAll()
      }
    })

    it('does not run stale recovery or active-page loads after a queued uninstall', async () => {
      const initialLoadError = new Error('feature service is starting')
      const recoveryFeature = fakeFeature()
      let releaseRegistration!: () => void
      let signalRegistrationStarted!: () => void
      const registrationGate = new Promise<void>((resolve) => { releaseRegistration = resolve })
      const registrationStarted = new Promise<void>((resolve) => { signalRegistrationStarted = resolve })
      recoveryFeature.register.mockImplementation(async () => {
        signalRegistrationStarted()
        await registrationGate
      })
      const native = fakeNativeClient(nativeSnapshot(1, { installed: true, state: 'starting' }))
      let releaseMutation!: () => void
      let signalMutationStarted!: () => void
      const mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve })
      const mutationStarted = new Promise<void>((resolve) => { signalMutationStarted = resolve })
      native.setMutationBehavior(async () => {
        signalMutationStarted()
        await mutationGate
        native.setSnapshot(nativeSnapshot(4, { installed: false, state: 'stopped' }))
      })
      let loaderCalls = 0
      const nativeLoader = vi.fn(async () => {
        loaderCalls += 1
        if (loaderCalls === 1) throw initialLoadError
        return { feature: recoveryFeature.feature }
      })
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: nativeLoader }, context: () => CONTEXT, nativeClient: native.client
      })
      let uninstalling: Promise<void> | undefined
      let barrier: Promise<void> | undefined

      try {
        await runtime.syncAtLaunch()
        native.emitSnapshot(nativeSnapshot(2))
        await registrationStarted
        uninstalling = runtime.setInstalled('amove', false)
        runtime.setActive('amove')
        native.emitSnapshot(nativeSnapshot(3))
        releaseRegistration()
        await mutationStarted
        barrier = Promise.resolve(runtime.activate('amove'))
        releaseMutation()
        await uninstalling
        await expect(barrier).rejects.toThrow("Feature 'amove' is not installed.")

        expect(nativeLoader).toHaveBeenCalledTimes(2)
        expect(runtime.activeFeature).toBeUndefined()
        expect(recoveryFeature.dispose).toHaveBeenCalledTimes(1)
      } finally {
        releaseRegistration()
        releaseMutation()
        await Promise.all([uninstalling?.catch(() => undefined), barrier?.catch(() => undefined)])
        await runtime.disposeAll()
      }
    })

    it('finishes Open before starting a queued native uninstall', async () => {
      const events: string[] = []
      const fake = fakeFeature()
      fake.activate.mockImplementation(() => { events.push('activate') })
      fake.dispose.mockImplementation(async () => { events.push('dispose') })
      const native = fakeNativeClient(nativeSnapshot(1))
      native.observeRequest((method) => {
        if (method === 'host.setFeatureInstalled') events.push('uninstall-request')
        if (method === 'host.getSnapshot') events.push('snapshot')
      })
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT, nativeClient: native.client
      })
      await runtime.syncAtLaunch()
      events.length = 0

      const opening = Promise.resolve(runtime.activate('amove'))
      const uninstalling = runtime.setInstalled('amove', false)
      await Promise.all([opening, uninstalling])

      expect(events).toEqual(['activate', 'uninstall-request', 'snapshot', 'dispose'])
    })

    it('logs and swallows native adapter disposal failures after a confirmed uninstall', async () => {
      const fake = fakeFeature()
      const disposeError = new Error('adapter cleanup failed')
      fake.dispose.mockRejectedValueOnce(disposeError)
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT, nativeClient: fakeNativeClient(nativeSnapshot(1)).client
      })
      await runtime.syncAtLaunch()

      await runtime.setInstalled('amove', false)

      expect(fake.dispose).toHaveBeenCalledTimes(1)
      expect(runtime.isLoaded('amove')).toBe(false)
      expect(console.error).toHaveBeenCalledWith("Feature 'amove' failed to dispose after uninstall", disposeError)
    })

    it('reports connection loss and recovers snapshot state after reconnect', async () => {
      const fake = fakeFeature()
      const { client, emitConnection } = fakeNativeClient({ features: [{ id: 'amove', installed: true, state: 'running' }] })
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT, nativeClient: client
      })
      await runtime.syncAtLaunch()

      emitConnection({ state: 'disconnected', generation: 1, error: new Error('socket closed') })
      expect(runtime.statuses()[0]).toMatchObject({ installed: true, state: 'error', loadError: 'socket closed' })

      emitConnection({ state: 'reconnected', generation: 2 })
      await vi.waitFor(() => expect(runtime.statuses()[0]).toMatchObject({ installed: true, state: 'running', loaded: true }))
      expect(runtime.statuses()[0]).not.toHaveProperty('loadError')
    })

    it('requests host.retryFeature for an installed native feature in error state', async () => {
      const fake = fakeFeature()
      const { client, requests } = fakeNativeClient(nativeSnapshot(1, { installed: true, state: 'error', error: 'feature crashed' }))
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT, nativeClient: client
      })
      await runtime.syncAtLaunch()

      await runtime.setInstalled('amove', true)

      expect(requests.filter((method) => method !== 'host.getSnapshot')).toEqual(['host.retryFeature'])
    })

    it('issues host.setUiState with the active page and clears it to general', async () => {
      const fake = fakeFeature()
      const { client, requestCalls } = fakeNativeClient({ features: [{ id: 'amove', installed: true, state: 'running' }] })
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT, nativeClient: client
      })
      await runtime.syncAtLaunch()

      await runtime.activate('amove')
      expect(requestCalls.some(({ method, params }) => method === 'host.setUiState' && params?.page === 'amove')).toBe(true)

      runtime.setActive(undefined)
      expect(requestCalls.some(({ method, params }) => method === 'host.setUiState' && params?.page === 'general')).toBe(true)
    })

    it('clears the active feature when the host uninstalls it', async () => {
      const fake = fakeFeature()
      const { client } = fakeNativeClient(nativeSnapshot(1))
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT, nativeClient: client
      })
      await runtime.syncAtLaunch()
      await runtime.activate('amove')
      expect(runtime.activeFeature).toBe('amove')

      await runtime.setInstalled('amove', false)

      expect(runtime.activeFeature).toBeUndefined()
      expect(fake.dispose).toHaveBeenCalledTimes(1)
    })

    it('unsubscribes the native subscriptions exactly once and is idempotent', async () => {
      const fake = fakeFeature()
      const { client, unsubscribes } = fakeNativeClient({ features: [{ id: 'amove', installed: true, state: 'running' }] })
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT, nativeClient: client
      })
      await runtime.syncAtLaunch()

      await runtime.disposeAll()
      await runtime.disposeAll()

      expect(unsubscribes).toEqual(['host.snapshotChanged', 'host.connection'])
    })
  })
})
