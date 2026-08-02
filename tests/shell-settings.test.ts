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
    await expect(readFile(store.filePath, 'utf8')).resolves.toContain('"version": 1')
  })

  it('recovers from corrupt primary using backup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moirasia-settings-'))
    const path = join(directory, 'settings.json')
    const store = new ShellSettingsStore(path)
    await store.load()
    await store.update({ appearance: 'dark', launchAtLogin: true })
    await writeFile(path, '{not-json')

    const recovered = await new ShellSettingsStore(path).load()

    expect(recovered).toMatchObject({ appearance: 'dark', launchAtLogin: true })
  })

  it('falls back to defaults when primary and backup are invalid', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moirasia-settings-'))
    const path = join(directory, 'settings.json')
    await writeFile(path, '{"version":2}')
    await writeFile(`${path}.backup`, '{"appearance":"neon"}')

    await expect(new ShellSettingsStore(path).load()).resolves.toEqual(DEFAULT_SHELL_SETTINGS)
  })

  it('merges autoStart patches without enabling modules by default', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moirasia-settings-'))
    const store = new ShellSettingsStore(join(directory, 'settings.json'))
    await store.load()

    const updated = await store.update({ autoStart: { vox: true } })

    expect(updated.autoStart).toEqual({ amove: false, vox: true, exithibition: false })
  })
})
