import { execFile as execFileCallback } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { AppearanceRegistry, type Appearance, type LoginItemControlResult, type ProductId } from '@moirasia/desktop-shell/main'
import { APPLICATION_IDS, type ApplicationId, type ApplicationStatus, type ControllerSnapshot } from '../shared/contracts'
import type { ShellSettingsStore } from './settings'

const execFile = promisify(execFileCallback)
const CATALOG: Readonly<Record<ApplicationId, { label: string; bundleId: string }>> = {
  amove: { label: 'Amove', bundleId: 'com.opense.Amove' }, vox: { label: 'Vox', bundleId: 'com.moirasia.vox' }, exithibition: { label: 'Exithibition', bundleId: 'com.local.Exithibition' }
}

interface AgentRecord { id: ApplicationId; installed: boolean; running: boolean; path?: string }
export interface ApplicationAgent { snapshot(): Promise<readonly AgentRecord[]>; open(record: AgentRecord): Promise<void>; quit(record: AgentRecord): Promise<boolean>; openLoginItemsSettings(): Promise<void> }

export class ApplicationController {
  #applications: ApplicationStatus[] = APPLICATION_IDS.map((id) => ({ id, ...CATALOG[id], installed: false, running: false }))
  #listeners = new Set<(snapshot: ControllerSnapshot) => void>()
  #busy = new Map<ApplicationId, ApplicationStatus['busy']>()
  #errors = new Map<ApplicationId, string>()
  constructor(readonly appearances: AppearanceRegistry, private readonly settings: ShellSettingsStore, private readonly agent: ApplicationAgent = new SwiftApplicationAgent()) {}

  snapshot(): ControllerSnapshot { return { applications: structuredClone(this.#applications), appearances: this.appearances.get() } }
  subscribe(listener: (snapshot: ControllerSnapshot) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
  async refresh(): Promise<ControllerSnapshot> {
    const records = await this.agent.snapshot()
    this.#applications = APPLICATION_IDS.map((id) => { const record = records.find((item) => item.id === id); const prior = this.#applications.find((item) => item.id === id); const busy = this.#busy.get(id); const error = this.#errors.get(id); return { id, ...CATALOG[id], installed: record?.installed ?? false, running: record?.running ?? false, ...(record?.path ? { path: record.path } : {}), ...(prior?.loginItem ? { loginItem: prior.loginItem } : {}), ...(busy !== undefined ? { busy } : {}), ...(error !== undefined ? { error } : {}) } })
    await this.#retryPending(); this.#emit(); return this.snapshot()
  }
  async open(id: ApplicationId): Promise<ControllerSnapshot> { return this.#action(id, 'opening', async (record) => { await this.agent.open(record) }) }
  async quit(id: ApplicationId): Promise<ControllerSnapshot> { return this.#action(id, 'quitting', async (record) => { if (!await this.agent.quit(record)) throw new Error(`${CATALOG[id].label} did not quit within 10 seconds.`) }) }
  async setAppearance(product: ProductId, appearance: Appearance): Promise<ControllerSnapshot> { await this.appearances.set(product, appearance); this.#emit(); return this.snapshot() }
  async setAllAppearances(appearance: Appearance): Promise<ControllerSnapshot> { await this.appearances.setAll(appearance); this.#emit(); return this.snapshot() }
  async setLoginItem(id: ApplicationId, enabled: boolean): Promise<ControllerSnapshot> {
    const status = this.#applications.find((item) => item.id === id)
    if (!status?.installed || !status.path) throw new Error(`${CATALOG[id].label} is not installed.`)
    this.#busy.set(id, 'login-item'); this.#emit()
    try {
      const result = await invokeLoginControl(status.path, id, enabled ? 'login-item:set:on' : 'login-item:set:off')
      this.#applications = this.#applications.map((item) => item.id === id ? { ...item, loginItem: result } : item)
      if (result.status === 'enabled' || result.status === 'disabled') await this.settings.clearPending(id)
      this.#errors.delete(id)
    } catch (error) { this.#errors.set(id, message(error)); throw error }
    finally { this.#busy.delete(id); this.#emit() }
    return this.snapshot()
  }
  openLoginItemsSettings(): Promise<void> { return this.agent.openLoginItemsSettings() }
  close(): void { this.appearances.close() }

  async #action(id: ApplicationId, busy: NonNullable<ApplicationStatus['busy']>, operation: (record: AgentRecord) => Promise<void>): Promise<ControllerSnapshot> {
    const current = this.#applications.find((item) => item.id === id)
    if (!current?.installed) throw new Error(`${CATALOG[id].label} is not installed.`)
    this.#busy.set(id, busy); this.#errors.delete(id); this.#emit()
    try { await operation({ id, installed: current.installed, running: current.running, ...(current.path ? { path: current.path } : {}) }) }
    catch (error) { this.#errors.set(id, message(error)); throw error }
    finally { this.#busy.delete(id); await this.refresh() }
    return this.snapshot()
  }
  async #retryPending(): Promise<void> {
    for (const id of APPLICATION_IDS) {
      if (!this.settings.get().pendingLoginItems[id]) continue
      const status = this.#applications.find((item) => item.id === id)
      if (!status?.installed || !status.path) continue
      try { const result = await invokeLoginControl(status.path, id, 'login-item:set:on'); this.#applications = this.#applications.map((item) => item.id === id ? { ...item, loginItem: result } : item); if (result.status === 'enabled') await this.settings.clearPending(id) } catch { /* retry on next refresh */ }
    }
  }
  #emit(): void { const snapshot = this.snapshot(); for (const listener of this.#listeners) listener(snapshot) }
}

class SwiftApplicationAgent implements ApplicationAgent {
  private readonly executable = join(process.resourcesPath, 'application-agent')
  async snapshot(): Promise<readonly AgentRecord[]> {
    if (process.platform !== 'darwin' || !existsSync(this.executable)) return APPLICATION_IDS.map((id) => ({ id, installed: false, running: false }))
    return JSON.parse((await execFile(this.executable, ['snapshot'], { timeout: 5_000 })).stdout) as AgentRecord[]
  }
  async open(record: AgentRecord): Promise<void> { await this.call('open', record.id, record.path) }
  async quit(record: AgentRecord): Promise<boolean> { const result = JSON.parse((await this.call('quit', record.id, record.path, 10_000)).stdout) as { exited: boolean }; return result.exited }
  async openLoginItemsSettings(): Promise<void> { await this.call('login-items-settings') }
  private call(command: string, id?: string, path?: string, timeout = 5_000) { if (!existsSync(this.executable)) throw new Error('Moirasia application agent is unavailable. Rebuild the app.'); return execFile(this.executable, [command, ...(id ? [id] : []), ...(path ? [path] : [])], { timeout }) }
}

async function invokeLoginControl(bundlePath: string, id: ApplicationId, command: string): Promise<LoginItemControlResult> {
  const executable = join(bundlePath, 'Contents', 'MacOS', CATALOG[id].label)
  const { stdout } = await execFile(executable, [`--moirasia-control=${command}`], { timeout: 5_000, maxBuffer: 64 * 1024 })
  const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? '') as LoginItemControlResult
  if (result.protocolVersion !== 1 || result.appId !== id) throw new Error(`Invalid control response from ${CATALOG[id].label}.`)
  return result
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
