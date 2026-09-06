/**
 * The feature catalog: the single owner of every shared fact about the five
 * embedded features — identity, labels, bundle and executable names,
 * descriptions, display groups, icon keys, order, and per-host-mode resource
 * requirements. Pure data: no Electron, React, filesystem, or product-package
 * imports. Host-specific code (literal dynamic imports, renderer panel
 * adapters, preload bridge exposure, resource paths) stays with its host.
 */

export type FeatureHostMode = 'suite' | 'standalone'

export type FeatureIconKey =
  | 'app-window'   // Amove
  | 'mic'          // Vox
  | 'activity'     // Exithibition
  | 'shield-check' // Bonded
  | 'bar-chart-3'  // Orbis

export interface FeatureResourceRequirements {
  readonly preloads?: readonly string[]
  readonly renderers?: readonly string[]
  readonly native?: readonly string[]
  readonly workers?: readonly string[]
  readonly assetsDirectory?: boolean
  readonly dataDirectory?: boolean
}

export interface FeatureGroupId { id: string; label: string }

/** The five embedded features. The catalog seeds below and this union must stay in sync;
 * tests pin the exact list and every Record<FeatureId, …> consumer enforces exhaustiveness. */
export type FeatureId = 'amove' | 'vox' | 'exithibition' | 'bonded' | 'orbis'

export interface FeatureCatalogEntry {
  readonly id: FeatureId
  readonly label: string          // display name; menu, sidebar, cards
  readonly executableName: string // binary name inside Contents/MacOS for --moirasia-control
  readonly description: string    // Features page copy
  readonly bundleId: string       // standalone bundle identifier
  readonly iconKey: FeatureIconKey
  readonly groupId: string
  readonly requirements: Readonly<Record<FeatureHostMode, FeatureResourceRequirements>>
}

const GROUPS = [
  { id: 'window-management', label: 'Window management' },
  { id: 'voice', label: 'Voice' },
  { id: 'monitoring', label: 'Monitoring' }
] as const

const FEATURE_SEEDS = [
  {
    id: 'amove',
    label: 'Amove',
    executableName: 'Amove',
    bundleId: 'com.opense.Amove',
    description: 'Move windows between displays and stage files on its floating Shelf.',
    iconKey: 'app-window',
    groupId: 'window-management',
    requirements: {
      standalone: { preloads: ['main', 'shelf'], renderers: ['main', 'shelf'], native: ['addon'], assetsDirectory: true, dataDirectory: true },
      suite: { preloads: ['shelf'], renderers: ['shelf'], native: ['addon'], assetsDirectory: true, dataDirectory: true }
    }
  },
  {
    id: 'vox',
    label: 'Vox',
    executableName: 'Vox',
    bundleId: 'com.moirasia.vox',
    description: 'Dictate into any app with local speech recognition and a floating status overlay.',
    iconKey: 'mic',
    groupId: 'voice',
    requirements: {
      standalone: { preloads: ['main', 'overlay'], renderers: ['main', 'overlay'], native: ['executable'], dataDirectory: true },
      suite: { preloads: ['overlay'], renderers: ['overlay'], native: ['executable'], dataDirectory: true }
    }
  },
  {
    id: 'exithibition',
    label: 'Exithibition',
    executableName: 'Exithibition',
    bundleId: 'com.local.Exithibition',
    description: 'Live Apple-silicon telemetry rendered as an interactive hardware schematic.',
    iconKey: 'activity',
    groupId: 'monitoring',
    requirements: {
      standalone: { preloads: ['main'], renderers: ['main'], native: ['executable'], dataDirectory: true },
      suite: { native: ['executable'], dataDirectory: true }
    }
  },
  {
    id: 'bonded',
    label: 'Bonded',
    executableName: 'Bonded',
    bundleId: 'com.opense.Bonded',
    description: 'Monitor network activity and block destinations learned from selected applications.',
    iconKey: 'shield-check',
    groupId: 'monitoring',
    requirements: {
      standalone: { preloads: ['main'], renderers: ['main'], native: ['helper'], dataDirectory: true },
      suite: { native: ['helper'], dataDirectory: true }
    }
  },
  {
    id: 'orbis',
    label: 'Orbis',
    executableName: 'Orbis',
    bundleId: 'com.opense.Orbis',
    description: 'Read-only disk usage scanning with a sunburst view of the folders taking space.',
    iconKey: 'bar-chart-3',
    groupId: 'monitoring',
    requirements: {
      standalone: { preloads: ['main'], renderers: ['main'], workers: ['scan'], dataDirectory: true },
      suite: { workers: ['scan'], dataDirectory: true }
    }
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

function freezeRequirements(requirements: FeatureResourceRequirements): FeatureResourceRequirements {
  for (const values of [requirements.preloads, requirements.renderers, requirements.native, requirements.workers]) {
    if (values) Object.freeze(values)
  }
  return Object.freeze(requirements)
}

function buildCatalog(): FeatureCatalog {
  const groupIds = new Set<string>(GROUPS.map((group) => group.id))
  const ids = new Set<string>()
  const bundleIds = new Set<string>()
  for (const seed of FEATURE_SEEDS) {
    if (ids.has(seed.id)) throw new Error(`Feature catalog has a duplicate id '${seed.id}'.`)
    if (bundleIds.has(seed.bundleId)) throw new Error(`Feature catalog has a duplicate bundle id '${seed.bundleId}'.`)
    if (!groupIds.has(seed.groupId)) throw new Error(`Feature '${seed.id}' references unknown group '${seed.groupId}'.`)
    if (!seed.label.trim()) throw new Error(`Feature '${seed.id}' has an empty label.`)
    if (!seed.description.trim()) throw new Error(`Feature '${seed.id}' has an empty description.`)
    if (!seed.executableName.trim()) throw new Error(`Feature '${seed.id}' has an empty executable name.`)
    if (!seed.requirements.standalone || !seed.requirements.suite) throw new Error(`Feature '${seed.id}' is missing requirements for a host mode.`)
    ids.add(seed.id)
    bundleIds.add(seed.bundleId)
  }

  const entries = FEATURE_SEEDS.map((seed) => {
    const requirements: Record<FeatureHostMode, FeatureResourceRequirements> = {
      standalone: freezeRequirements(seed.requirements.standalone),
      suite: freezeRequirements(seed.requirements.suite)
    }
    return Object.freeze({ ...seed, requirements: Object.freeze(requirements) }) as FeatureCatalogEntry
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