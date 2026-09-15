import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireRuntimeLease, RuntimeLeaseInUseError, type RuntimeLeaseDependencies, type RuntimeLeaseOptions } from '../packages/desktop-shell/src/runtime-lease'

const temporary: string[] = []
const lockName = 'shout-runtime.lock'
const hosts = ['Shout', 'Moirasia'] as const

const lock = (root: string, name = lockName): string => join(root, 'Moirasia', name)

function leaseOptions(host: (typeof hosts)[number], dependencies: Partial<RuntimeLeaseDependencies> = {}, name = lockName): RuntimeLeaseOptions {
  return {
    lockName: name,
    host,
    hosts,
    dependencies: { delay: async () => undefined, ...dependencies }
  }
}

function dead(): never {
  throw Object.assign(new Error('dead'), { code: 'ESRCH' })
}

afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'runtime-lease-'))
  temporary.push(path)
  return path
}

describe('runtime lease', () => {
  it('rejects a second live owner in both host directions and permits acquisition after release', async () => {
    const root = await directory()
    const first = await acquireRuntimeLease(root, leaseOptions('Moirasia', { probe: () => undefined }))

    const firstError = await acquireRuntimeLease(root, leaseOptions('Shout', { probe: () => undefined })).catch((error: unknown) => error)
    expect(firstError).toBeInstanceOf(RuntimeLeaseInUseError)
    expect((firstError as RuntimeLeaseInUseError).owner?.host).toBe('Moirasia')
    expect((firstError as RuntimeLeaseInUseError).message).toBe('Shout is already in use by Moirasia. Quit Moirasia, then try again.')

    await first.release()
    const second = await acquireRuntimeLease(root, leaseOptions('Shout', { probe: () => undefined }))
    const reverseError = await acquireRuntimeLease(root, leaseOptions('Moirasia', { probe: () => undefined })).catch((error: unknown) => error)
    expect(reverseError).toBeInstanceOf(RuntimeLeaseInUseError)
    expect((reverseError as RuntimeLeaseInUseError).owner?.host).toBe('Shout')
    await second.release()
  })

  it('recovers a stale owner in place and leaves no recovery marker', async () => {
    const root = await directory()
    await mkdir(lock(root), { recursive: true })
    await writeFile(join(lock(root), 'owner.json'), JSON.stringify({ version: 1, pid: 2_147_483_647, host: 'Shout', token: 'stale' }))

    const lease = await acquireRuntimeLease(root, leaseOptions('Moirasia', { pid: 4_242, probe: dead }))
    const owner = JSON.parse(await readFile(join(lock(root), 'owner.json'), 'utf8')) as Record<string, unknown>
    expect(owner).toMatchObject({ version: 1, pid: 4_242, host: 'Moirasia' })
    expect(await readFile(join(lock(root), 'recovery.json'), 'utf8').catch(() => undefined)).toBeUndefined()
    expect((await readdir(join(root, 'Moirasia'))).filter((name) => name.startsWith(`${lockName}.recovery-`))).toEqual([])
    await lease.release()

    const recheckName = 'recheck-runtime.lock'
    const recheckPath = lock(root, recheckName)
    await mkdir(recheckPath, { recursive: true })
    await writeFile(join(recheckPath, 'owner.json'), JSON.stringify({ version: 1, pid: 2_147_483_647, host: 'Shout', token: 'stale-again' }))
    let replaced = false
    const newerOwner = { version: 1, pid: process.pid, host: 'Shout', token: 'newer-owner' }
    const race = await acquireRuntimeLease(root, leaseOptions('Moirasia', {
      probe: (pid) => {
        if (pid === 2_147_483_647 && !replaced) {
          replaced = true
          writeFileSync(join(recheckPath, 'owner.json'), JSON.stringify(newerOwner))
          dead()
        }
      }
    }, recheckName)).catch((error: unknown) => error)
    expect(race).toBeInstanceOf(RuntimeLeaseInUseError)
    expect(JSON.parse(await readFile(join(recheckPath, 'owner.json'), 'utf8'))).toMatchObject({ token: 'newer-owner' })
    await rm(recheckPath, { recursive: true, force: true })
  })

  it('allows only one winner during concurrent stale recovery', async () => {
    const root = await directory()
    await mkdir(lock(root), { recursive: true })
    await writeFile(join(lock(root), 'owner.json'), JSON.stringify({ version: 1, pid: 999, host: 'Shout', token: 'stale' }))

    const results = await Promise.allSettled([
      acquireRuntimeLease(root, leaseOptions('Shout', {
        pid: 1,
        token: () => 'one',
        probe: (pid) => { if (pid === 2) return; dead() }
      })),
      acquireRuntimeLease(root, leaseOptions('Moirasia', {
        pid: 2,
        token: () => 'two',
        probe: (pid) => { if (pid === 1) return; dead() }
      }))
    ])

    const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof acquireRuntimeLease>>> => result.status === 'fulfilled')
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBeInstanceOf(RuntimeLeaseInUseError)
    for (const result of fulfilled) await result.value.release()
  })

  it('treats EPERM from the probe as a live owner', async () => {
    const root = await directory()
    await mkdir(lock(root), { recursive: true })
    await writeFile(join(lock(root), 'owner.json'), JSON.stringify({ version: 1, pid: 100, host: 'Moirasia', token: 'owner' }))
    const denied = (): never => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) }

    await expect(acquireRuntimeLease(root, leaseOptions('Shout', { probe: denied }))).rejects.toBeInstanceOf(RuntimeLeaseInUseError)
  })

  it('releases idempotently and never removes a lease this process does not own', async () => {
    const root = await directory()
    const lease = await acquireRuntimeLease(root, leaseOptions('Shout'))
    await writeFile(join(lock(root), 'owner.json'), JSON.stringify({ version: 1, pid: process.pid, host: 'Moirasia', token: 'new-owner' }))
    await lease.release()
    await lease.release()
    expect(JSON.parse(await readFile(join(lock(root), 'owner.json'), 'utf8'))).toMatchObject({ token: 'new-owner' })

    await rm(lock(root), { recursive: true, force: true })
    const missing = await acquireRuntimeLease(root, leaseOptions('Moirasia'))
    await rm(lock(root), { recursive: true, force: true })
    await missing.release()
    await missing.release()

    const own = await acquireRuntimeLease(root, leaseOptions('Shout'))
    await own.release()
    await expect(stat(lock(root))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recovers garbage and owner-less lock directories', async () => {
    const root = await directory()
    await mkdir(lock(root), { recursive: true })
    await writeFile(join(lock(root), 'owner.json'), '{broken')
    const garbage = await acquireRuntimeLease(root, leaseOptions('Moirasia'))
    await garbage.release()

    await mkdir(lock(root))
    const empty = await acquireRuntimeLease(root, leaseOptions('Moirasia'))
    await empty.release()
  })

  it('throws the ownerless error after three contended attempts', async () => {
    const root = await directory()
    await mkdir(lock(root), { recursive: true })
    await writeFile(join(lock(root), 'owner.json'), JSON.stringify({ version: 1, pid: 999, host: 'Shout', token: 'stale' }))
    await writeFile(join(lock(root), 'recovery.json'), JSON.stringify({ pid: process.pid, token: 'other-recovery' }))

    const error = await acquireRuntimeLease(root, leaseOptions('Moirasia', {
      pid: 4_242,
      probe: (pid) => { if (pid === process.pid) return; dead() }
    })).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(RuntimeLeaseInUseError)
    expect((error as RuntimeLeaseInUseError).owner).toBeUndefined()
    expect((error as RuntimeLeaseInUseError).message).toBe('Another Shout host is already active.')
  })

  it('pins directory modes, owner metadata, host, and the caller lock name', async () => {
    const root = await directory()
    const name = 'pin-runtime.lock'
    const lease = await acquireRuntimeLease(root, leaseOptions('Moirasia', {}, name))
    const parent = await stat(join(root, 'Moirasia'))
    const directoryStat = await stat(lock(root, name))
    const ownerStat = await stat(join(lock(root, name), 'owner.json'))
    const owner = JSON.parse(await readFile(join(lock(root, name), 'owner.json'), 'utf8')) as Record<string, unknown>

    expect(lease.path).toBe(lock(root, name))
    expect(parent.mode & 0o777).toBe(0o700)
    expect(directoryStat.mode & 0o777).toBe(0o700)
    expect(ownerStat.mode & 0o777).toBe(0o600)
    expect(owner).toMatchObject({ version: 1, pid: process.pid, host: 'Moirasia' })
    expect(typeof owner.acquiredAt).toBe('string')
    expect(lease.owner).toMatchObject({ version: 1, pid: process.pid, host: 'Moirasia' })
    await lease.release()
  })

  it('accepts and recovers legacy owner shapes and recovery markers', async () => {
    const root = await directory()
    await mkdir(lock(root), { recursive: true })
    await writeFile(join(lock(root), 'owner.json'), JSON.stringify({ pid: 2_147_483_647, host: 'Moirasia', token: 'legacy-vox', acquiredAt: new Date(0).toISOString() }))
    const versionless = await acquireRuntimeLease(root, leaseOptions('Shout', { probe: dead }))
    expect(JSON.parse(await readFile(join(lock(root), 'owner.json'), 'utf8'))).toMatchObject({ version: 1, host: 'Shout' })
    await versionless.release()

    await mkdir(lock(root), { recursive: true })
    await writeFile(join(lock(root), 'owner.json'), JSON.stringify({ version: 1, pid: 2_147_483_647, host: 'Shout', token: 'legacy-shout' }))
    await writeFile(join(lock(root), 'recovery.json'), JSON.stringify({ pid: 2_147_483_646, token: 'old-recovery' }))
    const legacyRecovery = await acquireRuntimeLease(root, leaseOptions('Moirasia', { probe: dead }))
    expect(JSON.parse(await readFile(join(lock(root), 'owner.json'), 'utf8'))).toMatchObject({ version: 1, host: 'Moirasia' })
    await expect(readFile(join(lock(root), 'recovery.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await legacyRecovery.release()
  })
})
