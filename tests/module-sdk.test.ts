import { describe, expect, it, vi } from 'vitest'
import { ResourceLedger, isHostApiCompatible, validateManifest } from '@moirasia/module-sdk'
import { ShortcutConflictError, ShortcutRegistry } from '../src/main/modules/shortcut-registry'

const manifest = {
  manifestVersion: 1,
  id: 'amove',
  name: 'Amove',
  version: '1.0.0',
  application: { bundleId: 'com.opense.Amove' },
  hostApi: { min: '0.1.0', maxExclusive: '0.2.0' },
  kind: 'web',
  entrypoints: { main: 'main/index.mjs', preload: 'preload/index.cjs', renderer: 'renderer/index.html' },
  capabilities: ['global-shortcuts', 'utility-windows'],
  data: { owner: 'com.opense.Amove', supportDirectory: 'Amove', lockName: 'amove' },
  payload: { sha256: 'a'.repeat(64) }
}

describe('module SDK', () => {
  it('validates a V1 manifest and compatible host range', () => {
    const parsed = validateManifest(manifest)
    expect(parsed.id).toBe('amove')
    expect(isHostApiCompatible(parsed, '0.1.0')).toBe(true)
    expect(isHostApiCompatible(parsed, '0.2.0')).toBe(false)
  })

  it.each(['../outside.mjs', '/tmp/outside.mjs', 'main/../outside.mjs', 'main\\index.mjs'])(
    'rejects unsafe entrypoint %s', (main) => {
      expect(() => validateManifest({ ...manifest, entrypoints: { ...manifest.entrypoints, main } })).toThrow(/path|escapes|normalized/)
    }
  )

  it('rejects unknown fields and invalid payload hashes', () => {
    expect(() => validateManifest({ ...manifest, surprise: true })).toThrow('unknown manifest field')
    expect(() => validateManifest({ ...manifest, payload: { sha256: 'nope' } })).toThrow('SHA-256')
  })

  it('cleans resources in reverse order, remains idempotent, and aggregates failures', async () => {
    const calls: string[] = []
    const ledger = new ResourceLedger()
    ledger.track(() => { calls.push('first') }, 'first')
    ledger.track(() => { calls.push('second'); throw new Error('broken') }, 'second')
    await expect(ledger.cleanup()).rejects.toThrow('Module resource cleanup failed')
    expect(calls).toEqual(['second', 'first'])
    await expect(ledger.cleanup()).resolves.toBeUndefined()
    expect(ledger.size).toBe(0)
  })
})

describe('ShortcutRegistry', () => {
  it('reports a typed cross-module conflict and releases ownership', () => {
    const backend = { register: vi.fn(() => true), unregister: vi.fn() }
    const registry = new ShortcutRegistry(backend)
    const release = registry.register('amove', 'CommandOrControl+Shift+Space', vi.fn())
    expect(() => registry.register('vox', 'CommandOrControl+Shift+Space', vi.fn())).toThrow(ShortcutConflictError)
    release()
    expect(() => registry.register('vox', 'CommandOrControl+Shift+Space', vi.fn())).not.toThrow()
  })
})
