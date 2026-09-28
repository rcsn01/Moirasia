import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppearanceRegistry } from '../packages/desktop-shell/src/main'
import { ApplicationController, type ApplicationAgent } from '../src/main/application-controller'
import type { FeatureRuntime } from '../src/main/features/runtime'
import { ShellSettingsStore } from '../src/main/settings'
import type { LoginItemControlResult } from '@moirasia/desktop-shell'
import type { ApplicationId, ApplicationStatus, ControllerSnapshot, FeatureStatus } from '../src/shared/contracts'

interface FakeRecord { id: ApplicationId; installed: boolean; running: boolean; path?: string }

const APP_RECORDS: FakeRecord[] = [
  { id: 'amove', installed: true, running: false, path: '/Applications/Amove.app' },
  { id: 'vox', installed: true, running: true, path: '/Applications/Vox.app' }
]

function controlResult(status: LoginItemControlResult['status'], appId: ApplicationId): LoginItemControlResult {
  return { protocolVersion: 1, appId, openAtLogin: status === 'enabled', status }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((res) => { resolve = res })
  return { promise, resolve }
}

/** Deterministic microtask barrier: lets already-scheduled promise continuations run without timer sleeps. */
async function drain(rounds = 6): Promise<void> { for (let index = 0; index < rounds; index += 1) await Promise.resolve() }

/** Scripted ApplicationAgent: call log, mutable records, per-call gates and entry signals, and failure/result controls. */
function makeAgent(records: FakeRecord[] = []) {
  const calls: string[] = []
  const opens: FakeRecord[] = []
  const gates = new Map<string, { promise: Promise<void>; resolve: () => void }>()
  const state: { failOpen?: Error | undefined; failSetLogin?: Error | undefined; setLoginStatus?: LoginItemControlResult['status'] | undefined; setLoginResults?: Partial<Record<string, LoginItemControlResult['status']>> } = {}
  const signals = new Map<string, { promise: Promise<void>; resolve: () => void }[]>()
  const counts = new Map<string, number>()
  let current = records
  let activeSetLoginItems = 0
  let maxSetLoginItems = 0
  const signalFor = (key: string, index: number) => {
    const list = signals.get(key) ?? []
    while (list.length <= index) list.push(deferred())
    signals.set(key, list)
    return list[index]!
  }
  const entered = (key: string): void => {
    const index = counts.get(key) ?? 0
    counts.set(key, index + 1)
    signalFor(key, index).resolve()
  }
  const agent: ApplicationAgent = {
    async snapshot() { calls.push('snapshot'); entered('snapshot'); return current },
    async open(record) {
      calls.push(`open:${record.id}`)
      opens.push(record)
      entered(`open:${record.id}`)
      if (state.failOpen) throw state.failOpen
      await gates.get(`open:${record.id}`)?.promise
      current = current.map((item) => item.id === record.id ? { ...item, running: true } : item)
    },
    async quit(record) {
      calls.push(`quit:${record.id}`)
      entered(`quit:${record.id}`)
      await gates.get(`quit:${record.id}`)?.promise
      current = current.map((item) => item.id === record.id ? { ...item, running: false } : item)
      return true
    },
    async setLoginItem(_bundlePath, id, enabled) {
      const key = `setLoginItem:${id}:${enabled ? 'on' : 'off'}`
      calls.push(key)
      activeSetLoginItems += 1
      maxSetLoginItems = Math.max(maxSetLoginItems, activeSetLoginItems)
      entered(key)
      try {
        if (state.failSetLogin) throw state.failSetLogin
        await gates.get(key)?.promise
        const status = state.setLoginResults?.[`${id}:${enabled ? 'on' : 'off'}`] ?? state.setLoginStatus ?? (enabled ? 'enabled' : 'disabled')
        return controlResult(status, id)
      } finally { activeSetLoginItems -= 1 }
    },
    async openLoginItemsSettings() { calls.push('openLoginItemsSettings') }
  }
  return {
    agent, calls, opens, gates, state,
    setRecords: (next: FakeRecord[]) => { current = next },
    entry: (key: string, occurrence = 1): Promise<void> => signalFor(key, occurrence - 1).promise,
    activeSetLoginItems: (): number => activeSetLoginItems,
    maxSetLoginItems: (): number => maxSetLoginItems
  }
}

