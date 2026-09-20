import { copyFile, mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { APPLICATION_IDS, DEFAULT_SHELL_SETTINGS, type ApplicationId, type ShellSettings } from '../shared/contracts'

export class ShellSettingsStore {
  #settings: ShellSettings = structuredClone(DEFAULT_SHELL_SETTINGS)
  #queue: Promise<void> = Promise.resolve()
  constructor(readonly filePath: string) {}

  async load(): Promise<ShellSettings> {
    const primary = await readJson(this.filePath)
    const backup = await readJson(`${this.filePath}.backup`)
    const raw = isShellSettingsDocument(primary) ? primary : isShellSettingsDocument(backup) ? backup : primary ?? backup
    this.#settings = migrate(raw)
    await this.#persist()
    return this.get()
  }
  get(): ShellSettings { return structuredClone(this.#settings) }
  /** Update the Electron cache from the native host without writing the document. */
  setCached(value: ShellSettings): void { this.#settings = structuredClone(value) }
  async update(patch: Partial<Omit<ShellSettings, 'version'>>): Promise<ShellSettings> {
    this.#settings = {
      ...this.#settings, ...patch, version: 4,
      pendingLoginItems: { ...this.#settings.pendingLoginItems, ...patch.pendingLoginItems },
      features: { ...this.#settings.features, ...patch.features }
    }
    await this.#persist(); return this.get()
  }
  async clearPending(id: ApplicationId): Promise<ShellSettings> {
    const pending = { ...this.#settings.pendingLoginItems }; delete pending[id]
    this.#settings = { ...this.#settings, pendingLoginItems: pending }
    await this.#persist(); return this.get()
  }
  #persist(): Promise<void> {
    this.#queue = this.#queue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporary = `${this.filePath}.${process.pid}.tmp`; const handle = await open(temporary, 'w', 0o600)
      try { await handle.writeFile(`${JSON.stringify(this.#settings, null, 2)}\n`); await handle.sync() } finally { await handle.close() }
      await rename(temporary, this.filePath); await copyFile(this.filePath, `${this.filePath}.backup`)
    }); return this.#queue
  }
}

function migrate(value: unknown): ShellSettings {
  if (!value || typeof value !== 'object') return structuredClone(DEFAULT_SHELL_SETTINGS)
  const object = value as Record<string, unknown>
  const launchAtLogin = object.launchAtLogin === true
  const appPresence = object.appPresence === 'menu-bar' ? 'menu-bar' : 'dock'
  if (object.version === 4 || object.version === 3) return { version: 4, launchAtLogin, appPresence, pendingLoginItems: validPending(object.pendingLoginItems), features: validFeatures(object.features) }
  if (object.version === 2) return { version: 4, launchAtLogin, appPresence, pendingLoginItems: validPending(object.pendingLoginItems), features: {} }
  const legacy = object.autoStart && typeof object.autoStart === 'object' ? object.autoStart as Record<string, unknown> : {}
  return { version: 4, launchAtLogin, appPresence, pendingLoginItems: Object.fromEntries(APPLICATION_IDS.filter((id) => legacy[id] === true).map((id) => [id, true])), features: {} }
}

function validPending(value: unknown): Readonly<Partial<Record<ApplicationId, true>>> {
  const pending = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(APPLICATION_IDS.filter((id) => pending[id] === true).map((id) => [id, true]))
}

// Unknown feature ids round-trip: a newer build's feature flags must survive this build's writes.
function validFeatures(value: unknown): Readonly<Partial<Record<ApplicationId, boolean>>> {
  const features = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const retired = new Set(['exithibition', 'orbis'])
  return Object.fromEntries(Object.entries(features).filter(([id, flag]) => !retired.has(id) && typeof flag === 'boolean')) as Partial<Record<ApplicationId, boolean>>
}

function isShellSettingsDocument(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const object = value as Record<string, unknown>
  if (object.version === 4) return typeof object.launchAtLogin === 'boolean' && (object.appPresence === 'dock' || object.appPresence === 'menu-bar') && optionalRecord(object.pendingLoginItems) && optionalRecord(object.features)
  if (object.version === 3) return typeof object.launchAtLogin === 'boolean' && optionalRecord(object.pendingLoginItems) && optionalRecord(object.features)
  if (object.version === 2) return typeof object.launchAtLogin === 'boolean' && optionalRecord(object.pendingLoginItems)
  return object.version === undefined && (object.autoStart !== undefined || typeof object.launchAtLogin === 'boolean' || object.pendingLoginItems !== undefined || object.features !== undefined)
}

function optionalRecord(value: unknown): boolean {
  return value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value))
}

async function readJson(path: string): Promise<unknown> { try { return JSON.parse(await readFile(path, 'utf8')) } catch { return undefined } }
