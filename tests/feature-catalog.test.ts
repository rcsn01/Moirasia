import { describe, expect, it } from 'vitest'
import { FEATURE_IDS, featureCatalog, isFeatureId, type FeatureId } from '../packages/desktop-shell/src/feature-catalog'

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

  it('throws on unknown ids and freezes the catalog against mutation', () => {
    expect(() => featureCatalog.get('yn360' as FeatureId)).toThrow(/Unknown feature/)
    expect(Object.isFrozen(featureCatalog)).toBe(true)
    expect(Object.isFrozen(featureCatalog.entries)).toBe(true)
    expect(Object.isFrozen(featureCatalog.ids)).toBe(true)
    for (const entry of featureCatalog.entries) {
      expect(Object.isFrozen(entry)).toBe(true)
      expect(Object.isFrozen(entry.requirements)).toBe(true)
      expect(Object.isFrozen(entry.artifacts)).toBe(true)
      for (const artifact of entry.artifacts) expect(Object.isFrozen(artifact)).toBe(true)
    }
  })
})