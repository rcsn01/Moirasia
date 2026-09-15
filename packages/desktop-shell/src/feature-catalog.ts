/**
 * The feature catalog: the single owner of every shared fact about the embedded
 * features — identity, labels, bundle and executable names,
 * descriptions, display groups, icon keys, order, per-host-mode resource
 * requirements, standalone window facts, and artifact facts: every binary, worker, and asset bundle a
 * feature ships, its filename, the dev build layout it comes from, where
 * staging places it, and where packaged resources land. Pure data and pure
 * string helpers: no Electron, React, filesystem, or product-package imports
 * (not even node:path — the suite renderer bundles this module). Hosts join
 * the facts with their own roots via artifactPath; resolution, literal
 * dynamic imports, renderer panel adapters, and preload bridge exposure stay
 * with the host.
 */

export type FeatureHostMode = 'suite' | 'standalone'

export type FeatureIconKey =
  | 'app-window'   // Amove
  | 'shield-check' // Bonded
  | 'mic'          // Shout

export interface FeatureResourceRequirements {
  readonly preloads?: readonly string[]
  readonly renderers?: readonly string[]
  readonly native?: readonly string[]
  readonly workers?: readonly string[]
  readonly assetsDirectory?: boolean
  readonly dataDirectory?: boolean
}

export interface FeatureGroupId { id: string; label: string }

/** The standalone window's shape and navigation policy — the facts the feature
 *  surface host joins with its own chrome and appearance options. Pure data:
 *  sizes and policy names only, no Electron import. */
export interface StandaloneWindowFacts {
  readonly width: number
  readonly height: number
  readonly minWidth: number
  readonly minHeight: number
  /** Whether the standalone window may go fullscreen (Bonded: false). Default true. */
  readonly fullscreenable?: boolean
  /** will-navigate policy: 'deny' prevents all navigations; 'allow-same-url'
   *  additionally permits reload/same-URL navigation (Amove). Default 'deny'.
   *  window-open is always denied. */
  readonly navigation?: 'deny' | 'allow-same-url'
}

/** Artifact roles mirror the requirement tables: a host validates 'native.addon',
 *  the catalog says what that file is and where it lives. */
export type ArtifactKind = 'native' | 'executable' | 'worker' | 'assets' | 'bundle'

export interface FeatureArtifact {
  /** Symbolic name matching the per-mode requirements tables ('addon', 'helper', 'executable', 'scan', …). */
  readonly name: string
  readonly kind: ArtifactKind
  /**
   * kind 'native': napi base name — the real filename comes from nativeAddonFileName(base, …).
   * other kinds: exact filename ('ExithibitionNative', 'scan-worker.mjs'); kind 'assets' carries none.
   */
  readonly file?: string
  /** Where the build output lands inside the app repo, relative to the app root. `{configuration}` → 'debug' | 'release'; `{Configuration}` → 'Debug' | 'Release' (SwiftPM 6.4 layout). */
  readonly buildOutput: string
  /** Suite-repo-relative path the staging script places the artifact at (directory for multi-file kinds). */
  readonly staged: string
  /** Suite-packaged destination under Contents/Resources (directory; the filename inside is `file`). */
  readonly suiteResource: string
  /** Which source the suite trusts in development: the app's own build output, or the staged copy. */
  readonly suiteDevSource: 'buildOutput' | 'staged'
  /** Destination under the app's own Contents/Resources in standalone packaging. */
  readonly standaloneResource: string
}

/** The platform `.node` naming matrix for napi addons — one copy for every host
 * that loads a native addon. Linux and win32 names ignore the arch, deliberately. */
export function nativeAddonFileName(
  base: string,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch
): string {
  const a = arch === 'arm64' ? 'arm64' : 'x64'
  if (platform === 'darwin') return `${base}.darwin-${a}.node`
  if (platform === 'win32') return `${base}.win32-x64-msvc.node`
  return `${base}.linux-x64-gnu.node`
}

/** Join a host-owned directory (a root composed with a catalog destination fact)
 *  with the artifact's kind-dependent filename. 'assets' artifacts are directories
 *  and return the directory itself. The join is a pure string concat so this
 *  module stays renderer-bundlable; facts use '/' separators and roots arrive
 *  absolute, which every Node and Electron API accepts on every platform. */
