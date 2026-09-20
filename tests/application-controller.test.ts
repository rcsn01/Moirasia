import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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

/** Scripted ApplicationAgent: call log, mutable snapshot records, optional per-call gates, and fail switches. */
function makeAgent(records: FakeRecord[] = []) {
  const calls: string[] = []
  const opens: FakeRecord[] = []
  const gates = new Map<string, { promise: Promise<void>; resolve: () => void }>()
  const state: { failOpen?: Error | undefined; failSetLogin?: Error | undefined } = {}
  let current = records
  const agent: ApplicationAgent = {
    async snapshot() { calls.push('snapshot'); return current },
    async open(record) {
      calls.push(`open:${record.id}`)
      opens.push(record)
      if (state.failOpen) throw state.failOpen
      await gates.get(`open:${record.id}`)?.promise
      current = current.map((item) => item.id === record.id ? { ...item, running: true } : item)
    },
    async quit(record) {
      calls.push(`quit:${record.id}`)
      await gates.get(`quit:${record.id}`)?.promise
      current = current.map((item) => item.id === record.id ? { ...item, running: false } : item)
      return true
    },
    async setLoginItem(_bundlePath, id, enabled) {
      calls.push(`setLoginItem:${id}:${enabled ? 'on' : 'off'}`)
      if (state.failSetLogin) throw state.failSetLogin
      return controlResult(enabled ? 'enabled' : 'disabled', id)
    },
    async openLoginItemsSettings() { calls.push('openLoginItemsSettings') }
  }
  return { agent, calls, opens, gates, state, setRecords: (next: FakeRecord[]) => { current = next } }
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
    activate(id: ApplicationId) { calls.push(`activate:${String(id)}`) },
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

  it('serializes commands on the same application in call order', async () => {
    const { controller, agent } = await makeController({ records: APP_RECORDS })
    await controller.refresh()
    const gate = deferred()
    agent.gates.set('open:amove', gate)
    const first = controller.open('amove')
    const second = controller.quit('amove')
    await new Promise((resolve) => setTimeout(resolve, 0))
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
    await new Promise((resolve) => setTimeout(resolve, 0))
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

  it('keeps a failing retry pending and stays silent', async () => {
    const { controller, settings, agent } = await makeController({ records: APP_RECORDS })
    await settings.update({ pendingLoginItems: { vox: true } })
    agent.state.failSetLogin = new Error('control failed')
    const snapshot = await controller.refresh()
    expect(agent.calls).toContain('setLoginItem:vox:on')
    expect(settings.get().pendingLoginItems).toEqual({ vox: true })
    expect(snapshot.applications.find(({ id }) => id === 'vox')?.error).toBeUndefined()
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