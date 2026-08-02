import { posix } from 'node:path'
import type { ModuleCapability, ModuleManifestV1 } from './types'

const CAPABILITIES = new Set<ModuleCapability>([
  'accessibility', 'dialogs', 'external-links', 'global-shortcuts', 'keychain',
  'microphone', 'notifications', 'utility-windows'
])
const ID = /^[a-z][a-z0-9-]{1,63}$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SHA256 = /^[a-f0-9]{64}$/

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestValidationError'
  }
}

export function validateManifest(value: unknown): ModuleManifestV1 {
  const manifest = object(value, 'manifest')
  exactKeys(manifest, ['manifestVersion', 'id', 'name', 'version', 'application', 'hostApi', 'kind', 'entrypoints', 'capabilities', 'data', 'payload'])
  if (manifest.manifestVersion !== 1) fail('manifestVersion must be 1')
  const id = string(manifest.id, 'id')
  if (!ID.test(id)) fail('id must be a lowercase module identifier')
  const name = string(manifest.name, 'name')
  const version = semver(manifest.version, 'version')
  const application = object(manifest.application, 'application')
  exactKeys(application, ['bundleId'])
  const bundleId = string(application.bundleId, 'application.bundleId')
  const hostApi = object(manifest.hostApi, 'hostApi')
  exactKeys(hostApi, ['min', 'maxExclusive'])
  const min = semver(hostApi.min, 'hostApi.min')
  const maxExclusive = semver(hostApi.maxExclusive, 'hostApi.maxExclusive')
  if (compareVersions(min, maxExclusive) >= 0) fail('hostApi range is empty')
  if (manifest.kind !== 'web' && manifest.kind !== 'native-view') fail('kind is invalid')
  const entrypoints = object(manifest.entrypoints, 'entrypoints')
  exactKeys(entrypoints, ['main', 'preload', 'renderer', 'nativeBundle'])
  const entries = Object.fromEntries(Object.entries(entrypoints).map(([key, entry]) => [key, safeRelativePath(entry, `entrypoints.${key}`)]))
  if (manifest.kind === 'web' && (!entries.main || !entries.renderer)) fail('web modules require main and renderer entrypoints')
  if (manifest.kind === 'native-view' && !entries.nativeBundle) fail('native-view modules require nativeBundle')
  if (!Array.isArray(manifest.capabilities)) fail('capabilities must be an array')
  const capabilities = manifest.capabilities.map((capability) => {
    if (typeof capability !== 'string' || !CAPABILITIES.has(capability as ModuleCapability)) fail(`unsupported capability: ${String(capability)}`)
    return capability as ModuleCapability
  })
  if (new Set(capabilities).size !== capabilities.length) fail('capabilities must be unique')
  const data = object(manifest.data, 'data')
  exactKeys(data, ['owner', 'supportDirectory', 'lockName'])
  const payload = object(manifest.payload, 'payload')
  exactKeys(payload, ['sha256'])
  const sha256 = string(payload.sha256, 'payload.sha256')
  if (!SHA256.test(sha256)) fail('payload.sha256 must be a lowercase SHA-256 digest')
  return {
    manifestVersion: 1, id, name, version,
    application: { bundleId }, hostApi: { min, maxExclusive }, kind: manifest.kind,
    entrypoints: entries, capabilities,
    data: {
      owner: string(data.owner, 'data.owner'),
      supportDirectory: string(data.supportDirectory, 'data.supportDirectory'),
      lockName: string(data.lockName, 'data.lockName')
    },
    payload: { sha256 }
  } as ModuleManifestV1
}

export function isHostApiCompatible(manifest: ModuleManifestV1, hostVersion: string): boolean {
  return compareVersions(hostVersion, manifest.hostApi.min) >= 0 && compareVersions(hostVersion, manifest.hostApi.maxExclusive) < 0
}

export function safeRelativePath(value: unknown, label = 'path'): string {
  const path = string(value, label)
  if (path.includes('\\') || path.startsWith('/') || path.includes('\0')) fail(`${label} must be a portable relative path`)
  const normalized = posix.normalize(path)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized !== path) fail(`${label} escapes or is not normalized`)
  return path
}

export function compareVersions(left: string, right: string): number {
  const a = left.split('-', 1)[0]!.split('.').map(Number)
  const b = right.split('-', 1)[0]!.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = a[index]! - b[index]!
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${label} must be an object`)
  return value as Record<string, unknown>
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`)
  return value
}
function semver(value: unknown, label: string): string {
  const result = string(value, label)
  if (!VERSION.test(result)) fail(`${label} must be a semantic version`)
  return result
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) fail(`unknown manifest field: ${unknown.join(', ')}`)
}
function fail(message: string): never {
  throw new ManifestValidationError(message)
}
