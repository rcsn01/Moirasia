import { copyFile, mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { APPLICATION_IDS, type ApplicationId, type ShellSettings } from '../shared/contracts'

export const DEFAULT_SHELL_SETTINGS: ShellSettings = { version: 2, launchAtLogin: false, pendingLoginItems: {} }

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
    this.#settings = { ...this.#settings, ...patch, version: 2, pendingLoginItems: { ...this.#settings.pendingLoginItems, ...patch.pendingLoginItems } }
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
  if (object.version === 2) {
    const pending = object.pendingLoginItems && typeof object.pendingLoginItems === 'object' ? object.pendingLoginItems as Record<string, unknown> : {}
    return { version: 2, launchAtLogin: object.launchAtLogin === true, pendingLoginItems: Object.fromEntries(APPLICATION_IDS.filter((id) => pending[id] === true).map((id) => [id, true])) }
  }
  const legacy = object.autoStart && typeof object.autoStart === 'object' ? object.autoStart as Record<string, unknown> : {}
  return { version: 2, launchAtLogin: object.launchAtLogin === true, pendingLoginItems: Object.fromEntries(APPLICATION_IDS.filter((id) => legacy[id] === true).map((id) => [id, true])) }
}

async function readJson(path: string): Promise<unknown> { try { return JSON.parse(await readFile(path, 'utf8')) } catch { return undefined } }
