import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { FeatureId, RendererTarget } from './feature'

export interface NativeFeatureTransport {
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  subscribe(event: string, listener: (payload: unknown, revision: number) => void): () => void
}

export type NativeFeatureDecoder<T> = (payload: unknown) => T

export interface NativeFeaturePort<Snapshot> {
  getSnapshot(): Promise<Snapshot>
  call<Result>(command: string, decode: NativeFeatureDecoder<Result>, params?: Record<string, unknown>): Promise<Result>
  subscribeSnapshot(listener: (snapshot: Snapshot) => void): () => void
}

export class NativeFeaturePayloadError extends Error {
  readonly featureId: FeatureId
  /** Full wire method/event name, for example `bonded.getSnapshot`. */
  readonly operation: string

  constructor(featureId: FeatureId, operation: string, cause: unknown) {
    super(`Invalid native payload for '${operation}': ${sanitizedValidationMessage(cause)}`)
    this.name = 'NativeFeaturePayloadError'
    this.featureId = featureId
    this.operation = operation
  }
}

const COMMAND_SUFFIX = /^[a-z][A-Za-z0-9-]*$/

export function createNativeFeatureAdapter<Snapshot>(
  transport: NativeFeatureTransport,
  options: {
    featureId: FeatureId
    decodeSnapshot: NativeFeatureDecoder<Snapshot>
    onInvalidEvent?: (error: NativeFeaturePayloadError) => void
  }
): NativeFeaturePort<Snapshot> {
  const { featureId, decodeSnapshot } = options
  const method = (command: string): string => {
    if (!COMMAND_SUFFIX.test(command)) throw new TypeError(`Invalid native feature command suffix '${command}'`)
    return `${featureId}.${command}`
  }

  const decodeRequest = async <Result>(operation: string, decode: NativeFeatureDecoder<Result>, params?: Record<string, unknown>): Promise<Result> => {
    const payload = await transport.request(operation, params ?? {})
    try {
      return decode(payload)
    } catch (error) {
      throw new NativeFeaturePayloadError(featureId, operation, error)
    }
  }

  const reportInvalidEvent = (error: NativeFeaturePayloadError): void => {
    try {
      if (options.onInvalidEvent) options.onInvalidEvent(error)
      else console.error(error)
    } catch {
      // An error reporter must not be able to break the native event loop.
    }
  }

  return {
    getSnapshot(): Promise<Snapshot> {
      const operation = `${featureId}.getSnapshot`
      return decodeRequest(operation, decodeSnapshot)
    },
    async call<Result>(command: string, decode: NativeFeatureDecoder<Result>, params?: Record<string, unknown>): Promise<Result> {
      return decodeRequest(method(command), decode, params)
    },
    subscribeSnapshot(listener: (snapshot: Snapshot) => void): () => void {
      const event = `${featureId}.snapshot`
      return transport.subscribe(event, (payload) => {
        let snapshot: Snapshot
        try {
          snapshot = decodeSnapshot(payload)
        } catch (error) {
          reportInvalidEvent(new NativeFeaturePayloadError(featureId, event, error))
          return
        }
        listener(snapshot)
      })
    }
  }
}

export interface NativeFeatureIpcCommand {
  readonly channel: string
  invoke(value: unknown): unknown | Promise<unknown>
}

export interface NativeFeatureIpcOptions<Snapshot> {
  readonly renderer: RendererTarget
  readonly authorizationError: string
  readonly snapshotChannel: string
  readonly commands: readonly NativeFeatureIpcCommand[]
  subscribeSnapshot(listener: (snapshot: Snapshot) => void): () => void
}

export function registerNativeFeatureIpc<Snapshot>(options: NativeFeatureIpcOptions<Snapshot>): () => void {
  validateChannels(options.snapshotChannel, options.commands)

  const registered: string[] = []
  let disposed = false
  let unsubscribe = (): void => undefined
  const authorize = (event: IpcMainInvokeEvent): void => {
    const current = options.renderer.current()
    if (disposed || !current || current.isDestroyed() || event.sender !== current || event.sender.isDestroyed()) {
      throw new Error(options.authorizationError)
    }
  }

  try {
    for (const command of options.commands) {
      ipcMain.handle(command.channel, (event, value: unknown) => {
        authorize(event)
        return command.invoke(value)
      })
      registered.push(command.channel)
    }
    unsubscribe = options.subscribeSnapshot((snapshot) => {
      if (!disposed) options.renderer.send(options.snapshotChannel, snapshot)
    })
  } catch (error) {
    removeHandlers(registered)
    throw error
  }

  let cleaned = false
  return (): void => {
    if (cleaned) return
    cleaned = true
    disposed = true
    let firstError: unknown
    try {
      unsubscribe()
    } catch (error) {
      firstError = error
    }
    const removeError = removeHandlers(registered)
    if (firstError === undefined) firstError = removeError
    if (firstError !== undefined) throw firstError
  }
}

function validateChannels(snapshotChannel: string, commands: readonly NativeFeatureIpcCommand[]): void {
  if (typeof snapshotChannel !== 'string' || snapshotChannel.trim() === '') throw new TypeError('Native feature snapshot channel must not be empty')
  const seen = new Set<string>([snapshotChannel])
  for (const command of commands) {
    if (typeof command.channel !== 'string' || command.channel.trim() === '') throw new TypeError('Native feature IPC channel must not be empty')
    if (seen.has(command.channel)) throw new TypeError(`Duplicate native feature IPC channel '${command.channel}'`)
    seen.add(command.channel)
  }
}

function removeHandlers(channels: readonly string[]): unknown {
  let firstError: unknown
  for (const channel of channels) {
    try {
      ipcMain.removeHandler(channel)
    } catch (error) {
      if (firstError === undefined) firstError = error
    }
  }
  return firstError
}

interface DecoderIssue {
  readonly code?: unknown
  readonly path?: unknown
  readonly expected?: unknown
}

function sanitizedValidationMessage(cause: unknown): string {
  if (!cause || typeof cause !== 'object') return 'decoder rejected the native payload'
  const issues = (cause as { issues?: unknown }).issues
  if (!Array.isArray(issues)) return 'decoder rejected the native payload'
  const messages = issues.slice(0, 5).map(formatIssue)
  return messages.length > 0 ? messages.join('; ') : 'decoder rejected the native payload'
}

function formatIssue(value: unknown): string {
  if (!value || typeof value !== 'object') return 'payload: schema validation failed'
  const issue = value as DecoderIssue
  const path = safePath(issue.path)
  const expected = typeof issue.expected === 'string' ? issue.expected : typeof issue.code === 'string' ? issue.code : 'schema validation'
  return `${path}: expected ${expected}`
}

function safePath(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return 'payload'
  return value.map((segment) => typeof segment === 'number' ? '[index]' : '<field>').join('.')
}
