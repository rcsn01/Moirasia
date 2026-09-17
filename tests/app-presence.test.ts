import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const appListeners = new Map<string, Set<() => void>>()
  const image = { isEmpty: vi.fn(() => false), setTemplateImage: vi.fn() }
  const trayInstances: Array<{ destroy: ReturnType<typeof vi.fn>; setToolTip: ReturnType<typeof vi.fn>; setContextMenu: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }> = []
  class Tray {
    destroy = vi.fn()
    setToolTip = vi.fn()
    setContextMenu = vi.fn()
    on = vi.fn()
    constructor(readonly image: unknown) { trayInstances.push(this) }
  }
  const app = {
    dock: { hide: vi.fn(), show: vi.fn(async () => undefined) },
    quit: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => { const listeners = appListeners.get(event) ?? new Set(); listeners.add(listener); appListeners.set(event, listeners) }),
    removeListener: vi.fn((event: string, listener: () => void) => appListeners.get(event)?.delete(listener)),
    emit: (event: string) => appListeners.get(event)?.forEach((listener) => listener())
  }
  return { app, image, trayInstances, Tray, Menu: { buildFromTemplate: vi.fn((template) => template) }, nativeImage: { createFromPath: vi.fn(() => image) } }
})

vi.mock('electron', () => ({ app: electron.app, Menu: electron.Menu, nativeImage: electron.nativeImage, Tray: electron.Tray }))

import { AppPresence } from '../src/main/app-presence'

function fakeWindow() {
  const listeners = new Map<string, Set<(event: { preventDefault(): void }) => void>>()
  return {
    on: vi.fn((event: string, listener: (event: { preventDefault(): void }) => void) => { const current = listeners.get(event) ?? new Set(); current.add(listener); listeners.set(event, current) }),
    removeListener: vi.fn((event: string, listener: (event: { preventDefault(): void }) => void) => listeners.get(event)?.delete(listener)),
    emit: (event: string, value: { preventDefault(): void }) => listeners.get(event)?.forEach((listener) => listener(value)),
    isVisible: vi.fn(() => true), isFocused: vi.fn(() => true), isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => false),
    show: vi.fn(), hide: vi.fn(), focus: vi.fn(), restore: vi.fn()
  }
}

beforeEach(() => {
  electron.trayInstances.length = 0
  vi.clearAllMocks()
})

describe('AppPresence', () => {
  it('moves the running app to a menu bar item and keeps the window available', () => {
    const window = fakeWindow()
    const presence = new AppPresence(window as never, '/tmp/trayTemplate.png')

    presence.apply('menu-bar')

    expect(electron.nativeImage.createFromPath).toHaveBeenCalledWith('/tmp/trayTemplate.png')
    expect(electron.image.setTemplateImage).toHaveBeenCalledWith(true)
    expect(electron.app.dock.hide).toHaveBeenCalled()
    expect(window.show).toHaveBeenCalled()
    expect(window.focus).toHaveBeenCalled()
    expect(electron.trayInstances).toHaveLength(1)

    const close = { preventDefault: vi.fn() }
    window.emit('close', close)
    expect(close.preventDefault).toHaveBeenCalled()
    expect(window.hide).toHaveBeenCalled()

    presence.dispose()
  })

  it('restores Dock presence and allows the window to close while quitting', () => {
    const window = fakeWindow()
    const presence = new AppPresence(window as never, '/tmp/trayTemplate.png')
    presence.apply('menu-bar')

    presence.apply('dock')
    expect(electron.trayInstances[0]?.destroy).toHaveBeenCalled()
    expect(electron.app.dock.show).toHaveBeenCalled()

    electron.app.emit('before-quit')
    const close = { preventDefault: vi.fn() }
    window.emit('close', close)
    expect(close.preventDefault).not.toHaveBeenCalled()

    presence.dispose()
  })
})