export function artifactPath(directory: string, artifact: FeatureArtifact): string {
  if (artifact.kind === 'assets') return directory
  const file = artifact.kind === 'native' ? nativeAddonFileName(artifact.file!) : artifact.file!
  const separator = directory.endsWith('/') || directory.endsWith('\\') ? '' : '/'
  return `${directory}${separator}${file}`
}

/** The embedded features. The catalog seeds below and this union must stay in sync;
 * tests pin the exact list and every Record<FeatureId, …> consumer enforces exhaustiveness. */
export type FeatureId = 'amove' | 'bonded' | 'shout'

export interface FeatureCatalogEntry {
  readonly id: FeatureId
  readonly label: string          // display name; menu, sidebar, cards
  readonly executableName: string // binary name inside Contents/MacOS for --moirasia-control
  readonly description: string    // Features page copy
  readonly bundleId: string       // standalone bundle identifier
  readonly iconKey: FeatureIconKey
  readonly groupId: string
  readonly directory: string      // app repo directory name under apps/integrated
  readonly requirements: Readonly<Record<FeatureHostMode, FeatureResourceRequirements>>
  readonly artifacts: readonly FeatureArtifact[]
  readonly standaloneWindow: StandaloneWindowFacts
}

const GROUPS = [
  { id: 'window-management', label: 'Window management' },
  { id: 'monitoring', label: 'Monitoring' },
  { id: 'audio', label: 'Audio' }
] as const

const NAVIGATION_POLICIES: ReadonlySet<string> = new Set(['deny', 'allow-same-url'])

const FEATURE_SEEDS = [
  {
    id: 'amove',
    label: 'Amove',
    executableName: 'Amove',
    bundleId: 'com.opense.Amove',
    description: 'Move windows between displays and stage files on its floating Shelf.',
    iconKey: 'app-window',
    groupId: 'window-management',
    directory: 'Amove',
    requirements: {
      standalone: { preloads: ['main', 'shelf'], renderers: ['main', 'shelf'], native: ['addon'], assetsDirectory: true, dataDirectory: true },
      suite: { preloads: ['shelf'], renderers: ['shelf'], native: ['addon'], assetsDirectory: true, dataDirectory: true }
    },
    standaloneWindow: { width: 1180, height: 760, minWidth: 980, minHeight: 700, navigation: 'allow-same-url' },
    artifacts: [
      // Standalone assets are asar-embedded (files: assets/**/*), not an extraResource;
      // standaloneResource records the app-internal convention.
      { name: 'addon', kind: 'native', file: 'amove-native', buildOutput: 'native', staged: 'native/staged/features/amove/native', suiteResource: 'features/amove/native', suiteDevSource: 'buildOutput', standaloneResource: 'native' },
      { name: 'assets', kind: 'assets', buildOutput: 'assets', staged: 'native/staged/features/amove/assets', suiteResource: 'features/amove/assets', suiteDevSource: 'buildOutput', standaloneResource: 'assets' }
    ]
  },
  {
    id: 'bonded',
    label: 'Bonded',
    executableName: 'Bonded',
    bundleId: 'com.opense.Bonded',
    description: 'Monitor network activity and block destinations learned from selected applications.',
    iconKey: 'shield-check',
    groupId: 'monitoring',
    directory: 'Bonded',
    requirements: {
      standalone: { preloads: ['main'], renderers: ['main'], native: ['helper'], dataDirectory: true },
      suite: { native: ['helper'], dataDirectory: true }
    },
    standaloneWindow: { width: 430, height: 600, minWidth: 390, minHeight: 500, fullscreenable: false },
    artifacts: [
      // A SwiftPM executable like Exithibition's: exact filename, not a napi base name.
      { name: 'helper', kind: 'executable', file: 'BondedFirewallHelper', buildOutput: 'native/.build/arm64-apple-macosx/{configuration}', staged: 'native/staged/features/bonded/native', suiteResource: 'features/bonded/native', suiteDevSource: 'buildOutput', standaloneResource: 'native' }
    ]
  },
  {
    id: 'shout',
    label: 'Shout',
    executableName: 'Shout',
    bundleId: 'com.opense.Shout',
    description: 'Boost every app’s microphone through a virtual Shout Mic input with clean gain and a soft limiter.',
    iconKey: 'mic',
    groupId: 'audio',
    directory: 'Shout',
    requirements: {
      standalone: { preloads: ['main'], renderers: ['main'], native: ['helper', 'driver'], dataDirectory: true },
      suite: { native: ['helper', 'driver'], dataDirectory: true }
    },
    standaloneWindow: { width: 430, height: 640, minWidth: 390, minHeight: 500, fullscreenable: false },
    artifacts: [
      { name: 'helper', kind: 'executable', file: 'ShoutAudioHelper', buildOutput: 'native/.build/out/Products/{Configuration}', staged: 'native/staged/features/shout/native', suiteResource: 'features/shout/native', suiteDevSource: 'buildOutput', standaloneResource: 'native' },
      // The AudioServerPlugIn is a .driver bundle directory; 'file' is the bundle name
      // the host joins under its own root (like every non-assets kind).
      { name: 'driver', kind: 'bundle', file: 'ShoutMic.driver', buildOutput: 'native/driver/dist', staged: 'native/staged/features/shout/driver', suiteResource: 'features/shout/driver', suiteDevSource: 'staged', standaloneResource: 'native' }
    ]
  }
] as const satisfies readonly FeatureCatalogEntry[]

