import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AppearanceRegistry, applyWindowAppearance, desktopWindowChromeOptions, neutralWindowBackground } from '../packages/desktop-shell/src/main'

describe('AppearanceRegistry migration', () => {
  it('keeps macOS chrome separate from app-owned dimensions', () => {
    expect(desktopWindowChromeOptions('darwin')).toEqual({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 13 } })
    expect(desktopWindowChromeOptions('linux')).toEqual({})
    expect(desktopWindowChromeOptions('darwin')).not.toHaveProperty('width')
  })
  it('uses the shared neutral loading surface and updates an existing native window', () => {
    expect(neutralWindowBackground('light', true)).toBe('#ffffff')
    expect(neutralWindowBackground('dark', false)).toBe('#1c1917')
    expect(neutralWindowBackground('system', true)).toBe('#1c1917')
    const theme = { themeSource: 'system', shouldUseDarkColors: false }
    const window = { isDestroyed: () => false, setBackgroundColor: vi.fn() }
    applyWindowAppearance(theme as never, window as never, 'light')
    expect(theme.themeSource).toBe('light')
    expect(window.setBackgroundColor).toHaveBeenCalledWith('#ffffff')
  })
  it('hydrates Bonded without losing a version 1 snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moirasia-appearance-'))
    const path = join(directory, 'appearance.json')
    await writeFile(path, JSON.stringify({ version: 1, revision: 7, values: { moirasia: 'dark', amove: 'light', vox: 'system', exithibition: 'dark' } }))
    const registry = new AppearanceRegistry(path)
    const snapshot = await registry.load()
    registry.close()
    expect(snapshot).toEqual({ version: 1, revision: 7, values: { moirasia: 'dark', amove: 'light', vox: 'system', exithibition: 'dark', bonded: 'system' } })
  })
})
