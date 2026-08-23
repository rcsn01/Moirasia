import { copyFile, mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { APPLICATION_IDS, type ApplicationId, type ShellSettings } from '../shared/contracts'

export const DEFAULT_SHELL_SETTINGS: ShellSettings = { version: 3, launchAtLogin: false, pendingLoginItems: {}, features: {} }

export class ShellSettingsStore {
  #settings: ShellSettings = structuredClone(DEFAULT_SHELL_SETTINGS)
  #queue: Promise<void> = Promise.resolve()
  constructor(readonly filePath: string) {}

  async load(): Promise<ShellSettings> {
    const raw = await readJson(this.filePath) ?? await readJson(`${this.filePath}.backup`)
    this.#settings = migrate(raw)
    await this.#persist()
    return this.get()
  }
  get(): ShellSettings { return structuredClone(this.#settings) }
  async update(patch: Partial<Omit<ShellSettings, 'version'>>): Promise<ShellSettings> {
    this.#settings = {
      ...this.#settings, ...patch, version: 3,
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
  if (object.version === 3) return { version: 3, launchAtLogin, pendingLoginItems: validPending(object.pendingLoginItems), features: validFeatures(object.features) }
  if (object.version === 2) return { version: 3, launchAtLogin, pendingLoginItems: validPending(object.pendingLoginItems), features: { exithibition: true } }
  const legacy = object.autoStart && typeof object.autoStart === 'object' ? object.autoStart as Record<string, unknown> : {}
  return { version: 3, launchAtLogin, pendingLoginItems: Object.fromEntries(APPLICATION_IDS.filter((id) => legacy[id] === true).map((id) => [id, true])), features: { exithibition: true } }
}

function validPending(value: unknown): Readonly<Partial<Record<ApplicationId, true>>> {
  const pending = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(APPLICATION_IDS.filter((id) => pending[id] === true).map((id) => [id, true]))
}

// Unknown feature ids round-trip: a newer build's feature flags must survive this build's writes.
function validFeatures(value: unknown): Readonly<Partial<Record<ApplicationId, boolean>>> {
  const features = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(Object.entries(features).filter(([, flag]) => typeof flag === 'boolean')) as Partial<Record<ApplicationId, boolean>>
}

async function readJson(path: string): Promise<unknown> { try { return JSON.parse(await readFile(path, 'utf8')) } catch { return undefined } }
