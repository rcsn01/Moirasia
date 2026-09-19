import { z } from 'zod'
import type { AppPresenceMode, ControllerPage, ShellSettings } from './contracts'
import type { FeatureId } from '@moirasia/desktop-shell/feature'

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

const nativeShellSettingsSchema = z.object({
  version: z.literal(4),
  launchAtLogin: z.boolean(),
  appPresence: z.enum(['dock', 'menu-bar']),
  pendingLoginItems: z.record(z.string(), z.literal(true)),
  features: z.record(z.string(), z.boolean())
}).strict()

const completeNativeFeatureStatusSchema = z.array(nativeFeatureStatusSchema).superRefine((features, context) => {
  const expected = new Set(['amove', 'bonded', 'shout'])
  const seen = new Set<string>()
  for (const feature of features) {
    if (seen.has(feature.id)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate feature status '${feature.id}'.` })
    seen.add(feature.id)
  }
  for (const id of expected) {
    if (!seen.has(id)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Missing feature status '${id}'.` })
  }
})

/** Strict host bootstrap envelope. Product snapshots remain opaque here and are decoded by product adapters. */
export const nativeHostSnapshotSchema = z.object({
  version: z.literal(NATIVE_PROTOCOL_VERSION),
  revision: z.number().int().nonnegative(),
  settings: nativeShellSettingsSchema,
  features: completeNativeFeatureStatusSchema,
  bonded: z.unknown().optional(),
  shout: z.unknown().optional(),
  amove: z.unknown().optional()
}).strict()
export type NativeHostSnapshot = z.infer<typeof nativeHostSnapshotSchema> & { readonly settings: ShellSettings }

export const nativeFeatureServiceStateSchema = z.enum(['starting', 'running', 'error', 'stopped'])
export type NativeFeatureServiceState = z.infer<typeof nativeFeatureServiceStateSchema>

export const nativeFeatureServiceHealthSchema = z.object({
  state: nativeFeatureServiceStateSchema,
  error: z.string().max(4_096).optional(),
  restartCount: z.number().int().nonnegative()
}).strict().superRefine((health, context) => {
  if (health.state === 'error' && health.error === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['error'], message: 'Error health state requires an error message.' })
  if (health.state !== 'error' && health.error !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['error'], message: 'Only error health state may include an error message.' })
})
export type NativeFeatureServiceHealth = z.infer<typeof nativeFeatureServiceHealthSchema>

const nativeLegacyFeatureServiceHealthSchema = z.object({ featureService: z.literal('error') }).strict()
const nativeStructuredFeatureServiceHealthSchema = z.object({ featureService: nativeFeatureServiceHealthSchema }).strict()

export const nativeHostSnapshotChangedPayloadSchema = z.union([
  nativeHostSnapshotSchema,
  nativeStructuredFeatureServiceHealthSchema,
  nativeLegacyFeatureServiceHealthSchema
])
export type NativeHostSnapshotChangedPayload = z.infer<typeof nativeHostSnapshotChangedPayloadSchema>

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

export const nativeHostSnapshotChangedEventSchema = nativeHostEventSchema.extend({
  event: z.literal('host.snapshotChanged'),
  payload: nativeHostSnapshotChangedPayloadSchema
})

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

export type NativeHostConnectionState = 'connected' | 'reconnected' | 'disconnected'
export interface NativeHostConnectionEvent {
  readonly state: NativeHostConnectionState
  readonly generation: number
  readonly error?: Error
}

export interface NativeHostClientLike {
  connect(): Promise<void>
  close(): void
  request<T = unknown>(method: NativeHostMethod | string, params?: Record<string, unknown>): Promise<T>
  subscribe(event: string, listener: (payload: unknown, revision: number) => void): () => void
  subscribeConnection?(listener: (event: NativeHostConnectionEvent) => void): () => void
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
  const message = nativeHostMessageSchema.parse(JSON.parse(line))
  if (isNativeHostEvent(message) && message.event === 'host.snapshotChanged') nativeHostSnapshotChangedEventSchema.parse(message)
  return message
}

export function normalizeNativeHostSnapshotChangedPayload(value: unknown): NativeHostSnapshotChangedPayload {
  const payload = nativeHostSnapshotChangedPayloadSchema.parse(value)
  if (isLegacyFeatureServiceHealth(payload)) return { featureService: { state: 'error', error: 'MoirasiaFeatureService is unavailable.', restartCount: 0 } }
  return payload
}

export function isNativeHostEvent(message: NativeHostMessage): message is NativeHostEvent {
  return 'event' in message
}

export function isNativeHostResponse(message: NativeHostMessage): message is NativeHostResponse {
  return 'ok' in message
}

export function isNativeHostSnapshot(value: unknown): value is NativeHostSnapshot {
  return nativeHostSnapshotSchema.safeParse(value).success
}

export function isNativeHostHealth(value: unknown): value is { readonly featureService: NativeFeatureServiceHealth } {
  return nativeStructuredFeatureServiceHealthSchema.safeParse(value).success
}

function isLegacyFeatureServiceHealth(value: NativeHostSnapshotChangedPayload): value is { readonly featureService: 'error' } {
  return 'featureService' in value && value.featureService === 'error'
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
