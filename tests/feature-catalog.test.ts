import { describe, expect, it } from 'vitest'
import { FEATURE_IDS, buildCatalog, featureCatalog, isFeatureId, type FeatureArtifact, type FeatureCatalogEntry, type FeatureId } from '../packages/desktop-shell/src/feature-catalog'

const amoveEntry = featureCatalog.get('amove')
const shoutEntry = featureCatalog.get('shout')

/** A complete, valid seed the mutation tests below break in exactly one way. */
function validSeed(overrides: Partial<FeatureCatalogEntry> = {}): FeatureCatalogEntry {
  const base = featureCatalog.get('bonded')
  return { ...base, id: 'bonded', ...overrides } as FeatureCatalogEntry
}

describe('feature catalog', () => {
  it('pins the catalog order that menu accelerators and index-dependent consumers rely on', () => {
    expect(FEATURE_IDS).toEqual(['amove', 'bonded', 'shout'])
    expect(featureCatalog.entries.map((entry) => entry.id)).toEqual(FEATURE_IDS)
  })

  it('accepts exactly the three feature ids and rejects lookalikes', () => {
    for (const id of FEATURE_IDS) expect(isFeatureId(id)).toBe(true)
    for (const value of ['vox', 'apps', 'settings', '', null, undefined, 42, 'moirasia', 'yn360', 'amovee', 'shou']) {
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
      ['monitoring', ['bonded']],
      ['audio', ['shout']]
    ])
  })

  it('keeps the requirements transcribed from the former defaultRequirements switch', () => {
    expect(featureCatalog.get('amove').requirements.standalone).toEqual({ preloads: ['main', 'shelf'], renderers: ['main', 'shelf'], native: ['addon'], assetsDirectory: true, dataDirectory: true })
    expect(featureCatalog.get('bonded').requirements.suite).toEqual({ native: ['helper'], dataDirectory: true })
    expect(shoutEntry.requirements.standalone).toEqual({ preloads: ['main'], renderers: ['main'], native: ['helper', 'driver'], dataDirectory: true })
    expect(shoutEntry.requirements.suite).toEqual({ native: ['helper', 'driver'], dataDirectory: true })
  })

  it('matches bundle ids and executable names to the standalone bundles', () => {
    expect(featureCatalog.get('amove').bundleId).toBe('com.opense.Amove')
    expect(featureCatalog.get('bonded').bundleId).toBe('com.opense.Bonded')
    expect(shoutEntry.bundleId).toBe('com.opense.Shout')
    expect(featureCatalog.entries.map((entry) => entry.executableName)).toEqual(['Amove', 'Bonded', 'Shout'])
  })

  it('owns the artifact facet for every feature', () => {
    expect(featureCatalog.entries.map((entry) => [entry.id, entry.directory, entry.artifacts.length])).toEqual([
      ['amove', 'Amove', 2],
      ['bonded', 'Bonded', 1],
      ['shout', 'Shout', 2]
    ])
    expect(shoutEntry.artifacts.map((artifact) => [artifact.name, artifact.kind, artifact.file])).toEqual([
      ['helper', 'executable', 'ShoutAudioHelper'],
      ['driver', 'bundle', 'ShoutMic.driver']
    ])
  })

  it('pins the standalone window facts the feature surface host joins with its own chrome', () => {
    expect(featureCatalog.entries.map((entry) => [entry.id, entry.standaloneWindow])).toEqual([
      ['amove', { width: 1180, height: 760, minWidth: 980, minHeight: 700, navigation: 'allow-same-url' }],
      ['bonded', { width: 430, height: 600, minWidth: 390, minHeight: 500, fullscreenable: false }],
      ['shout', { width: 430, height: 640, minWidth: 390, minHeight: 500, fullscreenable: false }]
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

  it('rejects malformed artifact data at the catalog input seam', () => {
    const bondedArtifact = featureCatalog.get('bonded').artifacts[0]!
    const amoveArtifacts = featureCatalog.get('amove').artifacts
    const broken: Array<[string, unknown]> = [
      ['unsupported kind', { ...bondedArtifact, kind: 'unknown' }],
      ['empty build output', { ...bondedArtifact, buildOutput: '' }],
      ['invalid suite source', { ...bondedArtifact, suiteDevSource: 'other' }],
      ['unsupported build placeholder', { ...bondedArtifact, buildOutput: 'native/{other}' }],
      ['absolute build output', { ...bondedArtifact, buildOutput: '/tmp/helper' }],
      ['traversal staged destination', { ...bondedArtifact, staged: 'native/../outside' }],
      ['missing filename', { ...bondedArtifact, file: undefined }],
      ['nested filename', { ...bondedArtifact, file: 'nested/helper' }],
      ['native filename with extension', { ...amoveArtifacts[0]!, file: 'amove-native.node' }],
      ['assets filename', { ...amoveArtifacts[1]!, file: 'assets' }]
    ]

    for (const [label, artifact] of broken) {
      expect(() => buildCatalog([validSeed({ artifacts: [artifact as FeatureArtifact] })]), label).toThrow(/artifact/)
    }
    expect(() => buildCatalog([validSeed({ artifacts: [bondedArtifact, bondedArtifact] })])).toThrow(/duplicate artifact name/)
    expect(() => buildCatalog([validSeed({ artifacts: undefined as never })])).toThrow(/artifact data must be an array/)
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