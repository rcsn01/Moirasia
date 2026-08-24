import type { WebContents } from 'electron'
import type { ProductId } from './index'

export const FEATURE_IDS = ['amove', 'exithibition', 'orbis'] as const
export type FeatureId = (typeof FEATURE_IDS)[number]

export function isFeatureId(value: unknown): value is FeatureId {
  return typeof value === 'string' && FEATURE_IDS.some((id) => id === value)
}

/**
 * Resources are keyed by the name a feature uses, rather than by whatever
 * product happened to be integrated first. Renderer entries contain either a
 * packaged HTML path or a development-server URL.
 */
export type FeatureResourceMap = Readonly<Record<string, string>>

export interface FeaturePaths {
  preloads?: FeatureResourceMap
  renderers?: FeatureResourceMap
  native?: FeatureResourceMap
  workers?: FeatureResourceMap
  assetsDirectory?: string
  dataDirectory?: string
  legacyDataDirectories?: readonly string[]

  /** @deprecated Use the named resource maps above. */
  preload?: string
  /** @deprecated Use the named resource maps above. */
  rendererUrl?: string
  /** @deprecated Use the named resource maps above. */
  rendererFile?: string
  /** @deprecated Use the named resource maps above. */
  nativeExecutable?: string
}

export interface EmbeddedFeatureSurfaceState {
  readonly active: boolean
  readonly focused: boolean
}

/** The shell-owned surface an embedded feature may use for IPC and focus. */
export interface EmbeddedFeatureSurface {
  readonly webContents: WebContents
  readonly state: EmbeddedFeatureSurfaceState
  activate(): void
  focus(): void
  subscribe(listener: (state: EmbeddedFeatureSurfaceState) => void): () => void
}

interface FeatureContextBase {
  readonly id: FeatureId
  readonly productId: Extract<ProductId, FeatureId>
  readonly paths: FeaturePaths
}

export interface StandaloneFeatureContext extends FeatureContextBase {
  readonly mode: 'standalone'
}

export interface EmbeddedFeatureContext extends FeatureContextBase {
  readonly mode: 'suite'
  /** The shell-owned primary surface; embedded features never create its window. */
  readonly surface: EmbeddedFeatureSurface
}

/** Host-specific feature context. The mode discriminates window ownership. */
export type FeatureContext = StandaloneFeatureContext | EmbeddedFeatureContext

export type FeatureResourceKind = 'preloads' | 'renderers' | 'native' | 'workers'
export interface FeatureResourceRequirements {
  readonly preloads?: readonly string[]
  readonly renderers?: readonly string[]
  readonly native?: readonly string[]
  readonly workers?: readonly string[]
  readonly assetsDirectory?: boolean
  readonly dataDirectory?: boolean
}

/** Validate host-owned resource values before a feature starts side effects. */
export function validateFeatureResources(context: FeatureContext, requirements?: FeatureResourceRequirements): void {
  const required = requirements ?? defaultRequirements(context)
  const { paths } = context
  for (const name of required.preloads ?? []) {
    requireResource(paths.preloads?.[name] ?? (name === 'main' ? paths.preload : undefined), 'preloads', name, false)
  }
  for (const name of required.renderers ?? []) {
    const value = paths.renderers?.[name] ?? (name === 'main' ? paths.rendererUrl ?? paths.rendererFile : undefined)
    requireResource(value, 'renderers', name, true)
  }
  for (const name of required.native ?? []) {
    requireResource(paths.native?.[name] ?? (name === 'executable' ? paths.nativeExecutable : undefined), 'native', name, false)
  }
  for (const name of required.workers ?? []) {
    requireResource(paths.workers?.[name], 'workers', name, false)
  }
  if (required.assetsDirectory) requireDirectory(paths.assetsDirectory, 'assetsDirectory')
  if (required.dataDirectory) requireDirectory(paths.dataDirectory, 'dataDirectory')
  for (const directory of paths.legacyDataDirectories ?? []) requireDirectory(directory, 'legacyDataDirectories')
}

function defaultRequirements(context: FeatureContext): FeatureResourceRequirements {
  switch (context.id) {
    case 'amove':
      return context.mode === 'standalone'
        ? { preloads: ['main', 'shelf'], renderers: ['main', 'shelf'], native: ['addon'], assetsDirectory: true, dataDirectory: true }
        : { preloads: ['shelf'], renderers: ['shelf'], native: ['addon'], assetsDirectory: true, dataDirectory: true }
    case 'exithibition':
      return context.mode === 'standalone'
        ? { preloads: ['main'], renderers: ['main'], native: ['executable'], dataDirectory: true }
        : { native: ['executable'], dataDirectory: true }
    case 'orbis':
      return context.mode === 'standalone'
        ? { preloads: ['main'], renderers: ['main'], workers: ['scan'], dataDirectory: true }
        : { workers: ['scan'], dataDirectory: true }
    default:
      return assertNever(context.id)
  }
}

function assertNever(value: never): never { throw new Error(`Unknown feature '${String(value)}'`) }

function requireResource(value: string | undefined, kind: FeatureResourceKind, name: string, allowUrl: boolean): string {
  if (!value || (!allowUrl && !isAbsolutePath(value)) || (allowUrl && !isAbsolutePath(value) && !isUrl(value))) {
    throw new Error(`Feature resource '${kind}.${name}' is missing or invalid for '${kind}'.`)
  }
  return value
}

function requireDirectory(value: string | undefined, name: string): string {
  if (!value || !isAbsolutePath(value)) throw new Error(`Feature resource '${name}' is missing or invalid.`)
  return value
}

function isAbsolutePath(value: string): boolean { return value.startsWith('/') || value.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(value) }
function isUrl(value: string): boolean { try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' } catch { return false } }

export interface MoirasiaFeature {
  readonly id: string
  /** Bring the feature to life: create windows, register IPC, start native helpers. */
  register(ctx: FeatureContext): Promise<void> | void
  /** Full teardown: destroy windows, remove IPC handlers, stop native helpers. */
  dispose(): Promise<void> | void
  /** Select/focus the feature's primary surface. */
  activate?(): void
  /** Tell the feature whether its embedded tab is currently selected. */
  setActive?(active: boolean): void
}
