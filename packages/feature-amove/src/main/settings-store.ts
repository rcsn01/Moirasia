import { copyFile, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { appSettingsSchema, type AppSettings, type Platform, windowActionIds } from '../shared/contracts'
import { defaultSettings } from '../shared/defaults'
import { migrateMacUserDefaults, type MigrationResult } from './legacy-migration'

export interface LegacyPreferenceReader { (): Promise<Record<string, unknown> | undefined> }
export interface SettingsStoreOptions { readonly legacyDataDirectories?: readonly string[] }

export class SettingsStore {
  readonly filePath: string
  readonly platform: Platform
  private settings: AppSettings
  private warning: string | undefined
  private writeQueue: Promise<void> = Promise.resolve()
  private readonly legacyDataDirectories: readonly string[]

  constructor(filePath: string, platform: Platform, options: SettingsStoreOptions = {}) {
    this.filePath = filePath
    this.platform = platform
    this.settings = defaultSettings(platform)
    this.legacyDataDirectories = options.legacyDataDirectories ?? []
  }

  async load(readLegacyPreferences?: LegacyPreferenceReader): Promise<AppSettings> {
    const recovered = await this.readFirstValid([this.filePath, `${this.filePath}.backup`])
    if (recovered) {
      this.settings = withPlatformDefaults(recovered.settings, this.platform)
      if (this.platform === 'darwin' && readLegacyPreferences && this.settings.migrations.macUserDefaultsV1 === 'pending') {
        if (await this.tryMacMigration(readLegacyPreferences)) await this.persist()
        return this.get()
      }
      if (recovered.source.endsWith('.backup')) {
        this.warning = 'Settings were recovered from the last known good copy.'
        await this.persist()
      }
      return this.get()
    }

    // Suite data is intentionally separate from the standalone app. Import a
    // valid standalone document once, but never move or delete its source.
    const imported = await this.readLegacySettings()
    if (imported) {
      this.settings = withPlatformDefaults(imported.settings, this.platform)
      await this.persist()
      return this.get()
    }

    if (this.platform === 'darwin' && readLegacyPreferences) {
      if (await this.tryMacMigration(readLegacyPreferences)) await this.persist()
      return this.get()
    }

    this.settings = defaultSettings(this.platform)
    await this.persist()
    return this.get()
  }

  get(): AppSettings { return structuredClone(this.settings) }
  getWarning(): string | undefined { return this.warning }

  async update(mutator: (draft: AppSettings) => void): Promise<AppSettings> {
    const next = this.get()
    mutator(next)
    this.settings = appSettingsSchema.parse(next)
    await this.persist()
    return this.get()
  }

  private async readLegacySettings(): Promise<{ settings: AppSettings; source: string } | undefined> {
    const candidates = this.legacyDataDirectories.flatMap((directory) => [join(directory, 'settings.json'), join(directory, 'settings.json.backup')])
    if (candidates.length === 0) return undefined
    return this.readFirstValid(candidates)
  }

  private async persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      const backupPath = `${this.filePath}.backup`
      const bytes = `${JSON.stringify(this.settings, null, 2)}\n`
      await writeFile(temporaryPath, bytes, { encoding: 'utf8', mode: 0o600 })
      const handle = await open(temporaryPath, 'r+')
      try { await handle.sync() } finally { await handle.close() }
      await rename(temporaryPath, this.filePath)
      try { await copyFile(this.filePath, backupPath) } catch { /* A backup is best effort after the primary is durable. */ }
      try {
        const directory = await open(dirname(this.filePath), 'r')
        try { await directory.sync() } finally { await directory.close() }
      } catch { /* Directory fsync is not supported on every Windows filesystem. */ }
    })
    return this.writeQueue
  }

  private async tryMacMigration(readLegacyPreferences: LegacyPreferenceReader): Promise<boolean> {
    const current = this.get()
    try {
      const values = await readLegacyPreferences()
      if (values === undefined) {
        this.settings = pendingMigration(current)
        this.warning = 'Previous Amove settings could not be read because the native adapter is unavailable. Migration will retry.'
        return false
      }
      const migration: MigrationResult = migrateMacUserDefaults(values)
      this.settings = mergeMacMigration(current, migration.settings)
      this.warning = migration.warning
      return true
    } catch (error) {
      this.settings = pendingMigration(current)
      this.warning = `Previous Amove settings could not be read: ${error instanceof Error ? error.message : String(error)} Migration will retry.`
      return false
    }
  }

  private async readFirstValid(paths: readonly string[]): Promise<{ settings: AppSettings; source: string } | undefined> {
    for (const path of paths) {
      try {
        const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
        const settings = appSettingsSchema.parse(parsed)
        return { settings, source: path }
      } catch {
        try { await unlink(`${path}.tmp`) } catch { /* Ignore abandoned or missing temporary files. */ }
      }
    }
    return undefined
  }
}

function pendingMigration(settings: AppSettings): AppSettings {
  const result = structuredClone(settings)
  result.migrations.macUserDefaultsV1 = 'pending'
  return result
}

function mergeMacMigration(current: AppSettings, migrated: AppSettings): AppSettings {
  const defaults = defaultSettings('darwin')
  const currentBindings = current.shortcutsByPlatform.darwin ?? {}
  const migratedBindings = migrated.shortcutsByPlatform.darwin ?? {}
  const bindings = { ...currentBindings }
  for (const action of windowActionIds) {
    if (JSON.stringify(currentBindings[action]) === JSON.stringify(defaults.shortcutsByPlatform.darwin?.[action])) {
      const binding = migratedBindings[action]
      if (binding) bindings[action] = binding
    }
  }
  return {
    ...current,
    presenceMode: current.presenceMode === defaults.presenceMode ? migrated.presenceMode : current.presenceMode,
    shortcutsByPlatform: { ...current.shortcutsByPlatform, darwin: bindings },
    migrations: migrated.migrations
  }
}

function withPlatformDefaults(settings: AppSettings, platform: Platform): AppSettings {
  const defaults = defaultSettings(platform)
  const result = structuredClone(settings)
  result.shortcutsByPlatform[platform] = { ...defaults.shortcutsByPlatform[platform], ...result.shortcutsByPlatform[platform] }
  return result
}

