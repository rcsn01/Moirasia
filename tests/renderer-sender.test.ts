import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: {},
  nativeTheme: {}
}))

const { sendToRenderer } = await import('../packages/desktop-shell/src/main')

class FakeWebContents extends EventEmitter {
  destroyed = false
  loading = true
  url = ''
  readonly send = vi.fn()

  isDestroyed(): boolean { return this.destroyed }
  isLoading(): boolean { return this.loading }
  getURL(): string { return this.url }
}

describe('renderer sender', () => {
  it('waits for the main frame and suppresses sends during navigation and teardown', () => {
    const contents = new FakeWebContents()
    const target = contents as never

    contents.url = 'about:blank'
    contents.loading = false
    expect(sendToRenderer(target, 'event', { value: 1 })).toBe(false)
    contents.loading = true
    contents.url = ''
    expect(sendToRenderer(target, 'event', { value: 1 })).toBe(false)
    expect(contents.send).not.toHaveBeenCalled()

    contents.url = 'http://localhost:5173/'
    contents.loading = false
    contents.emit('did-finish-load')
    expect(sendToRenderer(target, 'event', { value: 2 })).toBe(true)
    expect(contents.send).toHaveBeenCalledTimes(1)

    contents.emit('did-start-navigation', {}, '', false, true)
    expect(sendToRenderer(target, 'event', { value: 3 })).toBe(false)
    contents.emit('did-finish-load')
    expect(sendToRenderer(target, 'event', { value: 4 })).toBe(true)

    contents.emit('render-process-gone')
    expect(sendToRenderer(target, 'event', { value: 5 })).toBe(false)
    contents.emit('did-finish-load')
    contents.destroyed = true
    contents.emit('destroyed')
    expect(sendToRenderer(target, 'event', { value: 6 })).toBe(false)
  })

  it('keeps Electron send races best-effort after the readiness check', () => {
    const contents = new FakeWebContents()
    contents.url = 'file:///bonded.html'
    contents.loading = false
    contents.emit('did-finish-load')
    contents.send.mockImplementation(() => { throw new Error('Render frame was disposed before WebFrameMain could be accessed') })

    expect(sendToRenderer(contents as never, 'event', {})).toBe(false)
  })
})
