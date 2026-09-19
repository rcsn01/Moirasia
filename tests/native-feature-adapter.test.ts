import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererTarget } from '@moirasia/desktop-shell/feature'
import type { NativeFeatureTransport } from '@moirasia/desktop-shell/native-feature-adapter'

const electron = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => unknown
  const handlers = new Map<string, Handler>()
  let failOn: string | undefined
  const handle = vi.fn((channel: string, listener: Handler): void => {
    if (channel === failOn) throw new Error(`registration failed for ${channel}`)
    if (handlers.has(channel)) throw new Error(`duplicate handler ${channel}`)
    handlers.set(channel, listener)
  })
  const removeHandler = vi.fn((channel: string): void => { handlers.delete(channel) })
  return {
    handlers,
    handle,
    removeHandler,
    setFailOn(channel: string | undefined): void { failOn = channel },
    reset(): void { handlers.clear(); failOn = undefined; handle.mockClear(); removeHandler.mockClear() }
  }
})

vi.mock('electron', () => ({ ipcMain: { handle: electron.handle, removeHandler: electron.removeHandler } }))

import {
  NativeFeaturePayloadError,
  createNativeFeatureAdapter,
  registerNativeFeatureIpc
} from '@moirasia/desktop-shell/native-feature-adapter'

interface FakeTransport extends NativeFeatureTransport {
  requests: Array<{ method: string; params: Record<string, unknown> }>
  emit(event: string, payload: unknown, revision?: number): void
  setResponse(response: (method: string, params: Record<string, unknown>) => unknown | Promise<unknown>): void
  listeners: Map<string, Set<(payload: unknown, revision: number) => void>>
}

function fakeTransport(): FakeTransport {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = []
  const listeners = new Map<string, Set<(payload: unknown, revision: number) => void>>()
  let response: (method: string, params: Record<string, unknown>) => unknown | Promise<unknown> = async () => ({ ok: true })
  const request = async <T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    requests.push({ method, params })
    return response(method, params) as T
  }
  const transport: FakeTransport = {
    requests,
    listeners,
    request,
    subscribe: vi.fn((event: string, listener: (payload: unknown, revision: number) => void) => {
      const eventListeners = listeners.get(event) ?? new Set()
      eventListeners.add(listener)
      listeners.set(event, eventListeners)
      return () => {
        eventListeners.delete(listener)
        if (eventListeners.size === 0) listeners.delete(event)
      }
    }),
    emit(event: string, payload: unknown, revision = 1): void {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(payload, revision)
    },
    setResponse(next): void { response = next }
  }
  return transport
}

function fakeRenderer(initial: object | undefined): { renderer: RendererTarget; setCurrent(value: object | undefined): void; send: ReturnType<typeof vi.fn> } {
  let current = initial
  const send = vi.fn(() => true)
  return {
    renderer: {
      current: () => current as never,
      send,
      subscribe: () => () => undefined
    },
    setCurrent(value): void { current = value },
    send
  }
}

function sender(destroyed = false): { isDestroyed: () => boolean; setDestroyed(value: boolean): void } {
  let value = destroyed
  return {
    isDestroyed: () => value,
    setDestroyed(next): void { value = next }
  }
}

