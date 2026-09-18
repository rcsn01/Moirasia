import { createConnection, type Socket } from 'node:net'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import {
  decodeNativeHostMessage,
  encodeNativeHostMessage,
  isNativeHostEvent,
  isNativeHostResponse,
  nativeHostRequest,
  type NativeHostClientLike,
  type NativeHostMethod,
  type NativeHostResponse,
  type NativeHostMessage
} from '../../shared/native-host-contracts'

interface PendingRequest {
  readonly method: string
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

export interface NativeHostClientOptions {
  readonly socketPath: string
  readonly tokenPath: string
  readonly timeoutMs?: number
}

/** Authenticated, single-connection client for the native suite host. */
export class NativeHostClient implements NativeHostClientLike {
  #socket: Socket | undefined
  #buffer = ''
  #nextRequest = new Map<string, PendingRequest>()
  #listeners = new Map<string, Set<(payload: unknown, revision: number) => void>>()
  #connecting: Promise<void> | undefined
  #closed = false
  #authenticated = false
  #revision = 0
  readonly #timeoutMs: number

  constructor(private readonly options: NativeHostClientOptions) {
    this.#timeoutMs = options.timeoutMs ?? 5_000
  }

  isConnected(): boolean { return Boolean(this.#socket && !this.#socket.destroyed && this.#authenticated) }

  async connect(): Promise<void> {
    if (this.#closed) throw new Error('Native host client is closed')
    if (this.isConnected()) return
    if (this.#connecting) return this.#connecting
    this.#connecting = this.#connect().finally(() => { this.#connecting = undefined })
    return this.#connecting
  }

  close(): void {
    this.#closed = true
    this.#socket?.destroy()
    this.#socket = undefined
    this.#authenticated = false
    this.#rejectPending(new Error('Native host client closed'))
  }

  async request<T = unknown>(method: NativeHostMethod | string, params: Record<string, unknown> = {}): Promise<T> {
    const readOnly = method === 'host.getSnapshot'
    try {
      await this.connect()
      return await this.#requestOnce<T>(method, params)
    } catch (error) {
      if (!readOnly || this.#closed) throw error
      await this.#resetConnection()
      await this.connect()
      return this.#requestOnce<T>(method, params)
    }
  }

  subscribe(event: string, listener: (payload: unknown, revision: number) => void): () => void {
    const listeners = this.#listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.#listeners.set(event, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.#listeners.delete(event)
    }
  }

  async #connect(): Promise<void> {
    const token = (await readFile(this.options.tokenPath, 'utf8')).trim()
    if (!token || token.length > 512) throw new Error('Native host authentication token is unavailable')
    const socket = createConnection(this.options.socketPath)
    this.#socket = socket
    this.#buffer = ''
    this.#authenticated = false
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => this.#acceptData(chunk))
    socket.once('error', (error) => this.#handleDisconnect(error))
    socket.once('close', () => this.#handleDisconnect(new Error('Native host connection closed')))
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('Native host connection timed out')) }, this.#timeoutMs)
      socket.once('connect', () => { clearTimeout(timer); resolve() })
      socket.once('error', (error) => { clearTimeout(timer); reject(error) })
    })
    const response = await this.#requestOnce<unknown>('host.authenticate', { token })
    if (!response || typeof response !== 'object' || (response as { authenticated?: unknown }).authenticated !== true) {
      socket.destroy()
      throw new Error('Native host authentication failed')
    }
    this.#authenticated = true
  }

  #requestOnce<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const socket = this.#socket
    if (!socket || socket.destroyed) return Promise.reject(new Error('Native host is not connected'))
    const message = nativeHostRequest(method, params)
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#nextRequest.delete(message.id)
        reject(new Error(`Native host request '${method}' timed out`))
      }, this.#timeoutMs)
      this.#nextRequest.set(message.id, { method, resolve: (value) => resolve(value as T), reject, timer })
      try { socket.write(encodeNativeHostMessage(message)) }
      catch (error) {
        clearTimeout(timer)
        this.#nextRequest.delete(message.id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  #acceptData(chunk: string): void {
    this.#buffer += chunk
    if (new TextEncoder().encode(this.#buffer).byteLength > 2 * 1024 * 1024) {
      this.#socket?.destroy(new Error('Native host input buffer exceeded the limit'))
      return
    }
    let newline = this.#buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline).replace(/\r$/, '')
      this.#buffer = this.#buffer.slice(newline + 1)
      if (line.length > 0) this.#acceptLine(line)
      newline = this.#buffer.indexOf('\n')
    }
  }

  #acceptLine(line: string): void {
    let message: NativeHostMessage
    try { message = decodeNativeHostMessage(line) }
    catch (error) { this.#socket?.destroy(error instanceof Error ? error : new Error(String(error))); return }
    if (isNativeHostEvent(message)) {
      if (message.revision < this.#revision) return
      this.#revision = message.revision
      for (const listener of this.#listeners.get(message.event) ?? []) listener(message.payload, message.revision)
      return
    }
    if (!isNativeHostResponse(message)) return
    const pending = this.#nextRequest.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.#nextRequest.delete(message.id)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(`${message.error.code}: ${message.error.message}`))
  }

  #handleDisconnect(error: Error): void {
    if (this.#socket && !this.#socket.destroyed) return
    this.#socket = undefined
    this.#authenticated = false
    this.#buffer = ''
    this.#rejectPending(error)
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#nextRequest.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#nextRequest.clear()
  }

  async #resetConnection(): Promise<void> {
    this.#socket?.destroy()
    this.#socket = undefined
    this.#authenticated = false
    this.#buffer = ''
    await new Promise((resolve) => setImmediate(resolve))
  }
}

export function nativeHostClientId(): string { return randomUUID() }
