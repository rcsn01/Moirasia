import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { applicationAgentPath } from '../src/main/paths'

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
    expect(bonded.accelerator).toBe('CommandOrControl+3')
    bonded.click?.()
    expect(open).toHaveBeenCalledWith('bonded')
  })

  it('assigns Vox Command+2 in the application menu', async () => {
    const { installApplicationMenu } = await import('../src/main/menu')
    const open = vi.fn()
    installApplicationMenu({ webContents: { send: vi.fn() } } as never, open)
    const template = electron.buildFromTemplate.mock.calls.at(-1)![0] as Array<{ label?: string; submenu?: Array<{ label?: string; accelerator?: string; click?: () => void }> }>
    const vox = template.find((item) => item.label === 'Applications')!.submenu!.find((item) => item.label === 'Vox')!
    expect(vox.accelerator).toBe('CommandOrControl+2')
    vox.click?.()
    expect(open).toHaveBeenCalledWith('vox')
  })


  it('routes Settings and File > Features to the new controller pages', async () => {
    const { installApplicationMenu } = await import('../src/main/menu')
    const reportPage = vi.fn()
    installApplicationMenu({ webContents: { send: vi.fn() } } as never, vi.fn(), reportPage)
    const template = electron.buildFromTemplate.mock.calls.at(-1)![0] as Array<{ label?: string; submenu?: Array<{ label?: string; accelerator?: string; click?: () => void }> }>
    const settings = template.find((item) => item.label === 'Moirasia')!.submenu!.find((item) => item.label === 'Settings…')!
    const features = template.find((item) => item.label === 'File')!.submenu!.find((item) => item.label === 'Features')!

    expect(settings.accelerator).toBe('CommandOrControl+,')
    settings.click?.()
    expect(reportPage).toHaveBeenLastCalledWith('general')
    features.click?.()
    expect(reportPage).toHaveBeenLastCalledWith('features')
  })

  it('configures a branded Moirasia Dock icon for development and packaging', async () => {
    const [main, builder, icon, menuBarIcon] = await Promise.all([
      readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8'),
      readFile(new URL('../build/icon.icns', import.meta.url)),
      readFile(new URL('../build/trayTemplate.png', import.meta.url))
    ])
    expect(main).toContain("app.setName('Moirasia')")
    expect(main).toContain("app.dock.setIcon(join(app.getAppPath(), 'build', 'icon.png'))")
    expect(builder).toContain('icon: build/icon.icns')
    expect(builder).toContain('to: tray/trayTemplate.png')
    expect(icon.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(menuBarIcon.subarray(1, 4).toString('ascii')).toBe('PNG')
  })

  it('uses the staged native agent while running from Electron dev', () => {
    expect(applicationAgentPath('/tmp/electron-resources-without-moirasia-agent')).toMatch(/native\/staged\/application-agent$/)
  })

  it('registers Bonded with the native application agent', async () => {
    const source = await readFile(new URL('../native/application-agent/main.swift', import.meta.url), 'utf8')
    expect(source).toContain('Product(id: "bonded", name: "Bonded", bundleIdentifier: "com.opense.Bonded")')
  })
})