export interface FeatureCatalog {
  /** Catalog order is the menu order: Command+1..5 and every array-index-dependent consumer. */
  readonly ids: readonly FeatureId[]
  readonly entries: readonly FeatureCatalogEntry[]
  readonly groups: readonly (FeatureGroupId & { features: readonly FeatureId[] })[]
  isId(value: unknown): value is FeatureId
  /** Throws on an id outside the catalog. */
  get(id: FeatureId): FeatureCatalogEntry
}

export const featureCatalog: FeatureCatalog = buildCatalog()
export const FEATURE_IDS = featureCatalog.ids

export function isFeatureId(value: unknown): value is FeatureId {
  return featureCatalog.isId(value)
}

function validateStandaloneWindow(id: FeatureId, facts: StandaloneWindowFacts): void {
  for (const [name, size] of [['width', facts.width], ['height', facts.height], ['minWidth', facts.minWidth], ['minHeight', facts.minHeight]] as const) {
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`Feature '${id}' standalone window ${name} must be a positive integer.`)
  }
  if (facts.minWidth > facts.width) throw new Error(`Feature '${id}' standalone window minWidth exceeds width.`)
  if (facts.minHeight > facts.height) throw new Error(`Feature '${id}' standalone window minHeight exceeds height.`)
  if (facts.navigation !== undefined && !NAVIGATION_POLICIES.has(facts.navigation)) {
    throw new Error(`Feature '${id}' standalone window navigation policy '${String(facts.navigation)}' is unknown.`)
  }
  if (facts.fullscreenable !== undefined && facts.fullscreenable !== false) {
    throw new Error(`Feature '${id}' standalone window fullscreenable must be false when present (true is the default).`)
  }
}

function freezeRequirements(requirements: FeatureResourceRequirements): FeatureResourceRequirements {
  for (const values of [requirements.preloads, requirements.renderers, requirements.native, requirements.workers]) {
    if (values) Object.freeze(values)
  }
  return Object.freeze(requirements)
}

/** Builds and validates a catalog from feature seeds. The shared catalog is
 *  built once at import time; the seeds parameter is the seam that lets tests
 *  exercise the validation before any seed lands in the product catalog. */
