import { randomUUID } from 'node:crypto'
import { chmod, link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const ownerFileName = 'owner.json'
const recoveryFileName = 'recovery.json'
const maxAttempts = 3
const ownerReadAttempts = 4
const retryDelayMilliseconds = 25

type RecoveryClaim = {
  pid: number
  token: string
}

type RecoveryResult = 'owned' | 'busy' | 'retry' | 'gone'
type OwnerInstallationResult = { kind: 'installed' } | { kind: 'live'; owner: RuntimeLeaseOwner } | { kind: 'gone' }

export interface RuntimeLeaseOwner {
  /** Always 1 on records this module writes; the reader also tolerates version-less records as inputs. */
  version?: 1
  pid: number
  host: string
  token: string
  acquiredAt?: string
}

export interface RuntimeLease {
  readonly path: string
  readonly owner: RuntimeLeaseOwner
  /** Idempotent; never removes a lease this process does not own. */
  release(): Promise<void>
}

export class RuntimeLeaseInUseError extends Error {
  readonly owner: RuntimeLeaseOwner | undefined

  constructor(owner: RuntimeLeaseOwner | undefined, primaryLabel: string) {
    super(owner ? `${primaryLabel} is already in use by ${owner.host}. Quit ${owner.host}, then try again.` : `Another ${primaryLabel} host is already active.`)
    this.name = 'RuntimeLeaseInUseError'
    this.owner = owner
  }
}

export interface RuntimeLeaseDependencies {
  pid: number
  now(): Date
  token(): string
  probe(pid: number): void        // throws EPERM ⇒ alive
  delay(ms: number): Promise<void>
}

export interface RuntimeLeaseOptions {
  /** File name of the lock directory, e.g. 'shout-runtime.lock'. The on-disk name is part of the lock identity — never change it for an existing app. */
  lockName: string
  /** Host label this caller acquires as; must be one of `hosts`. Stored in the owner record and echoed as `owner.host` in error text. */
  host: string
  /** Allowed owner hosts; hosts[0] is the product label used in error text. */
  hosts: readonly [string, ...string[]]
  /** Injectable for tests; defaults to process.pid / clock / randomUUID / process.kill / setTimeout. */
  dependencies?: Partial<RuntimeLeaseDependencies>
}

export async function acquireRuntimeLease(appDataDirectory: string, options: RuntimeLeaseOptions): Promise<RuntimeLease> {
  validateOptions(options)
  const dependencies = resolveDependencies(options.dependencies)
  const parent = join(appDataDirectory, 'Moirasia')
  const lockPath = join(parent, options.lockName)
  const token = dependencies.token()
  const owner: RuntimeLeaseOwner = {
    version: 1,
    pid: dependencies.pid,
    host: options.host,
    token,
    acquiredAt: dependencies.now().toISOString()
  }

  await mkdir(parent, { recursive: true, mode: 0o700 })

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) await dependencies.delay(retryDelayMilliseconds)

    const candidate = `${lockPath}.candidate-${token}`
    await rm(candidate, { recursive: true, force: true })
    try {
      await mkdir(candidate, { mode: 0o700 })
      await chmod(candidate, 0o700)
      await writeOwner(join(candidate, ownerFileName), owner)
    } catch (error) {
      await rm(candidate, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }

    try {
      await rename(candidate, lockPath)
      return createLease(lockPath, owner, options.hosts, dependencies)
    } catch (error) {
      await rm(candidate, { recursive: true, force: true }).catch(() => undefined)
      if (!hasCode(error, 'EEXIST') && !hasCode(error, 'ENOTEMPTY')) throw error
    }

    const current = await readOwner(lockPath, options.hosts, dependencies)
    if (current && isLive(current.pid, dependencies.probe)) throw new RuntimeLeaseInUseError(current, options.hosts[0])

    const recovery = await claimRecovery(lockPath, token, dependencies)
    if (recovery === 'busy' || recovery === 'retry' || recovery === 'gone') continue

    const observed = await readOwner(lockPath, options.hosts, dependencies)
    if (observed && isLive(observed.pid, dependencies.probe)) {
      await releaseRecovery(lockPath, token)
      throw new RuntimeLeaseInUseError(observed, options.hosts[0])
    }

    const installation = await installOwner(lockPath, owner, options.hosts, dependencies)
    if (installation.kind === 'gone') {
      await releaseRecovery(lockPath, token)
      continue
    }
    if (installation.kind === 'live') {
      await releaseRecovery(lockPath, token)
      throw new RuntimeLeaseInUseError(installation.owner, options.hosts[0])
    }

    const confirmed = await readOwner(lockPath, options.hosts, dependencies)
    if (confirmed?.token !== token) {
      await releaseRecovery(lockPath, token)
      if (confirmed && isLive(confirmed.pid, dependencies.probe)) throw new RuntimeLeaseInUseError(confirmed, options.hosts[0])
      continue
    }

    await releaseRecovery(lockPath, token)
    return createLease(lockPath, owner, options.hosts, dependencies)
  }

  throw new RuntimeLeaseInUseError(undefined, options.hosts[0])
}

function resolveDependencies(overrides: Partial<RuntimeLeaseDependencies> | undefined): RuntimeLeaseDependencies {
  return {
    pid: process.pid,
    now: () => new Date(),
    token: randomUUID,
    probe: (pid) => process.kill(pid, 0),
    delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    ...overrides
  }
}

function validateOptions(options: RuntimeLeaseOptions): void {
  if (!options.lockName || options.lockName === '.' || options.lockName === '..' || basename(options.lockName) !== options.lockName) {
    throw new TypeError('Runtime lease lockName must be a non-empty file name')
  }
  if (!options.hosts.includes(options.host)) throw new TypeError(`Runtime lease host ${options.host} is not allowed for this lock`)
}

