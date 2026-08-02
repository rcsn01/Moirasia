import { describe, expect, it, vi } from 'vitest'
import { ModuleManager } from '../src/main/modules/manager'
import type {
  ModuleController,
  ModuleDefinition,
  ModuleView,
  ModuleViewHost
} from '../src/main/modules/types'
import type { ModuleId, ModuleState } from '../src/shared/contracts'

interface FakeModule {
  readonly controller: ModuleController & {
    preStop?: ReturnType<typeof vi.fn>
  }
  readonly view: ModuleView
  readonly start: ReturnType<typeof vi.fn>
  readonly activate: ReturnType<typeof vi.fn>
  readonly deactivate: ReturnType<typeof vi.fn>
  readonly stop: ReturnType<typeof vi.fn>
}

function fakeModule(id: ModuleId): FakeModule {
  const view = { id }
  const start = vi.fn(async () => view)
  const activate = vi.fn(async () => undefined)
  const deactivate = vi.fn(async () => undefined)
  const stop = vi.fn(async () => undefined)
  return {
    view,
    start,
    activate,
    deactivate,
    stop,
    controller: { id, start, activate, deactivate, stop }
  }
}

function setup(modules: readonly FakeModule[]): {
  manager: ModuleManager
  host: ModuleViewHost
  attach: ReturnType<typeof vi.fn>
  detach: ReturnType<typeof vi.fn>
} {
  const attach = vi.fn()
  const detach = vi.fn()
  const host = { attach, detach }
  const definitions: ModuleDefinition[] = modules.map(({ controller }) => ({
    id: controller.id,
    label: controller.id,
    load: vi.fn(async () => controller)
  }))
  return { manager: new ModuleManager(definitions, host), host, attach, detach }
}

