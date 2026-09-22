import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppUpdater } from '../packages/desktop-shell/src/app-updater'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener)
    }),
    removeHandler: vi.fn((channel: string) => { handlers.delete(channel) })
  }
  return { handlers, ipcMain }
})

vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0' },
  ipcMain: electron.ipcMain,
  shell: { openExternal: vi.fn() }
}))

import { registerGitHubUpdaterIpc } from '../packages/desktop-shell/src/app-updater-electron'

function updater(overrides: Partial<AppUpdater> = {}): AppUpdater {
  return {
    state: vi.fn(() => ({ status: 'idle', currentVersion: '1.0.0' })),
    check: vi.fn(),
    openRelease: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    ...overrides
  } as unknown as AppUpdater
}

describe('Electron app updater IPC registrar', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('removes every updater handler when state subscription setup fails', () => {
    const failure = new Error('subscription failed')
    const subject = updater({ subscribe: vi.fn(() => { throw failure }) })

    expect(() => registerGitHubUpdaterIpc({
      prefix: 'test',
      updater: subject,
      authorize: vi.fn(),
      sendState: vi.fn()
    })).toThrow(failure)

    expect(electron.handlers.size).toBe(0)
    expect(electron.ipcMain.removeHandler).toHaveBeenCalledTimes(3)
  })

  it('preserves a handler-registration error when rollback also fails', () => {
    const setupFailure = new Error('handler registration failed')
    electron.ipcMain.handle
      .mockImplementationOnce((channel: string, listener: (...args: unknown[]) => unknown) => { electron.handlers.set(channel, listener) })
      .mockImplementationOnce(() => { throw setupFailure })
    electron.ipcMain.removeHandler.mockImplementationOnce((channel: string) => {
      electron.handlers.delete(channel)
      throw new Error('handler removal failed')
    })

    expect(() => registerGitHubUpdaterIpc({
      prefix: 'test',
      updater: updater(),
      authorize: vi.fn(),
      sendState: vi.fn()
    })).toThrow(setupFailure)

    expect(electron.handlers.size).toBe(0)
  })

  it('disposes every resource once and throws the first cleanup error', () => {
    const unsubscribeFailure = new Error('unsubscribe failed')
    const unsubscribe = vi.fn(() => { throw unsubscribeFailure })
    electron.ipcMain.removeHandler.mockImplementationOnce((channel: string) => {
      electron.handlers.delete(channel)
      throw new Error('handler removal failed')
    })
    const dispose = registerGitHubUpdaterIpc({
      prefix: 'test',
      updater: updater({ subscribe: vi.fn(() => unsubscribe) }),
      authorize: vi.fn(),
      sendState: vi.fn()
    })

    expect(() => dispose()).toThrow(unsubscribeFailure)
    expect(electron.handlers.size).toBe(0)
    expect(electron.ipcMain.removeHandler).toHaveBeenCalledTimes(3)

    expect(() => dispose()).not.toThrow()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(electron.ipcMain.removeHandler).toHaveBeenCalledTimes(3)
  })
})
