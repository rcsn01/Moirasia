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
import type { NativeHostClientLike, NativeHostConnectionEvent, NativeHostSnapshot } from '../src/shared/native-host-contracts'

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
    } {
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
          return (method === 'host.getSnapshot' ? snapshot : undefined) as T
        },
        getSnapshot: async () => snapshot as NativeHostSnapshot | undefined,
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
        emitSnapshot: (payload) => { for (const listener of snapshotListeners) listener(payload, 0) },
        emitConnection: (event) => { for (const listener of connectionListeners) listener(event) }
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

    it('disposes the native adapter when its feature is uninstalled', async () => {
      const fake = fakeFeature()
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT, nativeClient: fakeNativeClient().client
      })
      await runtime.syncAtLaunch()

      await runtime.setInstalled('amove', false)

      expect(fake.dispose).toHaveBeenCalledTimes(1)
      expect(runtime.isLoaded('amove')).toBe(false)
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

    it('requests host.retryFeature when reinstalling over a failed native state', async () => {
      const fake = fakeFeature()
      const { client, requests } = fakeNativeClient({ features: [{ id: 'amove', installed: true, state: 'error', error: 'feature crashed' }] })
      const runtime = new FeatureRuntime(await settingsWith(undefined), {
        loaders: { amove: vi.fn(async () => ({ feature: fakeFeature().feature })) }, nativeLoaders: { amove: async () => ({ feature: fake.feature }) }, context: () => CONTEXT, nativeClient: client
      })
      await runtime.syncAtLaunch()

      await runtime.setInstalled('amove', false)
      await runtime.setInstalled('amove', true)

      expect(requests.filter((method) => method !== 'host.getSnapshot')).toEqual(['host.setFeatureInstalled', 'host.retryFeature'])
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
      const { client } = fakeNativeClient({ features: [{ id: 'amove', installed: true, state: 'running' }] })
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