describe('native feature port', () => {
  beforeEach(() => electron.reset())

  it('joins getSnapshot, supplies an empty params object, and decodes the response', async () => {
    const transport = fakeTransport()
    transport.setResponse(async (method, params) => ({ method, params, value: 7 }))
    const port = createNativeFeatureAdapter(transport, {
      featureId: 'bonded',
      decodeSnapshot: (value) => ({ decoded: value })
    })

    await expect(port.getSnapshot()).resolves.toEqual({ decoded: { method: 'bonded.getSnapshot', params: {}, value: 7 } })
    expect(transport.requests).toEqual([{ method: 'bonded.getSnapshot', params: {} }])
  })

  it('joins valid command suffixes and preserves explicit params', async () => {
    const transport = fakeTransport()
    const port = createNativeFeatureAdapter(transport, { featureId: 'shout', decodeSnapshot: (value) => value })
    const params = { db: 12 }
    const decode = vi.fn((value: unknown) => value as { ok: boolean })
    transport.setResponse(async () => ({ ok: true }))

    await expect(port.call('setGain', decode, params)).resolves.toEqual({ ok: true })
    expect(decode).toHaveBeenCalledWith({ ok: true })
    expect(transport.requests).toEqual([{ method: 'shout.setGain', params }])
  })

  it.each(['', 'a.b', 'SetGain', 'set gain', ' setGain'])('rejects malformed command suffix %j before transport use', async (command) => {
    const transport = fakeTransport()
    const port = createNativeFeatureAdapter(transport, { featureId: 'amove', decodeSnapshot: (value) => value })

    const error = await port.call(command, (value) => value).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(TypeError)
    expect(String(error)).toMatch(/command suffix/i)
    expect(transport.requests).toHaveLength(0)
  })

  it('wraps decoder errors with safe feature and operation context', async () => {
    const transport = fakeTransport()
    transport.setResponse(async () => ({ version: 99, path: '/private/user/path' }))
    const port = createNativeFeatureAdapter(transport, {
      featureId: 'bonded',
      decodeSnapshot: () => { throw new Error('decoder rejected payload') }
    })

    const error = await port.getSnapshot().catch((value: unknown) => value)
    expect(error).toBeInstanceOf(NativeFeaturePayloadError)
    expect(String(error)).toContain("bonded.getSnapshot")
    expect(String(error)).not.toContain('/private/user/path')
  })

  it('propagates transport failures unchanged', async () => {
    const transport = fakeTransport()
    const failure = new Error('socket failed')
    transport.setResponse(async () => { throw failure })
    const port = createNativeFeatureAdapter(transport, { featureId: 'shout', decodeSnapshot: (value) => value })

    await expect(port.getSnapshot()).rejects.toBe(failure)
  })

  it('decodes events, drops invalid events, and continues with later valid events', () => {
    const transport = fakeTransport()
    const invalid = vi.fn()
    const received: unknown[] = []
    const port = createNativeFeatureAdapter(transport, {
      featureId: 'amove',
      decodeSnapshot: (value) => {
        if (!value || typeof value !== 'object' || (value as { valid?: unknown }).valid !== true) throw new Error('invalid')
        return { accepted: true }
      },
      onInvalidEvent: invalid
    })
    port.subscribeSnapshot((value) => received.push(value))

    expect(() => transport.emit('amove.snapshot', { path: '/private/user/path' })).not.toThrow()
    transport.emit('amove.snapshot', { valid: true })

    expect(received).toEqual([{ accepted: true }])
    expect(invalid).toHaveBeenCalledOnce()
    expect(String(invalid.mock.calls[0]![0])).not.toContain('/private/user/path')
  })

  it('contains a throwing invalid-event reporter', () => {
    const transport = fakeTransport()
    const port = createNativeFeatureAdapter(transport, {
      featureId: 'amove',
      decodeSnapshot: () => { throw new Error('invalid') },
      onInvalidEvent: () => { throw new Error('reporter failed') }
    })
    port.subscribeSnapshot(() => undefined)

    expect(() => transport.emit('amove.snapshot', {})).not.toThrow()
  })
})

