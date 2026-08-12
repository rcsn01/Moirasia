import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  setApplicationMenu: vi.fn(),
  buildFromTemplate: vi.fn((template: unknown) => template)
}))
vi.mock('electron', () => ({ Menu: electron }))

describe('Bonded platform integration', () => {
  it('assigns Bonded Command+4 in the application menu', async () => {
    const { installApplicationMenu } = await import('../src/main/menu')
    const send = vi.fn(), open = vi.fn()
    installApplicationMenu({ webContents: { send } } as never, open)
    const template = electron.buildFromTemplate.mock.calls[0]![0] as Array<{ label?: string; submenu?: Array<{ label?: string; accelerator?: string; click?: () => void }> }>
    const bonded = template.find((item) => item.label === 'Applications')!.submenu!.find((item) => item.label === 'Bonded')!
    expect(bonded.accelerator).toBe('CommandOrControl+4')
    bonded.click?.()
    expect(open).toHaveBeenCalledWith('bonded')
  })

  it('registers Bonded with the native application agent', async () => {
    const source = await readFile(new URL('../native/application-agent/main.swift', import.meta.url), 'utf8')
    expect(source).toContain('Product(id: "bonded", name: "Bonded", bundleIdentifier: "com.opense.Bonded")')
  })
})
