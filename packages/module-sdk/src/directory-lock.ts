import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type DirectoryLockMode = 'standalone' | 'module'
export interface DirectoryLockOwnerV1 {
  readonly version: 1
  readonly pid: number
  readonly token: string
  readonly productId: string
  readonly mode: DirectoryLockMode
  readonly hostBundleId: string
  readonly createdAt: string
}
export interface DirectoryLock { readonly path: string; readonly owner: DirectoryLockOwnerV1; release(): Promise<void> }

export class DirectoryLockConflictError extends Error {
  constructor(readonly owner: DirectoryLockOwnerV1) {
    super(owner.mode === 'module'
      ? `${owner.productId} is open in Moirasia. Close that module before launching the standalone app.`
      : `${owner.productId} is open as a standalone app (PID ${owner.pid}). Quit it before starting the module.`)
    this.name = 'DirectoryLockConflictError'
  }
}

export async function acquireDirectoryLock(
  dataDirectory: string,
  identity: Pick<DirectoryLockOwnerV1, 'productId' | 'mode' | 'hostBundleId'>
): Promise<DirectoryLock> {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
  const lockPath = join(dataDirectory, '.moirasia-data.lock')
  const owner: DirectoryLockOwnerV1 = {
    version: 1, pid: process.pid, token: randomUUID(), ...identity, createdAt: new Date().toISOString()
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await mkdir(lockPath, { mode: 0o700 })
      await writeFile(join(lockPath, 'owner.json'), JSON.stringify(owner), { mode: 0o600, flag: 'wx' })
      return handle(lockPath, owner)
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
      const existing = await readOwner(lockPath)
      if (existing && processAlive(existing.pid)) throw new DirectoryLockConflictError(existing)
      const quarantine = join(dirname(lockPath), `.moirasia-data.lock.stale-${randomUUID()}`)
      try { await rename(lockPath, quarantine); await rm(quarantine, { recursive: true, force: true }) }
      catch (recoveryError) { if (!hasCode(recoveryError, 'ENOENT')) throw recoveryError }
    }
  }
  throw new Error(`Could not acquire the ${identity.productId} data lock`)
}

function handle(path: string, owner: DirectoryLockOwnerV1): DirectoryLock {
  let released = false
  const onExit = (): void => {
    try { if (syncOwner(path)?.token === owner.token) rmSync(path, { recursive: true, force: true }) } catch {}
  }
  process.once('exit', onExit)
  return {
    path, owner,
    async release() {
      if (released) return
      released = true
      process.removeListener('exit', onExit)
      if ((await readOwner(path))?.token === owner.token) await rm(path, { recursive: true, force: true })
    }
  }
}

function syncOwner(path: string): DirectoryLockOwnerV1 | undefined {
  try { return parseOwner(JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8'))) } catch { return undefined }
}
async function readOwner(path: string): Promise<DirectoryLockOwnerV1 | undefined> {
  try { return parseOwner(JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'))) } catch { return undefined }
}
function parseOwner(value: unknown): DirectoryLockOwnerV1 | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const owner = value as Partial<DirectoryLockOwnerV1>
  return owner.version === 1 && Number.isSafeInteger(owner.pid) && (owner.pid ?? 0) > 0 &&
    typeof owner.token === 'string' && typeof owner.productId === 'string' &&
    (owner.mode === 'standalone' || owner.mode === 'module') && typeof owner.hostBundleId === 'string'
    ? owner as DirectoryLockOwnerV1 : undefined
}
function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { return hasCode(error, 'EPERM') }
}
function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === code
}
