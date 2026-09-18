import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { moirasiaHostSocketPath } from '../src/main/paths'

describe('moirasiaHostSocketPath', () => {
  it('mirrors the Swift MoirasiaProtocol endpoint (pinned hash ba7816bf8f01cfea for "abc")', () => {
    expect(moirasiaHostSocketPath('abc')).toBe(`${tmpdir().replace(/\/+$/, '')}/moirasia-host-ba7816bf8f01cfea.sock`)
  })

  it('keeps a deeply nested userData socket path far below the 104-byte sun_path limit', () => {
    const longUserData = `${tmpdir()}/${'deep/'.repeat(12)}moirasia-user-data-with-a-very-long-path-segment`
    const socketPath = moirasiaHostSocketPath(longUserData)
    expect(socketPath.length + 1).toBeLessThanOrEqual(104)
  })

  it('differs per userData so concurrent suites cannot collide', () => {
    expect(moirasiaHostSocketPath('/tmp/one')).not.toBe(moirasiaHostSocketPath('/tmp/two'))
  })
})