import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHELL_SETTINGS,
  ShellSettingsStore
} from '../src/main/settings'

describe('ShellSettingsStore', () => {
  it('loads defaults when no file exists and persists them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moirasia-settings-'))
    const store = new ShellSettingsStore(join(directory, 'settings.json'))

    await expect(store.load()).resolves.toEqual(DEFAULT_SHELL_SETTINGS)
    await expect(readFile(store.filePath, 'utf8')).resolves.toContain('"version": 3')
  })

  it('recovers from corrupt primary using backup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moirasia-settings-'))
    const path = join(directory, 'settings.json')
    const store = new ShellSettingsStore(path)
    await store.load()
    await store.update({ launchAtLogin: true })
    await writeFile(path, '{not-json')

    const recovered = await new ShellSettingsStore(path).load()

    expect(recovered).toMatchObject({ version: 3, launchAtLogin: true })
  })

  it('recovers from a syntactically valid but malformed primary using backup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moirasia-settings-'))
    const path = join(directory, 'settings.json')
    const store = new ShellSettingsStore(path)
    await store.load()
    await store.update({ launchAtLogin: true })
    await writeFile(path, JSON.stringify({ version: 3, launchAtLogin: false, pendingLoginItems: [], features: {} }))

    await expect(new ShellSettingsStore(path).load()).resolves.toMatchObject({ version: 3, launchAtLogin: true })
  })

  it('falls back to defaults when primary and backup are invalid', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moirasia-settings-'))
    const path = join(directory, 'settings.json')
    await writeFile(path, '{"version":')
    await writeFile(`${path}.backup`, '{"appearance":')

    await expect(new ShellSettingsStore(path).load()).resolves.toEqual(DEFAULT_SHELL_SETTINGS)
  })

  it('migrates enabled legacy auto-start values to pending login items', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moirasia-settings-'))
    const store = new ShellSettingsStore(join(directory, 'settings.json'))
    await writeFile(store.filePath, JSON.stringify({ version: 1, launchAtLogin: false, autoStart: { amove: false, vox: true, exithibition: false } }))
    const updated = await store.load()
    expect(updated.pendingLoginItems).toEqual({ vox: true })
    expect(updated.features).toEqual({})
  })

  it('migrates v2 settings to v3 with no features installed by default', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moirasia-settings-'))
    const store = new ShellSettingsStore(join(directory, 'settings.json'))
    await writeFile(store.filePath, JSON.stringify({ version: 2, launchAtLogin: true, pendingLoginItems: { amove: true, bogus: true } }))

    const migrated = await store.load()

    expect(migrated).toEqual({ version: 3, launchAtLogin: true, pendingLoginItems: { amove: true }, features: {} })
  })

  it('round-trips v3 feature flags across writes and reloads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moirasia-settings-'))
    const path = join(directory, 'settings.json')
    const store = new ShellSettingsStore(path)
    await store.update({ features: { bonded: false } })

    const reloaded = await new ShellSettingsStore(path).load()

    expect(reloaded.features).toEqual({ bonded: false })
  })

  it('preserves unknown feature flags written by newer builds', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moirasia-settings-'))
    const store = new ShellSettingsStore(join(directory, 'settings.json'))
    await writeFile(store.filePath, JSON.stringify({ version: 3, launchAtLogin: false, pendingLoginItems: {}, features: { exithibition: false, 'future-feature': true, broken: 'yes' } }))

    const loaded = await store.load()

    expect(loaded.features).toEqual({ 'future-feature': true })
  })
})