describe('ModuleManager', () => {
  it('starts lazily with exact stopped → starting → running snapshots', async () => {
    const module = fakeModule('amove')
    const { manager, attach } = setup([module])
    const states: ModuleState[] = []
    manager.subscribe((snapshot) => states.push(snapshot.modules[0]!.state))

    await manager.start('amove')

    expect(states).toEqual(['stopped', 'starting', 'running'])
    expect(module.start).toHaveBeenCalledOnce()
    expect(attach).not.toHaveBeenCalled()
  })

  it('switches views without stopping the previous module', async () => {
    const amove = fakeModule('amove')
    const vox = fakeModule('vox')
    const { manager, attach, detach } = setup([amove, vox])

    await manager.activate('amove')
    await manager.activate('vox')

    expect(detach).toHaveBeenCalledWith(amove.view)
    expect(attach.mock.calls).toEqual([[amove.view], [vox.view]])
    expect(amove.deactivate).toHaveBeenCalledOnce()
    expect(amove.stop).not.toHaveBeenCalled()
    expect(manager.snapshot().modules.map(({ state }) => state)).toEqual(['running', 'running'])
    expect(manager.snapshot().activeModuleId).toBe('vox')
  })

  it('stops one active module and releases its view', async () => {
    const module = fakeModule('amove')
    const { manager, detach } = setup([module])
    await manager.activate('amove')

    const snapshot = await manager.stop('amove')

    expect(detach).toHaveBeenCalledWith(module.view)
    expect(module.stop).toHaveBeenCalledOnce()
    expect(snapshot.activeModuleId).toBeNull()
    expect(snapshot.modules[0]!.state).toBe('stopped')
  })

  it('stops all running modules in registry order', async () => {
    const calls: string[] = []
    const amove = fakeModule('amove')
    const vox = fakeModule('vox')
    amove.stop.mockImplementation(async () => { calls.push('amove') })
    vox.stop.mockImplementation(async () => { calls.push('vox') })
    const { manager } = setup([amove, vox])
    await manager.start('amove')
    await manager.activate('vox')

    await manager.stopAll()

    expect(calls).toEqual(['amove', 'vox'])
    expect(manager.snapshot().modules.every(({ state }) => state === 'stopped')).toBe(true)
  })

  it('serializes concurrent operations', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const amove = fakeModule('amove')
    const vox = fakeModule('vox')
    amove.start.mockImplementation(async () => {
      await gate
      return amove.view
    })
    const { manager } = setup([amove, vox])

    const first = manager.start('amove')
    const second = manager.start('vox')
    await vi.waitFor(() => expect(amove.start).toHaveBeenCalledOnce())
    expect(vox.start).not.toHaveBeenCalled()
    release()
    await Promise.all([first, second])

    expect(vox.start).toHaveBeenCalledOnce()
  })

  it('records failures and continues processing later queued work', async () => {
    const amove = fakeModule('amove')
    const vox = fakeModule('vox')
    amove.start.mockRejectedValueOnce(new Error('start exploded'))
    const { manager } = setup([amove, vox])

    const failed = manager.start('amove')
    const next = manager.start('vox')

    await expect(failed).rejects.toThrow('start exploded')
    await expect(next).resolves.toMatchObject({ modules: [{ state: 'failed' }, { state: 'running' }] })
    expect(manager.snapshot().modules[0]).toMatchObject({
      state: 'failed',
      error: 'start exploded'
    })
  })

  it('reports unavailable modules without invoking their loaders', async () => {
    const module = fakeModule('exithibition')
    const load = vi.fn(async () => module.controller)
    const manager = new ModuleManager([{
      id: 'exithibition',
      label: 'Exithibition',
      availability: () => ({ available: false, reason: 'Requires macOS 15 or newer' }),
      load
    }], { attach: vi.fn(), detach: vi.fn() })

    expect(manager.snapshot().modules[0]).toMatchObject({
      available: false,
      unavailableReason: 'Requires macOS 15 or newer',
      state: 'stopped'
    })
    await expect(manager.start('exithibition')).rejects.toThrow('unavailable')
    expect(load).not.toHaveBeenCalled()
    expect(manager.snapshot().modules[0]!.state).toBe('stopped')
  })

  it('marks stop failures while stopAll still attempts every module', async () => {
    const amove = fakeModule('amove')
    const vox = fakeModule('vox')
    amove.stop.mockRejectedValueOnce(new Error('cannot stop'))
    const { manager } = setup([amove, vox])
    await manager.start('amove')
    await manager.start('vox')

    await expect(manager.stopAll()).rejects.toThrow('One or more modules failed to stop')

    expect(amove.stop).toHaveBeenCalledOnce()
    expect(vox.stop).toHaveBeenCalledOnce()
    expect(manager.snapshot().modules.map(({ state }) => state)).toEqual(['failed', 'stopped'])
  })

  it('collects preStop warnings only for running modules', async () => {
    const amove = fakeModule('amove')
    const vox = fakeModule('vox')
    const preStop = vi.fn((): { moduleId: ModuleId; title: string; detail: string } | null => ({
      moduleId: 'amove',
      title: 'Quit Amove?',
      detail: 'staged shelf items'
    }))
    amove.controller.preStop = preStop
    vox.controller.preStop = vi.fn((): null => null)
    const { manager } = setup([amove, vox])
    await manager.start('amove')

    await expect(manager.stopWarnings()).resolves.toEqual([{
      moduleId: 'amove',
      title: 'Quit Amove?',
      detail: 'staged shelf items'
    }])
    expect(vox.controller.preStop).not.toHaveBeenCalled()
  })

  it('times out a hung stop and continues stopAll for later modules', async () => {
    const amove = fakeModule('amove')
    const vox = fakeModule('vox')
    amove.stop.mockImplementation(async () => {
      await new Promise(() => undefined)
    })
    const { manager } = setup([amove, vox])
    const timed = new ModuleManager(
      [
        { id: 'amove', label: 'Amove', load: async () => amove.controller },
        { id: 'vox', label: 'Vox', load: async () => vox.controller }
      ],
      { attach: vi.fn(), detach: vi.fn() },
      25
    )
    await timed.start('amove')
    await timed.start('vox')

    await expect(timed.stopAll()).rejects.toThrow('One or more modules failed to stop')
    expect(vox.stop).toHaveBeenCalledOnce()
    expect(timed.snapshot().modules.map(({ state }) => state)).toEqual(['failed', 'stopped'])
  })
})