export function buildCatalog(seeds: readonly FeatureCatalogEntry[] = FEATURE_SEEDS): FeatureCatalog {
  const groupIds = new Set<string>(GROUPS.map((group) => group.id))
  const ids = new Set<string>()
  const bundleIds = new Set<string>()
  // A native: requirement may name a napi addon ('native'), a plain native binary ('executable'),
  // or a bundle directory ('bundle') — all land in the paths.native map, so requirement-bucket
  // and ArtifactKind names are not the same check.
  const nativeRequirementKinds: ReadonlySet<ArtifactKind> = new Set(['native', 'executable', 'bundle'])
  for (const seed of seeds) {
    if (ids.has(seed.id)) throw new Error(`Feature catalog has a duplicate id '${seed.id}'.`)
    if (bundleIds.has(seed.bundleId)) throw new Error(`Feature catalog has a duplicate bundle id '${seed.bundleId}'.`)
    if (!groupIds.has(seed.groupId)) throw new Error(`Feature '${seed.id}' references unknown group '${seed.groupId}'.`)
    if (!seed.label.trim()) throw new Error(`Feature '${seed.id}' has an empty label.`)
    if (!seed.description.trim()) throw new Error(`Feature '${seed.id}' has an empty description.`)
    if (!seed.executableName.trim()) throw new Error(`Feature '${seed.id}' has an empty executable name.`)
    if (!seed.directory.trim()) throw new Error(`Feature '${seed.id}' has an empty directory.`)
    if (!seed.requirements.standalone || !seed.requirements.suite) throw new Error(`Feature '${seed.id}' is missing requirements for a host mode.`)
    validateStandaloneWindow(seed.id, seed.standaloneWindow)

    const artifactNames = new Set<string>()
    for (const seedArtifact of seed.artifacts) {
      const artifact: FeatureArtifact = seedArtifact
      if (artifactNames.has(artifact.name)) throw new Error(`Feature '${seed.id}' has a duplicate artifact name '${artifact.name}'.`)
      artifactNames.add(artifact.name)
      if (!artifact.staged.trim() || !artifact.suiteResource.trim() || !artifact.standaloneResource.trim()) {
        throw new Error(`Feature '${seed.id}' artifact '${artifact.name}' is missing a staged or resource destination.`)
      }
      if (artifact.kind === 'assets') {
        if (artifact.file) throw new Error(`Feature '${seed.id}' assets artifact '${artifact.name}' must not carry a filename.`)
      } else if (!artifact.file?.trim()) {
        throw new Error(`Feature '${seed.id}' artifact '${artifact.name}' is missing a filename.`)
      } else if (artifact.kind === 'native' && artifact.file.endsWith('.node')) {
        throw new Error(`Feature '${seed.id}' native artifact '${artifact.name}' must carry a napi base name, not '${artifact.file}'.`)
      }
    }
    for (const mode of ['standalone', 'suite'] as const) {
      const requirements: FeatureResourceRequirements = seed.requirements[mode]
      for (const name of requirements.native ?? []) {
        const artifact = seed.artifacts.find((candidate) => candidate.name === name)
        if (!artifact || !nativeRequirementKinds.has(artifact.kind)) throw new Error(`Feature '${seed.id}' requires a native artifact named '${name}' for ${mode}.`)
      }
      for (const name of requirements.workers ?? []) {
        const artifact = seed.artifacts.find((candidate) => candidate.name === name)
        if (!artifact || artifact.kind !== 'worker') throw new Error(`Feature '${seed.id}' requires a worker artifact named '${name}' for ${mode}.`)
      }
    }
    ids.add(seed.id)
    bundleIds.add(seed.bundleId)
  }

  const entries = seeds.map((seed) => {
    const requirements: Record<FeatureHostMode, FeatureResourceRequirements> = {
      standalone: freezeRequirements(seed.requirements.standalone),
      suite: freezeRequirements(seed.requirements.suite)
    }
    const artifacts = Object.freeze(seed.artifacts.map((artifact) => Object.freeze({ ...artifact })))
    const standaloneWindow = Object.freeze({ ...seed.standaloneWindow })
    return Object.freeze({ ...seed, requirements: Object.freeze(requirements), artifacts, standaloneWindow }) as FeatureCatalogEntry
  })
  const groups = GROUPS.map((group) => Object.freeze({
    id: group.id,
    label: group.label,
    features: entries.filter((entry) => entry.groupId === group.id).map((entry) => entry.id)
  }) as FeatureGroupId & { features: readonly FeatureId[] })
  const byId = new Map<string, FeatureCatalogEntry>(entries.map((entry) => [entry.id, entry]))

  return Object.freeze({
    ids: Object.freeze(entries.map((entry) => entry.id)),
    entries: Object.freeze(entries),
    groups: Object.freeze(groups),
    isId(value: unknown): value is FeatureId {
      return typeof value === 'string' && byId.has(value)
    },
    get(id: FeatureId): FeatureCatalogEntry {
      const entry = byId.get(id)
      if (!entry) throw new Error(`Unknown feature '${String(id)}'.`)
      return entry
    }
  })
}