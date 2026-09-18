import { describe, expect, it } from 'vitest'
import {
  NATIVE_MAX_MESSAGE_BYTES,
  NATIVE_PROTOCOL_VERSION,
  decodeNativeHostMessage,
  encodeNativeHostMessage,
  nativeHostEventSchema,
  nativeHostRequest,
  nativeHostResponseSchema
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

    const event = { version: NATIVE_PROTOCOL_VERSION, event: 'host.snapshotChanged', revision: 4, payload: { features: [] } }
    expect(nativeHostEventSchema.parse(event)).toEqual(event)
    expect(decodeNativeHostMessage(encodeNativeHostMessage(event))).toEqual(event)
  })

  it('rejects malformed, version-mismatched, and unknown-field messages', () => {
    expect(() => decodeNativeHostMessage('{')).toThrow()
    expect(() => decodeNativeHostMessage(JSON.stringify({ version: 2, id: crypto.randomUUID(), method: 'host.getSnapshot', params: {} }))).toThrow()
    expect(() => decodeNativeHostMessage(JSON.stringify({ version: 1, id: crypto.randomUUID(), method: 'host.getSnapshot', params: {}, extra: true }))).toThrow()
  })

  it('enforces the one MiB encoded message limit', () => {
    const request = nativeHostRequest('host.setUiState', { payload: 'x'.repeat(NATIVE_MAX_MESSAGE_BYTES) })
    expect(() => encodeNativeHostMessage(request)).toThrow(/1 MiB/)
    expect(() => decodeNativeHostMessage('x'.repeat(NATIVE_MAX_MESSAGE_BYTES + 1))).toThrow(/1 MiB/)
  })
})
