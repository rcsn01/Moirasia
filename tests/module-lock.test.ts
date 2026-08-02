import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireModuleLock } from '../src/main/module-lock'

describe('acquireModuleLock', () => {
  it('acquires and releases a module lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moirasia-locks-'))
    const first = await acquireModuleLock(root, 'amove')
    await first.release()
    const second = await acquireModuleLock(root, 'amove')
    await second.release()
  })

  it('rejects a second lock while the first owner is alive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moirasia-locks-'))
    const first = await acquireModuleLock(root, 'vox')
    await expect(acquireModuleLock(root, 'vox')).rejects.toThrow(/open in Moirasia/)
    await first.release()
  })

  it('recovers a stale lock whose owner PID is dead', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moirasia-locks-'))
    const lockPath = join(root, 'exithibition', '.moirasia-data.lock')
    await mkdir(lockPath, { recursive: true })
    await writeFile(join(lockPath, 'owner.json'), JSON.stringify({
      version: 1,
      pid: 1_000_000_001,
      token: 'stale-token',
      productId: 'exithibition',
      mode: 'module',
      hostBundleId: 'com.moirasia.desktop',
      createdAt: new Date().toISOString()
    }))

    const recovered = await acquireModuleLock(root, 'exithibition')
    await recovered.release()
  })
})