async function createLease(path: string, owner: RuntimeLeaseOwner, allowedHosts: readonly string[], dependencies: RuntimeLeaseDependencies): Promise<RuntimeLease> {
  let released = false
  return {
    path,
    owner,
    async release(): Promise<void> {
      if (released) return
      released = true

      const observed = await readOwner(path, allowedHosts, dependencies)
      if (observed?.token !== owner.token) return

      const claim = `${path}.release-${owner.token}`
      try {
        await rename(path, claim)
      } catch (error) {
        if (hasCode(error, 'ENOENT')) return
        throw error
      }

      const current = await readOwner(claim, allowedHosts, dependencies)
      if (current?.token === owner.token) {
        await rm(claim, { recursive: true, force: true })
        return
      }

      try {
        await rename(claim, path)
      } catch (error) {
        if (!hasCode(error, 'EEXIST') && !hasCode(error, 'ENOTEMPTY')) throw error
      }
    }
  }
}

async function claimRecovery(lockPath: string, token: string, dependencies: RuntimeLeaseDependencies): Promise<RecoveryResult> {
  const markerPath = join(lockPath, recoveryFileName)
  const candidate = `${lockPath}.recovery-candidate-${token}`
  const marker: RecoveryClaim = { pid: dependencies.pid, token }

  await rm(candidate, { force: true })
  await writeFile(candidate, `${JSON.stringify(marker)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  try {
    await link(candidate, markerPath)
    return 'owned'
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) {
      if (hasCode(error, 'ENOENT')) return 'gone'
      throw error
    }
  } finally {
    await rm(candidate, { force: true }).catch(() => undefined)
  }

  const observed = await readRecovery(markerPath)
  if (observed && isLive(observed.pid, dependencies.probe)) return 'busy'

  // A legacy writer creates recovery.json with wx and fills it afterwards. Give
  // that writer one deterministic window before declaring a malformed marker stale.
  await dependencies.delay(retryDelayMilliseconds)
  const confirmed = await readRecovery(markerPath)
  if (confirmed && isLive(confirmed.pid, dependencies.probe)) return 'busy'
  if (observed?.token && confirmed?.token && observed.token !== confirmed.token) return 'busy'

  await rm(markerPath, { force: true })
  return 'retry'
}

async function releaseRecovery(lockPath: string, token: string): Promise<void> {
  const markerPath = join(lockPath, recoveryFileName)
  const marker = await readRecovery(markerPath)
  if (marker?.token === token) await rm(markerPath, { force: true })
}

async function installOwner(lockPath: string, owner: RuntimeLeaseOwner, allowedHosts: readonly string[], dependencies: RuntimeLeaseDependencies): Promise<OwnerInstallationResult> {
  const ownerPath = join(lockPath, ownerFileName)
  const candidate = `${lockPath}.owner-candidate-${owner.token}`
  await rm(candidate, { force: true })
  try {
    await writeOwner(candidate, owner)
  } catch (error) {
    await rm(candidate, { force: true }).catch(() => undefined)
    throw error
  }

  try {
    await link(candidate, ownerPath)
    return { kind: 'installed' }
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) {
      if (hasCode(error, 'ENOENT')) return { kind: 'gone' }
      throw error
    }
  } finally {
    await rm(candidate, { force: true }).catch(() => undefined)
  }

  const observed = await readOwner(lockPath, allowedHosts, dependencies)
  if (observed && isLive(observed.pid, dependencies.probe)) return { kind: 'live', owner: observed }

  await writeOwner(candidate, owner)
  try {
    await rename(candidate, ownerPath)
    return { kind: 'installed' }
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return { kind: 'gone' }
    throw error
  } finally {
    await rm(candidate, { force: true }).catch(() => undefined)
  }
}

async function writeOwner(path: string, owner: RuntimeLeaseOwner): Promise<void> {
  await writeFile(path, `${JSON.stringify(owner)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
}

async function readOwner(path: string, allowedHosts: readonly string[], dependencies: RuntimeLeaseDependencies): Promise<RuntimeLeaseOwner | undefined> {
  const ownerPath = join(path, ownerFileName)
  for (let attempt = 0; attempt < ownerReadAttempts; attempt += 1) {
    try {
      const value = JSON.parse(await readFile(ownerPath, 'utf8')) as Partial<RuntimeLeaseOwner>
      if (value.version !== undefined && value.version !== 1) return undefined
      if (typeof value.pid !== 'number' || !Number.isSafeInteger(value.pid) || value.pid <= 0) return undefined
      if (typeof value.host !== 'string' || !allowedHosts.includes(value.host)) return undefined
      if (typeof value.token !== 'string' || !value.token) return undefined
      if (value.acquiredAt !== undefined && typeof value.acquiredAt !== 'string') return undefined
      return value as RuntimeLeaseOwner
    } catch {
      // The owner may still be writing, or the directory may have moved.
    }
    if (attempt < ownerReadAttempts - 1) await dependencies.delay(retryDelayMilliseconds)
  }
  return undefined
}

async function readRecovery(path: string): Promise<RecoveryClaim | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<RecoveryClaim>
    if (typeof value.pid !== 'number' || !Number.isSafeInteger(value.pid) || value.pid <= 0) return undefined
    if (typeof value.token !== 'string' || !value.token) return undefined
    return value as RecoveryClaim
  } catch {
    return undefined
  }
}

function isLive(pid: number, probe: (pid: number) => void): boolean {
  try {
    probe(pid)
    return true
  } catch (error) {
    return hasCode(error, 'EPERM')
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === code
}
