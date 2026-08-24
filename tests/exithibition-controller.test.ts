import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

const mocks = vi.hoisted(() => {
  type Handler = (event: never, ...args: never[]) => unknown

  class FakeWindow {
    static instances: FakeWindow[] = []
    options: unknown
    destroyed = false
    webContents = { send: () => undefined, on: () => undefined, isDestroyed: () => this.destroyed }
    constructor(options: unknown) { this.options = options; FakeWindow.instances.push(this) }
    once(): void {}
    on(): void {}
    show(): void {}
    focus(): void {}
    destroy(): void { this.destroyed = true }
    isDestroyed(): boolean { return this.destroyed }
    async loadURL(): Promise<void> {}
    async loadFile(): Promise<void> {}
  }
  const handlers = new Map<string, Handler>()
  const removed: string[] = []
  return {
    FakeWindow, handlers, removed,
    ipcMain: {
      handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) },
      removeHandler: (channel: string) => { handlers.delete(channel); removed.push(channel) }
    },
    powerMonitor: { on: () => undefined, off: () => undefined },
    app: { isPackaged: false, getAppPath: () => '/nonexistent', getPath: () => '/tmp' }
  }
})
vi.mock('electron', () => ({ BrowserWindow: mocks.FakeWindow, ipcMain: mocks.ipcMain, powerMonitor: mocks.powerMonitor, app: mocks.app }))
vi.mock('@moirasia/desktop-shell/main', () => ({
  desktopWindowChromeOptions: () => ({}),
  neutralWindowBackground: () => '#1c1917',
  registerProductAppearance: async () => () => undefined
}))

import { feature } from '../packages/feature-exithibition/src/main/feature'

const shellWindow = new mocks.FakeWindow({})
const surface = {
  webContents: shellWindow.webContents,
  state: { active: true, focused: true },
  activate: vi.fn(),
  focus: vi.fn(),
  subscribe: vi.fn(() => vi.fn())
} as never
function context(nativeExecutable: string) {
  return { id: 'exithibition', mode: 'suite', productId: 'exithibition', surface, paths: { native: { executable: nativeExecutable }, dataDirectory: '/tmp/exithibition-data' } } as never
}

const CHANNELS = ['exithibition:get-snapshot', 'exithibition:get-history', 'exithibition:set-sampling', 'exithibition:set-experimental'] as const

// A minimal stand-in for ExithibitionNative: answers every JSON line with an ok
// response so NativeClient invokes resolve and stop() does not wait for timeouts.
let native: string
beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'exithibition-native-'))
  native = join(directory, 'ExithibitionNative')
  const server = `const rl = require('node:readline').createInterface({ input: process.stdin }); rl.on('line', (line) => { try { const message = JSON.parse(line); process.stdout.write(JSON.stringify({ type: 'response', id: message.id, ok: true, result: {} }) + '\\n'); if (message.type === 'shutdown') process.exit(0) } catch {} })`
  await writeFile(native, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} -e ${JSON.stringify(server)}\n`)
  await chmod(native, 0o755)
})

describe('Exithibition feature IPC', () => {
  it('rejects foreign and destroyed senders, serves its own window, and tears down fully', async () => {
    await feature.register(context(native))
    for (const channel of CHANNELS) expect(mocks.handlers.has(channel)).toBe(true)

    const getHistory = mocks.handlers.get('exithibition:get-history')!
    const view = shellWindow
    const foreign = { sender: {} } as unknown as IpcMainInvokeEvent
    const own = { sender: view.webContents } as unknown as IpcMainInvokeEvent

    expect(() => getHistory(foreign as never, '1m' as never)).toThrow('Unauthorized IPC sender')
    expect(() => getHistory(own as never, 'bogus' as never)).toThrow('Invalid history range')
    expect(getHistory(own as never, '1m' as never)).toEqual([])

    // A sender that once was the feature window but is now destroyed is also rejected.
    view.destroyed = true
    expect(() => getHistory(own as never, '1m' as never)).toThrow('Unauthorized IPC sender')
    view.destroyed = false
    for (const channel of CHANNELS) {
      const handler = mocks.handlers.get(channel)!
      await expect(Promise.resolve().then(() => handler(foreign as never, true as never))).rejects.toThrow('Unauthorized IPC sender')
    }

    await feature.dispose()
    expect(mocks.removed).toEqual(expect.arrayContaining([...CHANNELS]))
    for (const channel of CHANNELS) expect(mocks.handlers.has(channel)).toBe(false)

    // Reinstall in the same session re-registers the feature cleanly.
    await feature.register(context(native))
    for (const channel of CHANNELS) expect(mocks.handlers.has(channel)).toBe(true)
    await feature.dispose()
  })

  it('rolls back a partially started feature when the native helper is missing', async () => {
    await expect(feature.register(context('/tmp/missing-ExithibitionNative'))).rejects.toThrow('ExithibitionNative was not found')

    expect([...mocks.handlers.keys()]).not.toEqual(expect.arrayContaining([...CHANNELS]))
    expect(mocks.FakeWindow.instances).toHaveLength(1)
    expect(shellWindow.destroyed).toBe(false)
  })
})