describe('native feature IPC registrar', () => {
  beforeEach(() => electron.reset())

  function registration(options: Partial<Parameters<typeof registerNativeFeatureIpc>[0]> = {}) {
    const current = sender()
    const fake = fakeRenderer(current)
    const unsubscribe = vi.fn()
    let snapshotListener: ((snapshot: unknown) => void) | undefined
    const subscribeSnapshot = vi.fn((listener: (snapshot: unknown) => void) => {
      snapshotListener = listener
      return unsubscribe
    })
    const command = vi.fn((value: unknown) => ({ value }))
    const dispose = registerNativeFeatureIpc({
      renderer: fake.renderer,
      authorizationError: 'Unauthorized test IPC sender',
      snapshotChannel: 'test:snapshot',
      commands: [{ channel: 'test:command', invoke: command }],
      subscribeSnapshot,
      ...options
    })
    return { current, fake, unsubscribe, snapshotListener: () => snapshotListener, command, subscribeSnapshot, dispose }
  }

  it('authorizes the current renderer and rejects missing, stale, destroyed, and disposed senders', async () => {
    const first = registration()
    const firstSender = first.current
    const handler = electron.handlers.get('test:command')!
    expect(handler({ sender: firstSender }, 1)).toEqual({ value: 1 })

    const secondSender = sender()
    first.fake.setCurrent(secondSender)
    expect(() => handler({ sender: firstSender }, 2)).toThrow('Unauthorized test IPC sender')
    expect(handler({ sender: secondSender }, 3)).toEqual({ value: 3 })

    first.fake.setCurrent(undefined)
    expect(() => handler({ sender: secondSender }, 4)).toThrow('Unauthorized test IPC sender')
    first.fake.setCurrent(secondSender)
    secondSender.setDestroyed(true)
    expect(() => handler({ sender: secondSender }, 5)).toThrow('Unauthorized test IPC sender')

    first.dispose()
    expect(() => handler({ sender: secondSender }, 6)).toThrow('Unauthorized test IPC sender')
    expect(first.command).toHaveBeenCalledTimes(2)
  })

  it('authorizes before invoking the product command', async () => {
    const value = { invalid: true }
    const registrationState = registration()
    const handler = electron.handlers.get('test:command')!
    const stale = sender()
    registrationState.fake.setCurrent(stale)

    expect(() => handler({ sender: registrationState.current }, value)).toThrow('Unauthorized test IPC sender')
    expect(registrationState.command).not.toHaveBeenCalled()

    expect(handler({ sender: stale }, value)).toEqual({ value })
    expect(registrationState.command).toHaveBeenCalledWith(value)
  })

  it('rolls back partial handler registration without subscribing', () => {
    electron.setFailOn('test:second')
    const subscribeSnapshot = vi.fn()

    expect(() => registerNativeFeatureIpc({
      renderer: fakeRenderer(sender()).renderer,
      authorizationError: 'Unauthorized test IPC sender',
      snapshotChannel: 'test:snapshot',
      commands: [
        { channel: 'test:first', invoke: () => undefined },
        { channel: 'test:second', invoke: () => undefined },
        { channel: 'test:third', invoke: () => undefined }
      ],
      subscribeSnapshot
    })).toThrow('registration failed')
    expect(electron.handlers.size).toBe(0)
    expect(subscribeSnapshot).not.toHaveBeenCalled()
    expect(electron.removeHandler).toHaveBeenCalledWith('test:first')
  })

  it('rejects invalid channel configurations before Electron side effects', () => {
    const subscribeSnapshot = vi.fn()
    for (const commands of [
      [{ channel: '', invoke: () => undefined }],
      [{ channel: 'test:one', invoke: () => undefined }, { channel: 'test:one', invoke: () => undefined }],
      [{ channel: 'test:snapshot', invoke: () => undefined }]
    ]) {
      expect(() => registerNativeFeatureIpc({
        renderer: fakeRenderer(sender()).renderer,
        authorizationError: 'Unauthorized test IPC sender',
        snapshotChannel: 'test:snapshot',
        commands,
        subscribeSnapshot
      })).toThrow(/channel/i)
    }
    expect(electron.handle).not.toHaveBeenCalled()
    expect(subscribeSnapshot).not.toHaveBeenCalled()
  })

  it('rolls back handlers when subscription setup fails', () => {
    expect(() => registerNativeFeatureIpc({
      renderer: fakeRenderer(sender()).renderer,
      authorizationError: 'Unauthorized test IPC sender',
      snapshotChannel: 'test:snapshot',
      commands: [{ channel: 'test:command', invoke: () => undefined }],
      subscribeSnapshot: () => { throw new Error('subscription failed') }
    })).toThrow('subscription failed')
    expect(electron.handlers.size).toBe(0)
    expect(electron.removeHandler).toHaveBeenCalledWith('test:command')
  })

  it('forwards snapshots through the dynamic renderer and stops after disposal', () => {
    const state = registration()
    const first = state.current
    state.snapshotListener()!({ value: 1 })
    expect(state.fake.send).toHaveBeenCalledWith('test:snapshot', { value: 1 })

    const second = sender()
    state.fake.setCurrent(second)
    state.snapshotListener()!({ value: 2 })
    expect(state.fake.send).toHaveBeenLastCalledWith('test:snapshot', { value: 2 })
    expect(first).not.toBe(second)

    state.dispose()
    state.snapshotListener()!({ value: 3 })
    expect(state.fake.send).toHaveBeenCalledTimes(2)
  })

  it('disposes idempotently, preserves first cleanup error, and removes every handler', () => {
    const state = registration({
      commands: [
        { channel: 'test:first', invoke: () => undefined },
        { channel: 'test:second', invoke: () => undefined }
      ]
    })
    state.unsubscribe.mockImplementationOnce(() => { throw new Error('unsubscribe failed') })

    expect(() => state.dispose()).toThrow('unsubscribe failed')
    expect(electron.handlers.size).toBe(0)
    const removals = electron.removeHandler.mock.calls.length
    expect(removals).toBe(2)

    expect(() => state.dispose()).not.toThrow()
    expect(state.unsubscribe).toHaveBeenCalledOnce()
    expect(electron.removeHandler).toHaveBeenCalledTimes(removals)
  })
})
