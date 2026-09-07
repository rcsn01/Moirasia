/**
 * The application catalog: the single owner of every shared fact about the
 * controlled family applications — identity, labels, bundle and executable names, and
 * order. Pure data: no Electron, React, filesystem, or product-package imports.
 * Host-specific code (menu accelerators, agent commands, login-item control)
 * stays with its host.
 */

export interface ApplicationCatalogEntry {
  readonly id: ApplicationId
  readonly label: string          // display name; menu, controller, snapshots
  readonly executableName: string // binary name inside Contents/MacOS for --moirasia-control
  readonly bundleId: string       // standalone bundle identifier
}

/** The controlled family applications. The catalog seeds below and this union must stay in sync;
 * tests pin the exact list and every array-index-dependent consumer relies on the order. */
export type ApplicationId = 'amove' | 'vox' | 'bonded'

const APPLICATION_SEEDS = [
  { id: 'amove', label: 'Amove', executableName: 'Amove', bundleId: 'com.opense.Amove' },
  { id: 'vox', label: 'Vox', executableName: 'Vox', bundleId: 'com.moirasia.vox' },
  { id: 'bonded', label: 'Bonded', executableName: 'Bonded', bundleId: 'com.opense.Bonded' }
] as const satisfies readonly ApplicationCatalogEntry[]

export interface ApplicationCatalog {
  /** Catalog order is the menu order: Command+1..3 and every array-index-dependent consumer. */
  readonly ids: readonly ApplicationId[]
  readonly entries: readonly ApplicationCatalogEntry[]
  isId(value: unknown): value is ApplicationId
  /** Throws on an id outside the catalog. */
  get(id: ApplicationId): ApplicationCatalogEntry
}

export const applicationCatalog: ApplicationCatalog = buildCatalog()
export const APPLICATION_IDS = applicationCatalog.ids

export function isApplicationId(value: unknown): value is ApplicationId {
  return applicationCatalog.isId(value)
}

function buildCatalog(): ApplicationCatalog {
  const ids = new Set<string>()
  const bundleIds = new Set<string>()
  for (const seed of APPLICATION_SEEDS) {
    if (ids.has(seed.id)) throw new Error(`Application catalog has a duplicate id '${seed.id}'.`)
    if (bundleIds.has(seed.bundleId)) throw new Error(`Application catalog has a duplicate bundle id '${seed.bundleId}'.`)
    if (!seed.label.trim()) throw new Error(`Application '${seed.id}' has an empty label.`)
    if (!seed.executableName.trim()) throw new Error(`Application '${seed.id}' has an empty executable name.`)
    ids.add(seed.id)
    bundleIds.add(seed.bundleId)
  }

  const entries = APPLICATION_SEEDS.map((seed) => Object.freeze({ ...seed }) as ApplicationCatalogEntry)
  const byId = new Map<string, ApplicationCatalogEntry>(entries.map((entry) => [entry.id, entry]))

  return Object.freeze({
    ids: Object.freeze(entries.map((entry) => entry.id)),
    entries: Object.freeze(entries),
    isId(value: unknown): value is ApplicationId {
      return typeof value === 'string' && byId.has(value)
    },
    get(id: ApplicationId): ApplicationCatalogEntry {
      const entry = byId.get(id)
      if (!entry) throw new Error(`Unknown application '${String(id)}'.`)
      return entry
    }
  })
}