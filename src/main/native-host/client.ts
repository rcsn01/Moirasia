import { createConnection, type Socket } from 'node:net'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import {
  decodeNativeHostMessage,
  encodeNativeHostMessage,
  isNativeHostEvent,
  isNativeHostResponse,
  isNativeHostSnapshot,
  nativeHostRequest,
  normalizeNativeHostSnapshotChangedPayload,
  type NativeHostClientLike,
  type NativeHostConnectionEvent,
  type NativeHostMethod,
  type NativeHostMessage,
  type NativeHostSnapshot
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
  #connectionListeners = new Set<(event: NativeHostConnectionEvent) => void>()
  #connecting: Promise<void> | undefined
  #closed = false
  #authenticated = false
  #revision = 0
  #generation = 0
  #awaitingFullSnapshot = false
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
    if (this.#closed) return
    this.#closed = true
    const socket = this.#socket
    this.#socket = undefined
    this.#authenticated = false
    this.#buffer = ''
    this.#awaitingFullSnapshot = false
    socket?.destroy()
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

  /** Typed decode of the host's bootstrap snapshot over the same request path (read-only retry included). */
  async getSnapshot(): Promise<NativeHostSnapshot | undefined> {
    const result = await this.request('host.getSnapshot')
    return isNativeHostSnapshot(result) ? result : undefined
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

  subscribeConnection(listener: (event: NativeHostConnectionEvent) => void): () => void {
    this.#connectionListeners.add(listener)
    return () => this.#connectionListeners.delete(listener)
  }

  /** Alias for callers that prefer an event-style name. */
  onConnectionState(listener: (event: NativeHostConnectionEvent) => void): () => void {
    return this.subscribeConnection(listener)
  }

  async #connect(): Promise<void> {
    const token = (await readFile(this.options.tokenPath, 'utf8')).trim()
    if (!token || token.length > 512) throw new Error('Native host authentication token is unavailable')
    const socket = createConnection(this.options.socketPath)
    const generation = ++this.#generation
    this.#socket = socket
    this.#buffer = ''
    this.#authenticated = false
    this.#revision = 0
    this.#awaitingFullSnapshot = true
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => this.#acceptData(chunk, socket))
    socket.once('error', (error) => this.#handleDisconnect(socket, error))
    socket.once('close', () => this.#handleDisconnect(socket, new Error('Native host connection closed')))
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
    if (this.#socket !== socket || this.#closed) throw new Error('Native host disconnected during authentication')
    this.#authenticated = true
    this.#emitConnection({ state: generation === 1 ? 'connected' : 'reconnected', generation })
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

  #acceptData(chunk: string, socket: Socket): void {
    if (this.#closed || this.#socket !== socket) return
    this.#buffer += chunk
    if (new TextEncoder().encode(this.#buffer).byteLength > 2 * 1024 * 1024) {
      socket.destroy(new Error('Native host input buffer exceeded the limit'))
      return
    }
    let newline = this.#buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline).replace(/\r$/, '')
      this.#buffer = this.#buffer.slice(newline + 1)
      if (line.length > 0) this.#acceptLine(line, socket)
      newline = this.#buffer.indexOf('\n')
    }
  }

  #acceptLine(line: string, socket: Socket): void {
    if (this.#closed || this.#socket !== socket) return
    let message: NativeHostMessage
    try { message = decodeNativeHostMessage(line) }
    catch (error) { socket.destroy(error instanceof Error ? error : new Error(String(error))); return }
    if (isNativeHostEvent(message)) {
      this.#acceptEvent(message)
      return
    }
    if (!isNativeHostResponse(message)) return
    const pending = this.#nextRequest.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.#nextRequest.delete(message.id)
    if (message.ok) {
      if (pending.method === 'host.getSnapshot' && isNativeHostSnapshot(message.result)) {
        this.#awaitingFullSnapshot = false
        this.#revision = Math.max(this.#revision, message.result.revision)
      }
      pending.resolve(message.result)
    } else pending.reject(new Error(`${message.error.code}: ${message.error.message}`))
  }

  #acceptEvent(message: Extract<NativeHostMessage, { event: string }>): void {
    let payload = message.payload
    let fullSnapshot = false
    let health = false
    if (message.event === 'host.snapshotChanged') {
      try { payload = normalizeNativeHostSnapshotChangedPayload(payload) }
      catch (error) {
        this.#socket?.destroy(error instanceof Error ? error : new Error(String(error)))
        return
      }
      fullSnapshot = isNativeHostSnapshot(payload)
      health = !fullSnapshot
    }
    if (this.#awaitingFullSnapshot && !fullSnapshot) {
      if (health) this.#notify(message.event, payload, message.revision)
      return
    }
    if (message.revision < this.#revision) return
    this.#revision = message.revision
    if (fullSnapshot) this.#awaitingFullSnapshot = false
    this.#notify(message.event, payload, message.revision)
  }

  #notify(event: string, payload: unknown, revision: number): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(payload, revision)
  }

  #handleDisconnect(socket: Socket, error: Error): void {
    if (this.#socket !== socket) return
    const wasAuthenticated = this.#authenticated
    this.#socket = undefined
    this.#authenticated = false
    this.#buffer = ''
    this.#awaitingFullSnapshot = false
    this.#rejectPending(error)
    if (wasAuthenticated && !this.#closed) this.#emitConnection({ state: 'disconnected', generation: this.#generation, error })
  }

  #emitConnection(event: NativeHostConnectionEvent): void {
    for (const listener of this.#connectionListeners) listener(event)
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
    this.#revision = 0
    this.#awaitingFullSnapshot = false
    await new Promise((resolve) => setImmediate(resolve))
  }
}

export function nativeHostClientId(): string { return randomUUID() }