/** Structural FeatureRuntime fake: the controller touches only subscribe/statuses/setActive/activate/setInstalled/relaunch. */
function makeFeatures(statuses: FeatureStatus[] = []) {
  const listeners = new Set<() => void>()
  const calls: string[] = []
  let current = statuses
  const raw = {
    calls,
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
    statuses(): readonly FeatureStatus[] { return current },
    setActive(id: ApplicationId | undefined) { calls.push(`setActive:${String(id)}`) },
    activate(id: ApplicationId): void | Promise<void> { calls.push(`activate:${String(id)}`) },
    async setInstalled(id: ApplicationId, installed: boolean) { calls.push(`setInstalled:${String(id)}:${String(installed)}`) },
    relaunch() { calls.push('relaunch') },
    set(next: FeatureStatus[]) { current = next },
    emit() { for (const listener of listeners) listener() }
  }
  return { features: raw as unknown as FeatureRuntime, raw }
}

async function makeController(options: { records?: FakeRecord[]; features?: FeatureStatus[] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'moirasia-controller-'))
  directories.push(directory)
  const settings = new ShellSettingsStore(join(directory, 'settings.json'))
  await settings.load()
  const appearances = new AppearanceRegistry(join(directory, 'appearance.json'))
  const agent = makeAgent(options.records)
  const features = makeFeatures(options.features)
  const controller = new ApplicationController(appearances, settings, features.features, agent.agent)
  return { controller, settings, agent, features }
}

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe('ApplicationController', () => {
  it('rebuilds statuses from agent records under catalog facts and preserves a prior loginItem', async () => {
    const { controller, settings, agent } = await makeController({ records: APP_RECORDS })
    await controller.refresh()
    await settings.update({ pendingLoginItems: { amove: true } })
    const afterLogin = await controller.setLoginItem('amove', true)
    expect(afterLogin.applications.find(({ id }) => id === 'amove')?.loginItem?.status).toBe('enabled')

    agent.setRecords([{ id: 'amove', installed: true, running: true, path: '/Applications/Amove.app' }])
    const snapshot = await controller.refresh()
    expect(snapshot.applications).toHaveLength(4)
    const amove = snapshot.applications.find(({ id }) => id === 'amove')!
    expect(amove).toMatchObject({ id: 'amove', label: 'Amove', bundleId: 'com.opense.Amove', installed: true, running: true, path: '/Applications/Amove.app' })
    expect(amove.loginItem?.status).toBe('enabled')
    const shout = snapshot.applications.find(({ id }) => id === 'shout')!
    expect(shout).toMatchObject({ label: 'Shout', bundleId: 'com.opense.Shout', installed: false, running: false })
  })

  it('hands out an isolated clone from snapshot(): mutating a returned snapshot does not affect the next one', async () => {
    const { controller } = await makeController({ records: APP_RECORDS })
    const first = controller.snapshot()
    ;(first.applications as ApplicationStatus[]).push({ id: 'bonded', label: 'Bonded', bundleId: 'com.opense.Bonded', installed: true, running: true })
    ;(first.applications[0] as { running: boolean }).running = true
    const second = controller.snapshot()
    expect(second.applications).toHaveLength(4)
    expect(second.applications.find(({ id }) => id === 'amove')?.running).toBe(false)
    expect(second.applications.find(({ id }) => id === 'bonded')?.installed).toBe(false)
  })

  it('sends the agent the current record and returns the refreshed snapshot', async () => {
    const { controller, agent } = await makeController({ records: APP_RECORDS })
    await controller.refresh()
    const snapshot = await controller.open('amove')
    expect(agent.calls).toEqual(['snapshot', 'open:amove', 'snapshot'])
    expect(agent.opens[0]).toEqual({ id: 'amove', installed: true, running: false, path: '/Applications/Amove.app' })
    expect(snapshot.applications.find(({ id }) => id === 'amove')?.running).toBe(true)
  })

  it('records a failing open on the status and clears it on the next successful command', async () => {
    const { controller, agent } = await makeController({ records: APP_RECORDS })
    await controller.refresh()
    agent.state.failOpen = new Error('agent refused')
    await expect(controller.open('amove')).rejects.toThrow('agent refused')
    expect(controller.snapshot().applications.find(({ id }) => id === 'amove')?.error).toBe('agent refused')
    agent.state.failOpen = undefined
    const snapshot = await controller.open('amove')
    expect(snapshot.applications.find(({ id }) => id === 'amove')?.error).toBeUndefined()
    expect(snapshot.applications.find(({ id }) => id === 'amove')?.running).toBe(true)
  })

  it('throws the label message without touching the agent or recording an error for a not-installed application', async () => {
    const { controller, agent } = await makeController()
    await expect(controller.open('amove')).rejects.toThrow('Amove is not installed.')
    expect(agent.calls).toEqual([])
    expect(controller.snapshot().applications.find(({ id }) => id === 'amove')?.error).toBeUndefined()
  })

  it('returns a rejected feature activation promise', async () => {
    const { controller, features } = await makeController()
    const failure = new Error('native activation failed')
    const activation = Promise.reject(failure)
    void activation.catch(() => undefined)
    features.raw.activate = vi.fn(() => activation)

    const result: unknown = controller.openFeature('amove')

    expect(result).toBeInstanceOf(Promise)
    if (!(result instanceof Promise)) return
    await expect(result).rejects.toBe(failure)
  })

  it('converts a synchronous feature activation throw into a rejected promise', async () => {
    const { controller, features } = await makeController()
    const failure = new Error('local activation failed')
    features.raw.activate = vi.fn(() => { throw failure })
    let result: unknown
    let thrown: unknown

    try { result = controller.openFeature('amove') }
    catch (error) { thrown = error }

    expect(thrown).toBeUndefined()
    expect(result).toBeInstanceOf(Promise)
    if (!(result instanceof Promise)) return
    await expect(result).rejects.toBe(failure)
  })

  it('serializes commands on the same application in call order', async () => {
    const { controller, agent } = await makeController({ records: APP_RECORDS })
    await controller.refresh()
    const gate = deferred()
    agent.gates.set('open:amove', gate)
    const first = controller.open('amove')
    const second = controller.quit('amove')
    await agent.entry('open:amove')
    await drain()
    expect(agent.calls).toEqual(['snapshot', 'open:amove'])
    gate.resolve()
    const afterOpen = await first
    expect(afterOpen.applications.find(({ id }) => id === 'amove')?.running).toBe(true)
    const afterQuit = await second
    expect(afterQuit.applications.find(({ id }) => id === 'amove')?.running).toBe(false)
    expect(agent.calls.indexOf('open:amove')).toBeLessThan(agent.calls.indexOf('quit:amove'))
  })

  it('runs commands on different applications concurrently (no global serialization)', async () => {
    const { controller, agent } = await makeController({ records: APP_RECORDS })
    await controller.refresh()
    const gate = deferred()
    agent.gates.set('open:amove', gate)
    const first = controller.open('amove')
    const second = controller.quit('vox')
    await agent.entry('quit:vox')
    expect(agent.calls).toContain('quit:vox')
    gate.resolve()
    const [afterOpen, afterQuit] = await Promise.all([first, second])
    expect(afterOpen.applications.find(({ id }) => id === 'amove')?.running).toBe(true)
    expect(afterQuit.applications.find(({ id }) => id === 'vox')?.running).toBe(false)
  })

  it('routes setLoginItem through the queue, stores the result, and clears the pending flag on enabled results', async () => {
    const { controller, settings, agent } = await makeController({ records: APP_RECORDS })
    await controller.refresh()
    await settings.update({ pendingLoginItems: { amove: true } })
    const snapshot = await controller.setLoginItem('amove', true)
    expect(agent.calls).toContain('setLoginItem:amove:on')
    expect(snapshot.applications.find(({ id }) => id === 'amove')?.loginItem).toMatchObject({ status: 'enabled', appId: 'amove' })
    expect(settings.get().pendingLoginItems).toEqual({})
  })

  it('records a failing setLoginItem and keeps the pending item', async () => {
    const { controller, settings, agent } = await makeController({ records: APP_RECORDS })
    await controller.refresh()
    await settings.update({ pendingLoginItems: { amove: true } })
    agent.state.failSetLogin = new Error('control failed')
    await expect(controller.setLoginItem('amove', true)).rejects.toThrow('control failed')
    expect(controller.snapshot().applications.find(({ id }) => id === 'amove')?.error).toBe('control failed')
    expect(settings.get().pendingLoginItems).toEqual({ amove: true })
  })

  it('retries pending login items through the agent on refresh and clears the pending flag on an enabled result', async () => {
    const { controller, settings, agent } = await makeController({ records: APP_RECORDS })
    await settings.update({ pendingLoginItems: { vox: true } })
    const snapshot = await controller.refresh()
    expect(agent.calls).toContain('setLoginItem:vox:on')
    expect(snapshot.applications.find(({ id }) => id === 'vox')?.loginItem).toMatchObject({ status: 'enabled', appId: 'vox' })
    expect(settings.get().pendingLoginItems).toEqual({})
  })

  it('keeps a failing retry pending and silent, then retries on the next refresh', async () => {
    const { controller, settings, agent } = await makeController({ records: APP_RECORDS })
    await settings.update({ pendingLoginItems: { vox: true } })
    agent.state.failSetLogin = new Error('control failed')
    const first = await controller.refresh()
    expect(agent.calls).toContain('setLoginItem:vox:on')
    expect(settings.get().pendingLoginItems).toEqual({ vox: true })
    expect(first.applications.find(({ id }) => id === 'vox')?.error).toBeUndefined()

    agent.state.failSetLogin = undefined
    const second = await controller.refresh()
    expect(agent.calls.filter((call) => call === 'setLoginItem:vox:on')).toHaveLength(2)
    expect(second.applications.find(({ id }) => id === 'vox')?.loginItem?.status).toBe('enabled')
    expect(settings.get().pendingLoginItems).toEqual({})
  })

  it('runs a pending retry ahead of a later explicit change for the same application', async () => {
    const { controller, settings, agent } = await makeController({ records: APP_RECORDS })
    await controller.refresh()
    await settings.update({ pendingLoginItems: { amove: true } })
    const retryGate = deferred()
    agent.gates.set('setLoginItem:amove:on', retryGate)
    agent.state.setLoginResults = { 'amove:on': 'requires-approval' }

    const refreshing = controller.refresh()
    await agent.entry('setLoginItem:amove:on')
    const explicit = controller.setLoginItem('amove', false)
    await drain()
    const callsWhileGated = [...agent.calls]
    const activeWhileGated = agent.activeSetLoginItems()

    retryGate.resolve()
    await refreshing
    const afterExplicit = await explicit
    expect(callsWhileGated).toEqual(['snapshot', 'snapshot', 'setLoginItem:amove:on'])
    expect(activeWhileGated).toBe(1)
    expect(agent.calls).toEqual(['snapshot', 'snapshot', 'setLoginItem:amove:on', 'setLoginItem:amove:off', 'snapshot'])
    expect(agent.maxSetLoginItems()).toBe(1)
    expect(afterExplicit.applications.find(({ id }) => id === 'amove')?.loginItem?.status).toBe('disabled')
    expect(settings.get().pendingLoginItems).toEqual({})
  })

  it('skips a queued retry when an explicit change clears the pending flag first', async () => {
    const { controller, settings, agent } = await makeController({ records: APP_RECORDS })
    await controller.refresh()
    await settings.update({ pendingLoginItems: { amove: true } })
    const explicitGate = deferred()
    agent.gates.set('setLoginItem:amove:off', explicitGate)
    agent.state.setLoginResults = { 'amove:on': 'requires-approval' }

    const explicit = controller.setLoginItem('amove', false)
    await agent.entry('setLoginItem:amove:off')
    const refreshing = controller.refresh()
    await agent.entry('snapshot', 2)
    await drain()
    explicitGate.resolve()

    const afterExplicit = await explicit
    await refreshing
    expect(agent.calls).toEqual(['snapshot', 'setLoginItem:amove:off', 'snapshot', 'snapshot'])
    expect(afterExplicit.applications.find(({ id }) => id === 'amove')?.loginItem?.status).toBe('disabled')
    expect(settings.get().pendingLoginItems).toEqual({})
  })

  it('shares one pending retry across overlapping refreshes', async () => {
    const { controller, settings, agent } = await makeController({ records: APP_RECORDS })
    await controller.refresh()
    await settings.update({ pendingLoginItems: { amove: true } })
    const retryGate = deferred()
    agent.gates.set('setLoginItem:amove:on', retryGate)

    const first = controller.refresh()
    await agent.entry('setLoginItem:amove:on')
    const second = controller.refresh()
    await agent.entry('snapshot', 2)
    await drain()
    retryGate.resolve()

    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second])
    expect(agent.calls.filter((call) => call === 'setLoginItem:amove:on')).toHaveLength(1)
    expect(agent.maxSetLoginItems()).toBe(1)
    expect(firstSnapshot.applications.find(({ id }) => id === 'amove')?.loginItem?.status).toBe('enabled')
    expect(secondSnapshot.applications.find(({ id }) => id === 'amove')?.loginItem?.status).toBe('enabled')
    expect(settings.get().pendingLoginItems).toEqual({})
  })

  it('skips a queued retry when the application is no longer installed when its turn starts', async () => {
    const { controller, settings, agent } = await makeController({ records: APP_RECORDS })
    await controller.refresh()
    await settings.update({ pendingLoginItems: { amove: true } })
    const openGate = deferred()
    agent.gates.set('open:amove', openGate)

    const opening = controller.open('amove')
    await agent.entry('open:amove')
    const refreshing = controller.refresh()
    await agent.entry('snapshot', 2)
    await drain()
    agent.setRecords([{ id: 'vox', installed: true, running: true, path: '/Applications/Vox.app' }])
    openGate.resolve()

    await opening
    await refreshing
    expect(agent.calls).toEqual(['snapshot', 'open:amove', 'snapshot', 'snapshot'])
    expect(settings.get().pendingLoginItems).toEqual({ amove: true })
  })

  it('skips a pending retry for an installed application without a path', async () => {
    const { controller, settings, agent } = await makeController({ records: [{ id: 'vox', installed: true, running: false }] })
    await settings.update({ pendingLoginItems: { vox: true } })

    const snapshot = await controller.refresh()
    expect(agent.calls).toEqual(['snapshot'])
    expect(settings.get().pendingLoginItems).toEqual({ vox: true })
    expect(snapshot.applications.find(({ id }) => id === 'vox')?.loginItem).toBeUndefined()
  })

  it('keeps a pending retry for a non-enabled login-item result', async () => {
    const { controller, settings, agent } = await makeController({ records: APP_RECORDS })
    await settings.update({ pendingLoginItems: { vox: true } })
    agent.state.setLoginStatus = 'requires-approval'

    const snapshot = await controller.refresh()
    expect(snapshot.applications.find(({ id }) => id === 'vox')?.loginItem).toMatchObject({ status: 'requires-approval', appId: 'vox' })
    expect(settings.get().pendingLoginItems).toEqual({ vox: true })
    expect(snapshot.applications.find(({ id }) => id === 'vox')?.error).toBeUndefined()
  })

  it('does not run pending retries from an action-final snapshot reconciliation', async () => {
    const { controller, settings, agent } = await makeController({ records: APP_RECORDS })
    await controller.refresh()
    await settings.update({ pendingLoginItems: { amove: true, vox: true } })
    agent.state.failSetLogin = new Error('control failed')

    await expect(controller.setLoginItem('amove', false)).rejects.toThrow('control failed')
    expect(agent.calls).toEqual(['snapshot', 'setLoginItem:amove:off', 'snapshot'])
    expect(settings.get().pendingLoginItems).toEqual({ amove: true, vox: true })

    agent.state.failSetLogin = undefined
    const snapshot = await controller.refresh()
    expect(agent.calls).toEqual(['snapshot', 'setLoginItem:amove:off', 'snapshot', 'snapshot', 'setLoginItem:amove:on', 'setLoginItem:vox:on'])
    expect(snapshot.applications.find(({ id }) => id === 'amove')?.loginItem?.status).toBe('enabled')
    expect(snapshot.applications.find(({ id }) => id === 'vox')?.loginItem?.status).toBe('enabled')
    expect(settings.get().pendingLoginItems).toEqual({})
  })

  it('fans feature-status changes out to subscribers and gates restorable pages on installed-and-loaded features', async () => {
    const { controller, features } = await makeController({ records: APP_RECORDS })
    const seen: ControllerSnapshot[] = []
    controller.subscribe((snapshot) => seen.push(snapshot))
    features.raw.set([{ id: 'amove', installed: false, loaded: false, restartPending: false }])
    features.raw.emit()
    expect(seen).toHaveLength(1)
    expect(seen[0]?.features).toEqual([{ id: 'amove', installed: false, loaded: false, restartPending: false }])

    controller.reportPage('amove')
    expect(features.raw.calls).toContain('setActive:amove')
    expect(controller.restorablePage()).toBe('general')
    features.raw.set([{ id: 'amove', installed: true, loaded: true, restartPending: false }])
    expect(controller.restorablePage()).toBe('amove')
    controller.reportPage('features')
    expect(controller.restorablePage()).toBe('features')
    expect(features.raw.calls).toContain('setActive:undefined')
  })
})