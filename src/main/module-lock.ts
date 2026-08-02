import { join } from 'node:path'
import { acquireDirectoryLock, type DirectoryLock } from '@moirasia/module-sdk'
import type { ModuleId } from '../shared/contracts'

export type ModuleLock = DirectoryLock

export function acquireModuleLock(lockRoot: string, moduleId: ModuleId): Promise<DirectoryLock> {
  return acquireDirectoryLock(join(lockRoot, moduleId), {
    productId: moduleId,
    mode: 'module',
    hostBundleId: 'com.moirasia.desktop'
  })
}
