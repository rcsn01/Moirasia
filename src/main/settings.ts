import { copyFile, mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { MODULE_IDS, type ModuleId, type ShellPage } from '../shared/contracts'

const selectionSchema = z.union([
  z.literal('home'),
  z.literal('settings'),
  ...MODULE_IDS.map((id) => z.literal(id))
])

export const shellSettingsSchema = z.object({
  version: z.literal(1),
  appearance: z.enum(['system', 'light', 'dark']),
  launchAtLogin: z.boolean(),
  autoStart: z.object({
    amove: z.boolean(),
    vox: z.boolean(),
    exithibition: z.boolean()
  }).strict(),
  restoreLastSelection: z.boolean(),
  compactRail: z.boolean(),
  priorSelection: selectionSchema
}).strict()

export type ShellAppearance = 'system' | 'light' | 'dark'
export type ShellSelection = ShellPage | ModuleId
export type ShellSettings = z.infer<typeof shellSettingsSchema>
export type ShellSettingsPatch = Partial<Omit<ShellSettings, 'version' | 'autoStart'>> & {
  readonly autoStart?: Partial<Record<ModuleId, boolean>>
}

export const DEFAULT_SHELL_SETTINGS: ShellSettings = {
  version: 1,
  appearance: 'system',
  launchAtLogin: false,
  autoStart: { amove: false, vox: false, exithibition: false },
  restoreLastSelection: true,
  compactRail: false,
  priorSelection: 'home'
}

export class ShellSettingsStore {
  readonly filePath: string
  #settings: ShellSettings = structuredClone(DEFAULT_SHELL_SETTINGS)
  #writeQueue: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async load(): Promise<ShellSettings> {
    const primary = await readValid(this.filePath)
    const backup = primary ?? await readValid(`${this.filePath}.backup`)
    this.#settings = backup ?? structuredClone(DEFAULT_SHELL_SETTINGS)
    if (primary === undefined) await this.#persist()
    return this.get()
  }

  get(): ShellSettings {
    return structuredClone(this.#settings)
  }

  async update(patch: ShellSettingsPatch): Promise<ShellSettings> {
    const next = {
      ...this.#settings,
      ...patch,
      version: 1 as const,
      autoStart: { ...this.#settings.autoStart, ...patch.autoStart }
    }
    this.#settings = shellSettingsSchema.parse(next)
    await this.#persist()
    return this.get()
  }

  #persist(): Promise<void> {
    this.#writeQueue = this.#writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      const handle = await open(temporaryPath, 'w', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(this.#settings, null, 2)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporaryPath, this.filePath)
      await copyFile(this.filePath, `${this.filePath}.backup`)
      try {
        const directory = await open(dirname(this.filePath), 'r')
        try { await directory.sync() } finally { await directory.close() }
      } catch {
        // Directory fsync is unavailable on some filesystems.
      }
    })
    return this.#writeQueue
  }
}

async function readValid(path: string): Promise<ShellSettings | undefined> {
  try {
    return shellSettingsSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return undefined
  }
}
