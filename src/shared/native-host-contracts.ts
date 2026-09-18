import { z } from 'zod'
import type { AppPresenceMode, ControllerPage, ShellSettings } from './contracts'
import type { AppearanceSnapshot } from '@moirasia/desktop-shell'
import type { FeatureId } from '@moirasia/desktop-shell/feature'
import type { BondedSnapshot } from '../../apps/integrated/Bonded/src/shared/contracts'
import type { ShoutSnapshot } from '../../apps/integrated/Shout/src/shared/contracts'
import type { MainState as AmoveMainState } from '../../apps/integrated/Amove/src/shared/contracts'

export const NATIVE_PROTOCOL_VERSION = 1 as const
export const NATIVE_MAX_MESSAGE_BYTES = 1024 * 1024

export const nativeFeatureStateSchema = z.enum(['stopped', 'starting', 'running', 'error'])
export type NativeFeatureState = z.infer<typeof nativeFeatureStateSchema>

export const nativeFeatureStatusSchema = z.object({
  id: z.enum(['amove', 'bonded', 'shout']),
  installed: z.boolean(),
  state: nativeFeatureStateSchema,
  error: z.string().max(4_096).optional()
}).strict()
export type NativeFeatureStatus = z.infer<typeof nativeFeatureStatusSchema>

export const nativeHostSnapshotSchema = z.object({
  version: z.literal(NATIVE_PROTOCOL_VERSION),
  revision: z.number().int().nonnegative(),
  settings: z.custom<ShellSettings>(),
  appearances: z.custom<AppearanceSnapshot>(),
  features: z.array(nativeFeatureStatusSchema),
  bonded: z.custom<BondedSnapshot>().optional(),
  shout: z.custom<ShoutSnapshot>().optional(),
  amove: z.custom<AmoveMainState>().optional()
}).strict()
export type NativeHostSnapshot = z.infer<typeof nativeHostSnapshotSchema>

export const nativeHostErrorSchema = z.object({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(4_096)
}).strict()
export type NativeHostError = z.infer<typeof nativeHostErrorSchema>

export const nativeHostRequestSchema = z.object({
  version: z.literal(NATIVE_PROTOCOL_VERSION),
  id: z.string().uuid(),
  method: z.string().regex(/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9-]*)+$/).max(128),
  params: z.record(z.string(), z.unknown())
}).strict()
export type NativeHostRequest = z.infer<typeof nativeHostRequestSchema>

export const nativeHostResponseSchema = z.discriminatedUnion('ok', [
  z.object({ version: z.literal(NATIVE_PROTOCOL_VERSION), id: z.string().uuid(), ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ version: z.literal(NATIVE_PROTOCOL_VERSION), id: z.string().uuid(), ok: z.literal(false), error: nativeHostErrorSchema }).strict()
])
export type NativeHostResponse = z.infer<typeof nativeHostResponseSchema>

export const nativeHostEventSchema = z.object({
  version: z.literal(NATIVE_PROTOCOL_VERSION),
  event: z.string().regex(/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9-]*)+$/).max(128),
  revision: z.number().int().nonnegative(),
  payload: z.unknown()
}).strict()
export type NativeHostEvent = z.infer<typeof nativeHostEventSchema>

export const nativeHostMessageSchema = z.union([nativeHostRequestSchema, nativeHostResponseSchema, nativeHostEventSchema])
export type NativeHostMessage = z.infer<typeof nativeHostMessageSchema>

export interface NativeHostConnectionOptions {
  readonly socketPath: string
  readonly tokenPath: string
  readonly timeoutMs?: number
  connect?(): Promise<void>
  request?(message: NativeHostRequest): Promise<NativeHostResponse>
}

export type NativeHostReadMethod = 'host.getSnapshot'
export type NativeHostMutationMethod =
  | 'host.setPresence'
  | 'host.setLaunchAtLogin'
  | 'host.setFeatureInstalled'
  | 'host.retryFeature'
  | 'host.quitSuite'
  | 'host.setUiState'
  | 'bonded.setMonitoring'
  | 'bonded.installFirewallHelper'
  | 'bonded.uninstallFirewallHelper'
  | 'bonded.setBlocking'
  | 'bonded.selectObservedApplication'
  | 'bonded.removeApplicationRule'
  | 'bonded.restartMonitor'
  | 'shout.setBoost'
  | 'shout.setGain'
  | 'shout.setLimiter'
  | 'shout.setMakeDefaultInput'
  | 'shout.setSource'
  | 'shout.installDriver'
  | 'amove.performAction'
  | 'amove.recordShortcut'
  | 'amove.setShortcutRecording'
  | 'amove.resetShortcut'
  | 'amove.setPresence'
  | 'amove.refreshAccessibility'
  | 'amove.requestAccessibility'
  | 'amove.openAccessibilitySettings'
  | 'amove.showShelf'
  | 'amove.cancelShelf'
export type NativeHostMethod = NativeHostReadMethod | NativeHostMutationMethod

export interface NativeHostClientLike {
  connect(): Promise<void>
  close(): void
  request<T = unknown>(method: NativeHostMethod | string, params?: Record<string, unknown>): Promise<T>
  subscribe(event: string, listener: (payload: unknown, revision: number) => void): () => void
  isConnected(): boolean
}

export function nativeHostRequest(method: string, params: Record<string, unknown> = {}): NativeHostRequest {
  return { version: NATIVE_PROTOCOL_VERSION, id: crypto.randomUUID(), method, params }
}

export function encodeNativeHostMessage(message: NativeHostRequest | NativeHostResponse | NativeHostEvent): string {
  const encoded = JSON.stringify(message)
  const bytes = new TextEncoder().encode(encoded).byteLength
  if (bytes > NATIVE_MAX_MESSAGE_BYTES) throw new RangeError('Native host message exceeds the 1 MiB limit')
  return `${encoded}\n`
}

export function decodeNativeHostMessage(line: string): NativeHostMessage {
  if (new TextEncoder().encode(line).byteLength > NATIVE_MAX_MESSAGE_BYTES) throw new RangeError('Native host message exceeds the 1 MiB limit')
  return nativeHostMessageSchema.parse(JSON.parse(line))
}

export function isNativeHostEvent(message: NativeHostMessage): message is NativeHostEvent {
  return 'event' in message
}

export function isNativeHostResponse(message: NativeHostMessage): message is NativeHostResponse {
  return 'ok' in message
}

export type NativeHostUiState = {
  readonly processIds?: readonly number[]
  readonly mainFocused?: boolean
  readonly shelfVisible?: boolean
  readonly shortcutRecording?: boolean
  readonly page?: ControllerPage
}

export type NativeHostPresenceParams = { readonly mode: AppPresenceMode }
export type NativeHostFeatureParams = { readonly id: FeatureId; readonly installed: boolean }
