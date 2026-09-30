import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { addMacSettingsMenuItem, defaultMacApplicationMenu, SETTINGS_MENU_ACCELERATOR, SETTINGS_MENU_LABEL } from '../packages/desktop-shell/src/standalone-launch'

function submenuOf(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] {
  if (!Array.isArray(item.submenu)) throw new Error('Expected an application submenu')
  return item.submenu
}

describe('macOS application menu', () => {
  it('adds an enabled Settings command to the product menu and preserves the rest', () => {
    const onOpenSettings = vi.fn()
    const template = [
      { label: 'Orbis', submenu: [
        { role: 'about' as const },
        { label: 'Check for Updates…', click: vi.fn() },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ] },
      { label: 'File', submenu: [{ role: 'close' as const }] }
    ]

    const result = addMacSettingsMenuItem(template, 'Orbis', onOpenSettings, 'darwin')
    const appMenu = result[0]!
    const appSubmenu = submenuOf(appMenu)
    const settings = appSubmenu.find((item) => item.label === SETTINGS_MENU_LABEL)!

    expect(result[1]).toBe(template[1])
    expect(settings).toMatchObject({ label: SETTINGS_MENU_LABEL, accelerator: SETTINGS_MENU_ACCELERATOR, enabled: true, click: onOpenSettings })
    expect(appSubmenu.map((item) => item.label ?? item.role ?? item.type)).toEqual([
      'about', 'Check for Updates…', 'separator', SETTINGS_MENU_LABEL, 'separator', 'quit'
    ])
    expect(appSubmenu.filter((item) => item.type === 'separator')).toHaveLength(2)
    settings.click?.({} as never, {} as never, {} as never)
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('shows Settings disabled until the app has a settings route', () => {
    const menu = defaultMacApplicationMenu('Orbis', undefined, 'darwin')
    const appMenu = menu.find((item) => item.label === 'Orbis')!
    const settings = submenuOf(appMenu).find((item) => item.label === SETTINGS_MENU_LABEL)
    expect(settings).toMatchObject({ enabled: false, accelerator: SETTINGS_MENU_ACCELERATOR })
  })

  it('does not change non-macOS menus', () => {
    const template = [{ label: 'File', submenu: [{ role: 'quit' as const }] }]
    expect(addMacSettingsMenuItem(template, 'App', undefined, 'win32')).toEqual(template)
  })

  it('does not add a duplicate Settings item', () => {
    const existing = { label: SETTINGS_MENU_LABEL, accelerator: SETTINGS_MENU_ACCELERATOR, enabled: true, click: vi.fn() }
    const template = [{ label: 'App', submenu: [{ role: 'about' as const }, existing] }]
    const result = addMacSettingsMenuItem(template, 'App', vi.fn(), 'darwin')
    const appSubmenu = submenuOf(result[0]!)
    expect(appSubmenu.filter((item) => item.label === SETTINGS_MENU_LABEL)).toHaveLength(1)
    expect(appSubmenu.find((item) => item.label === SETTINGS_MENU_LABEL)).toBe(existing)
  })
})
