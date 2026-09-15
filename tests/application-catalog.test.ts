import { describe, expect, it } from 'vitest'
import { applicationCatalog, isApplicationId, type ApplicationId } from '../packages/desktop-shell/src/application-catalog'

describe('application catalog', () => {
  it('pins the catalog order that menu accelerators and index-dependent consumers rely on', () => {
    expect(applicationCatalog.ids).toEqual(['amove', 'vox', 'bonded', 'shout'])
    expect(applicationCatalog.entries.map((entry) => entry.id)).toEqual(applicationCatalog.ids)
  })

  it('accepts exactly the four application ids and rejects lookalikes', () => {
    for (const id of applicationCatalog.ids) expect(isApplicationId(id)).toBe(true)
    for (const value of ['apps', 'settings', '', null, undefined, 42, 'moirasia', 'yn360', 'amovee', 'shou']) {
      expect(applicationCatalog.isId(value)).toBe(false)
    }
  })

  it('carries complete metadata for every entry', () => {
    expect(applicationCatalog.entries.length).toBeGreaterThan(0)
    for (const entry of applicationCatalog.entries) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.executableName.length).toBeGreaterThan(0)
      expect(entry.bundleId).toMatch(/^[a-z0-9.-]+$/i)
    }
  })

  it('matches bundle ids and executable names to the standalone bundles', () => {
    expect(applicationCatalog.get('amove').bundleId).toBe('com.opense.Amove')
    expect(applicationCatalog.get('vox').bundleId).toBe('com.moirasia.vox')
    expect(applicationCatalog.get('bonded').bundleId).toBe('com.opense.Bonded')
    expect(applicationCatalog.get('shout').bundleId).toBe('com.opense.Shout')
    expect(applicationCatalog.entries.map((entry) => entry.executableName)).toEqual(['Amove', 'Vox', 'Bonded', 'Shout'])
  })

  it('throws on unknown ids and freezes the catalog against mutation', () => {
    expect(() => applicationCatalog.get('yn360' as ApplicationId)).toThrow(/Unknown application/)
    expect(Object.isFrozen(applicationCatalog)).toBe(true)
    expect(Object.isFrozen(applicationCatalog.entries)).toBe(true)
    expect(Object.isFrozen(applicationCatalog.ids)).toBe(true)
    for (const entry of applicationCatalog.entries) expect(Object.isFrozen(entry)).toBe(true)
  })
})