import { describe, expect, it } from 'vitest'
import {
  NATIVE_MAX_MESSAGE_BYTES,
  NATIVE_PROTOCOL_VERSION,
  decodeNativeHostMessage,
  encodeNativeHostMessage,
  nativeHostEventSchema,
  nativeHostRequest,
  nativeHostResponseSchema,
  nativeHostSnapshotChangedPayloadSchema,
  nativeHostSnapshotSchema
} from '../src/shared/native-host-contracts'

describe('native host protocol contracts', () => {
  it('round-trips requests, successful responses, errors, and events', () => {
    const request = nativeHostRequest('host.getSnapshot')
    expect(decodeNativeHostMessage(encodeNativeHostMessage(request))).toEqual(request)

    const response = { version: NATIVE_PROTOCOL_VERSION, id: request.id, ok: true as const, result: { ready: true } }
    expect(nativeHostResponseSchema.parse(response)).toEqual(response)
    expect(decodeNativeHostMessage(encodeNativeHostMessage(response))).toEqual(response)

    const failure = { version: NATIVE_PROTOCOL_VERSION, id: request.id, ok: false as const, error: { code: 'unavailable', message: 'not running' } }
    expect(decodeNativeHostMessage(encodeNativeHostMessage(failure))).toEqual(failure)

    const snapshot = {
      version: NATIVE_PROTOCOL_VERSION,
      revision: 4,
      settings: { version: 4, launchAtLogin: false, appPresence: 'menu-bar', pendingLoginItems: {}, features: {} },
      features: [
        { id: 'amove', installed: true, state: 'running' },
        { id: 'bonded', installed: false, state: 'stopped' },
        { id: 'shout', installed: true, state: 'error', error: 'driver unavailable' }
      ],
      amove: { version: 1 },
      bonded: { version: 1 },
      shout: { version: 1 }
    }
    expect(nativeHostSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    const event = { version: NATIVE_PROTOCOL_VERSION, event: 'host.snapshotChanged', revision: 4, payload: snapshot }
    expect(nativeHostEventSchema.parse(event)).toEqual(event)
    expect(decodeNativeHostMessage(encodeNativeHostMessage(event))).toEqual(event)
    expect(nativeHostSnapshotChangedPayloadSchema.parse({ featureService: { state: 'error', error: 'service exited', restartCount: 1 } })).toEqual({ featureService: { state: 'error', error: 'service exited', restartCount: 1 } })
    expect(nativeHostSnapshotChangedPayloadSchema.parse({ featureService: 'error' })).toEqual({ featureService: 'error' })
    expect(() => nativeHostSnapshotChangedPayloadSchema.parse({ settings: snapshot.settings })).toThrow()
  })

  it('rejects malformed, version-mismatched, and unknown-field messages', () => {
    expect(() => decodeNativeHostMessage('{')).toThrow()
    expect(() => decodeNativeHostMessage(JSON.stringify({ version: 2, id: crypto.randomUUID(), method: 'host.getSnapshot', params: {} }))).toThrow()
    expect(() => decodeNativeHostMessage(JSON.stringify({ version: 1, id: crypto.randomUUID(), method: 'host.getSnapshot', params: {}, extra: true }))).toThrow()
  })

  it('rejects duplicate or incomplete feature status lists', () => {
    const settings = { version: 4, launchAtLogin: false, appPresence: 'dock', pendingLoginItems: {}, features: {} }
    const base = { version: NATIVE_PROTOCOL_VERSION, revision: 0, settings, features: [
      { id: 'amove', installed: false, state: 'stopped' },
      { id: 'bonded', installed: false, state: 'stopped' },
      { id: 'shout', installed: false, state: 'stopped' }
    ] }
    expect(() => nativeHostSnapshotSchema.parse({ ...base, features: [...base.features, base.features[0]] })).toThrow()
    expect(() => nativeHostSnapshotSchema.parse({ ...base, features: base.features.slice(0, 2) })).toThrow()
  })

  it('enforces the one MiB encoded message limit', () => {
    const request = nativeHostRequest('host.setUiState', { payload: 'x'.repeat(NATIVE_MAX_MESSAGE_BYTES) })
    expect(() => encodeNativeHostMessage(request)).toThrow(/1 MiB/)
    expect(() => decodeNativeHostMessage('x'.repeat(NATIVE_MAX_MESSAGE_BYTES + 1))).toThrow(/1 MiB/)
  })
})
