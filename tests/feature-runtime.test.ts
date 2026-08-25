import { EventEmitter } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureContext, MoirasiaFeature } from '../packages/desktop-shell/src/feature'

const electron = vi.hoisted(() => ({ app: { relaunch: vi.fn(), exit: vi.fn((code?: number) => code) } }))
vi.mock('electron', () => electron)

import { EmbeddedFeatureHost } from '../src/main/features/embedded-host'
import { FeatureRuntime } from '../src/main/features/runtime'
import { ShellSettingsStore } from '../src/main/settings'

class FakeShellWindow extends EventEmitter {
  webContents = {}
  destroyed = false
  isDestroyed(): boolean { return this.destroyed }
  isFocused(): boolean { return false }
  show(): void {}
  focus(): void {}
}

const CONTEXT: FeatureContext = {
  id: 'exithibition', mode: 'suite', productId: 'exithibition',
  surface: { webContents: {} as never, state: { active: false, focused: false }, activate: () => undefined, focus: () => undefined, subscribe: () => () => undefined },
  paths: { preload: '/tmp/feature.cjs', rendererFile: '/tmp/feature.html', nativeExecutable: '/tmp/ExithibitionNative' }
}

function fakeFeature(): { feature: MoirasiaFeature; register: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; activate: ReturnType<typeof vi.fn> } {
  const register = vi.fn(async (_ctx: FeatureContext) => {}), dispose = vi.fn(async () => {}), activate = vi.fn()
  return { feature: { id: 'exithibition', register, dispose, activate }, register, dispose, activate }
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
    const runtime = new FeatureRuntime(await settingsWith({ exithibition: false }), { loaders: { exithibition: loader }, context: () => CONTEXT })

    await runtime.syncAtLaunch()

    expect(loader).not.toHaveBeenCalled()
    expect(runtime.statuses()).toEqual([{ id: 'exithibition', installed: false, loaded: false, restartPending: false }])
  })

  it('registers installed features at launch with the suite context', async () => {
    const fake = fakeFeature()
    const runtime = new FeatureRuntime(await settingsWith(undefined), { loaders: { exithibition: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })

    await runtime.syncAtLaunch()

    expect(fake.register).toHaveBeenCalledTimes(1)
    expect(fake.register).toHaveBeenCalledWith(CONTEXT)
    expect(runtime.statuses()).toEqual([{ id: 'exithibition', installed: true, loaded: true, restartPending: false }])
  })

  it('installs mid-session once and treats repeated installs as no-ops', async () => {
    const fake = fakeFeature()
    const loader = vi.fn(async () => ({ feature: fake.feature }))
    const settings = await settingsWith({ exithibition: false })
    const runtime = new FeatureRuntime(settings, { loaders: { exithibition: loader }, context: () => CONTEXT })
    await runtime.syncAtLaunch()

    await runtime.setInstalled('exithibition', true)
    await runtime.setInstalled('exithibition', true)

    expect(loader).toHaveBeenCalledTimes(1)
    expect(fake.register).toHaveBeenCalledTimes(1)
    expect(settings.get().features.exithibition).toBe(true)
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
    const feature: MoirasiaFeature = { id: 'exithibition', register, dispose, activate: vi.fn() }
    const settings = await settingsWith({ exithibition: false })
    const runtime = new FeatureRuntime(settings, { loaders: { exithibition: async () => ({ feature }) }, context: () => CONTEXT })

    const installing = runtime.setInstalled('exithibition', true)
    await started
    const uninstalling = runtime.setInstalled('exithibition', false)
    release()
    await Promise.all([installing, uninstalling])

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(runtime.statuses()[0]).toMatchObject({ installed: false, loaded: true, restartPending: true })
  })

  it('disposes exactly once on mid-session uninstall and flags the restart', async () => {
    const fake = fakeFeature()
    const settings = await settingsWith(undefined)
    const runtime = new FeatureRuntime(settings, { loaders: { exithibition: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })
    await runtime.syncAtLaunch()

    await runtime.setInstalled('exithibition', false)
    await runtime.setInstalled('exithibition', false)

    expect(fake.dispose).toHaveBeenCalledTimes(1)
    expect(settings.get().features.exithibition).toBe(false)
    expect(runtime.statuses()).toEqual([{ id: 'exithibition', installed: false, loaded: true, restartPending: true }])
  })

  it('does not flag a restart when the feature was never loaded this session', async () => {
    const fake = fakeFeature()
    const runtime = new FeatureRuntime(await settingsWith({ exithibition: false }), { loaders: { exithibition: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })
    await runtime.syncAtLaunch()

    await runtime.setInstalled('exithibition', false)

    expect(fake.dispose).not.toHaveBeenCalled()
    expect(runtime.statuses()[0]).toMatchObject({ installed: false, loaded: false, restartPending: false })
  })

  it('re-registers a fresh controller when reinstalled after teardown', async () => {
    const fake = fakeFeature()
    const runtime = new FeatureRuntime(await settingsWith(undefined), { loaders: { exithibition: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })
    await runtime.syncAtLaunch()
    await runtime.setInstalled('exithibition', false)

    await runtime.setInstalled('exithibition', true)

    expect(fake.register).toHaveBeenCalledTimes(2)
    expect(runtime.statuses()[0]).toMatchObject({ installed: true, loaded: true, restartPending: false })
  })

  it('disposes every loaded feature exactly once and is idempotent', async () => {
    const fake = fakeFeature()
    const runtime = new FeatureRuntime(await settingsWith(undefined), { loaders: { exithibition: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })
    await runtime.syncAtLaunch()

    await runtime.disposeAll()
    await runtime.disposeAll()

    expect(fake.dispose).toHaveBeenCalledTimes(1)
  })

  it('cleans up and stays unloaded when register fails', async () => {
    const fake = fakeFeature()
    fake.register.mockRejectedValueOnce(new Error('native helper missing'))
    const runtime = new FeatureRuntime(await settingsWith(undefined), { loaders: { exithibition: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })

    await runtime.syncAtLaunch()

    expect(fake.dispose).toHaveBeenCalledTimes(1)
    expect(runtime.statuses()[0]).toMatchObject({ installed: true, loaded: false })
    expect(() => runtime.activate('exithibition')).toThrow(/not running/)
  })

  it('activates a running feature and rejects foreign application ids', async () => {
    const fake = fakeFeature()
    const runtime = new FeatureRuntime(await settingsWith(undefined), { loaders: { exithibition: async () => ({ feature: fake.feature }) }, context: () => CONTEXT })
    await runtime.syncAtLaunch()

    runtime.activate('exithibition')

    expect(fake.activate).toHaveBeenCalledTimes(1)
    expect(() => runtime.activate('vox')).toThrow(TypeError)
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
        exithibition: async () => ({ feature: { id: 'exithibition', register: vi.fn(), dispose: secondDispose } })
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
        exithibition: async () => ({ feature: { id: 'exithibition', register: vi.fn(), dispose: secondDispose, activate: vi.fn() } })
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
})
