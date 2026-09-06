import { describe, expect, it } from 'vitest'
import { FEATURE_IDS, buildCatalog, featureCatalog, isFeatureId, type FeatureCatalogEntry, type FeatureId } from '../packages/desktop-shell/src/feature-catalog'

const amoveEntry = featureCatalog.get('amove')

/** A complete, valid seed the mutation tests below break in exactly one way. */
function validSeed(overrides: Partial<FeatureCatalogEntry> = {}): FeatureCatalogEntry {
  const base = featureCatalog.get('orbis')
  return { ...base, id: 'orbis', ...overrides } as FeatureCatalogEntry
}

describe('feature catalog', () => {
  it('pins the catalog order that menu accelerators and index-dependent consumers rely on', () => {
    expect(FEATURE_IDS).toEqual(['amove', 'exithibition', 'bonded', 'orbis'])
    expect(featureCatalog.entries.map((entry) => entry.id)).toEqual(FEATURE_IDS)
  })

  it('accepts exactly the four feature ids and rejects lookalikes', () => {
    for (const id of FEATURE_IDS) expect(isFeatureId(id)).toBe(true)
    for (const value of ['vox', 'apps', 'settings', '', null, undefined, 42, 'moirasia', 'yn360', 'amovee']) {
      expect(featureCatalog.isId(value)).toBe(false)
    }
  })

  it('carries complete metadata for every entry', () => {
    const groupIds = new Set(featureCatalog.groups.map((group) => group.id))
    expect(featureCatalog.entries.length).toBeGreaterThan(0)
    for (const entry of featureCatalog.entries) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.executableName.length).toBeGreaterThan(0)
      expect(entry.bundleId).toMatch(/^[a-z0-9.-]+$/i)
      expect(groupIds.has(entry.groupId)).toBe(true)
      expect(entry.requirements.standalone).toBeDefined()
      expect(entry.requirements.suite).toBeDefined()
    }
  })

  it('derives display groups in catalog order', () => {
    expect(featureCatalog.groups.map((group) => [group.id, group.features])).toEqual([
      ['window-management', ['amove']],
      ['monitoring', ['exithibition', 'bonded', 'orbis']]
    ])
  })

  it('keeps the requirements transcribed from the former defaultRequirements switch', () => {
    expect(featureCatalog.get('amove').requirements.standalone).toEqual({ preloads: ['main', 'shelf'], renderers: ['main', 'shelf'], native: ['addon'], assetsDirectory: true, dataDirectory: true })
    expect(featureCatalog.get('orbis').requirements.suite).toEqual({ workers: ['scan'], dataDirectory: true })
    expect(featureCatalog.get('exithibition').requirements.standalone).toEqual({ preloads: ['main'], renderers: ['main'], native: ['executable'], dataDirectory: true })
    expect(featureCatalog.get('bonded').requirements.suite).toEqual({ native: ['helper'], dataDirectory: true })
  })

  it('matches bundle ids and executable names to the standalone bundles', () => {
    expect(featureCatalog.get('amove').bundleId).toBe('com.opense.Amove')
    expect(featureCatalog.get('exithibition').bundleId).toBe('com.local.Exithibition')
    expect(featureCatalog.get('bonded').bundleId).toBe('com.opense.Bonded')
    expect(featureCatalog.get('orbis').bundleId).toBe('com.opense.Orbis')
    expect(featureCatalog.entries.map((entry) => entry.executableName)).toEqual(['Amove', 'Exithibition', 'Bonded', 'Orbis'])
  })

  it('owns the artifact facet for every feature', () => {
    expect(featureCatalog.entries.map((entry) => [entry.id, entry.directory, entry.artifacts.length])).toEqual([
      ['amove', 'Amove', 2],
      ['exithibition', 'Exithibition', 1],
      ['bonded', 'Bonded', 1],
      ['orbis', 'Orbis', 2]
    ])
  })

  it('pins the standalone window facts the feature surface host joins with its own chrome', () => {
    expect(featureCatalog.entries.map((entry) => [entry.id, entry.standaloneWindow])).toEqual([
      ['amove', { width: 1180, height: 760, minWidth: 980, minHeight: 700, navigation: 'allow-same-url' }],
      ['exithibition', { width: 1180, height: 760, minWidth: 1080, minHeight: 690 }],
      ['bonded', { width: 430, height: 600, minWidth: 390, minHeight: 500, fullscreenable: false }],
      ['orbis', { width: 1280, height: 820, minWidth: 860, minHeight: 600 }]
    ])
  })

  it('rejects invalid standalone window facts at build time', () => {
    const width = amoveEntry.standaloneWindow
    const broken: Array<[string, Partial<FeatureCatalogEntry>]> = [
      ['zero width', { standaloneWindow: { ...width, width: 0 } }],
      ['fractional height', { standaloneWindow: { ...width, height: 760.5 } }],
      ['negative minWidth', { standaloneWindow: { ...width, minWidth: -1 } }],
      ['minWidth over width', { standaloneWindow: { ...width, minWidth: width.width + 1 } }],
      ['minHeight over height', { standaloneWindow: { ...width, minHeight: width.height + 1 } }],
      ['unknown navigation', { standaloneWindow: { ...width, navigation: 'bogus' as never } }],
      ['explicit fullscreenable true', { standaloneWindow: { ...width, fullscreenable: true } }]
    ]
    for (const [label, overrides] of broken) {
      expect(() => buildCatalog([validSeed(overrides)]), label).toThrow(/standalone window/)
    }
  })

  it('throws on unknown ids and freezes the catalog against mutation', () => {
    expect(() => featureCatalog.get('yn360' as FeatureId)).toThrow(/Unknown feature/)
    expect(Object.isFrozen(featureCatalog)).toBe(true)
    expect(Object.isFrozen(featureCatalog.entries)).toBe(true)
    expect(Object.isFrozen(featureCatalog.ids)).toBe(true)
    for (const entry of featureCatalog.entries) {
      expect(Object.isFrozen(entry)).toBe(true)
      expect(Object.isFrozen(entry.requirements)).toBe(true)
      expect(Object.isFrozen(entry.artifacts)).toBe(true)
      expect(Object.isFrozen(entry.standaloneWindow)).toBe(true)
      for (const artifact of entry.artifacts) expect(Object.isFrozen(artifact)).toBe(true)
    }
  })
})