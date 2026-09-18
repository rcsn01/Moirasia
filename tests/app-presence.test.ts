import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const image = { isEmpty: vi.fn(() => false), setTemplateImage: vi.fn() }
  const trayInstances: Array<{ destroy: ReturnType<typeof vi.fn>; setToolTip: ReturnType<typeof vi.fn>; setContextMenu: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }> = []
  class Tray {
    destroy = vi.fn()
    setToolTip = vi.fn()
    setContextMenu = vi.fn()
    on = vi.fn()
    constructor(readonly image: unknown) { trayInstances.push(this) }
  }
  const app = { dock: { hide: vi.fn(), show: vi.fn(async () => undefined) }, quit: vi.fn() }
  return { app, image, trayInstances, Tray, Menu: { buildFromTemplate: vi.fn((template) => template) }, nativeImage: { createFromPath: vi.fn(() => image) } }
})

const native = vi.hoisted(() => ({
  spawn: vi.fn(() => ({ pid: 4321, once: vi.fn(), unref: vi.fn() })),
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => '4321\n'),
  unlinkSync: vi.fn()
}))

vi.mock('electron', () => ({ app: electron.app, Menu: electron.Menu, nativeImage: electron.nativeImage, Tray: electron.Tray }))
vi.mock('node:child_process', () => ({ spawn: native.spawn }))
vi.mock('node:fs', () => ({ existsSync: native.existsSync, readFileSync: native.readFileSync, unlinkSync: native.unlinkSync }))

import { AppPresence } from '../src/main/app-presence'

beforeEach(() => { electron.trayInstances.length = 0; vi.clearAllMocks() })
afterEach(() => vi.restoreAllMocks())

describe('AppPresence', () => {
  it('moves the app to a menu bar item whose click opens the shell', () => {
    const open = vi.fn()
    const presence = new AppPresence({ menuBarIconPath: '/tmp/trayTemplate.png', open })

    presence.apply('menu-bar')

    expect(presence.mode).toBe('menu-bar')
    expect(electron.nativeImage.createFromPath).toHaveBeenCalledWith('/tmp/trayTemplate.png')
    expect(electron.image.setTemplateImage).toHaveBeenCalledWith(true)
    expect(electron.app.dock.hide).toHaveBeenCalled()
    expect(electron.trayInstances).toHaveLength(1)
    const click = electron.trayInstances[0]!.on.mock.calls.find(([event]) => event === 'click')?.[1]
    click?.()
    expect(open).toHaveBeenCalled()

    presence.dispose()
  })

  it('uses the native menu host in production instead of retaining an Electron Tray', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const presence = new AppPresence({
      menuBarIconPath: '/Applications/Moirasia.app/Contents/Resources/tray/trayTemplate.png',
      open: vi.fn(),
      nativeHost: { executable: '/Applications/Moirasia.app/Contents/Resources/application-agent', applicationPath: '/Applications/Moirasia.app', pidPath: '/tmp/menu-host.pid' }
    })

    presence.apply('menu-bar')

    expect(native.spawn).toHaveBeenCalledWith(
      '/Applications/Moirasia.app/Contents/Resources/application-agent',
      ['menu-host', '/Applications/Moirasia.app', '/Applications/Moirasia.app/Contents/Resources/tray/trayTemplate.png', '/tmp/menu-host.pid'],
      { detached: true, stdio: 'ignore' }
    )
    expect(electron.trayInstances).toHaveLength(0)
    presence.apply('dock')
    expect(kill).toHaveBeenCalledWith(4321, 'SIGTERM')
  })

  it('passes the feature resource paths to the persistent native host', () => {
    // The executable exists, but no running host endpoint, so the spawn path runs.
    native.existsSync.mockImplementationOnce(() => true).mockImplementationOnce(() => false)
    const presence = new AppPresence({
      menuBarIconPath: '/tmp/trayTemplate.png', open: vi.fn(),
      nativeHost: {
        executable: '/tmp/MoirasiaHost',
        featureServicePath: '/tmp/MoirasiaFeatureService',
        applicationPath: '/Applications/Moirasia.app',
        userData: '/tmp/user-data',
        iconPath: '/tmp/trayTemplate.png',
        bondedHelperPath: '/tmp/features/bonded/native/BondedFirewallHelper',
        shoutDriverPath: '/tmp/features/shout/driver'
      }
    })

    presence.apply('dock')

    expect(native.spawn).toHaveBeenCalledWith(
      '/tmp/MoirasiaHost',
      ['--host', '--application', '/Applications/Moirasia.app', '--user-data', '/tmp/user-data', '--feature-service', '/tmp/MoirasiaFeatureService', '--icon', '/tmp/trayTemplate.png', '--presence', 'dock', '--bonded-helper', '/tmp/features/bonded/native/BondedFirewallHelper', '--shout-driver', '/tmp/features/shout/driver'],
      { detached: true, stdio: 'ignore' }
    )
  })

  it('can leave the native host running while the Electron UI exits', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const presence = new AppPresence({
      menuBarIconPath: '/tmp/trayTemplate.png', open: vi.fn(),
      nativeHost: { executable: '/tmp/application-agent', applicationPath: '/Applications/Moirasia.app', pidPath: '/tmp/menu-host.pid' }
    })
    presence.apply('menu-bar')

    presence.preserveNativeHost()
    presence.dispose()

    expect(kill).not.toHaveBeenCalled()
  })

  it('restores Dock presence and destroys the menu bar item', () => {
    const presence = new AppPresence({ menuBarIconPath: '/tmp/trayTemplate.png', open: vi.fn() })
    presence.apply('menu-bar')

    presence.apply('dock')

    expect(presence.mode).toBe('dock')
    expect(electron.trayInstances[0]?.destroy).toHaveBeenCalled()
    expect(electron.app.dock.show).toHaveBeenCalled()
  })
})
