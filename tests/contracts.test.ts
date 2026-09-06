import { describe, expect, it } from 'vitest'
import { APPLICATION_IDS, applicationCatalog } from '../packages/desktop-shell/src/application-catalog'
import { FEATURE_IDS } from '../packages/desktop-shell/src/feature'
import { isApplicationId, isControllerPage } from '../src/shared/contracts'
describe('controller contracts', () => {
  it('exposes standalone applications and embedded controller pages', () => {
    expect(APPLICATION_IDS).toEqual(['amove', 'vox', 'exithibition', 'bonded', 'orbis'])
    expect(applicationCatalog.entries.map((entry) => entry.id)).toEqual(APPLICATION_IDS)
    expect(FEATURE_IDS).toEqual(['amove', 'exithibition', 'bonded', 'orbis'])
    expect(isApplicationId('vox')).toBe(true); expect(isApplicationId('bonded')).toBe(true); expect(isApplicationId('orbis')).toBe(true); expect(isApplicationId('module')).toBe(false)
    expect(isControllerPage('general')).toBe(true); expect(isControllerPage('features')).toBe(true); expect(isControllerPage('vox')).toBe(false); expect(isControllerPage('bonded')).toBe(true); expect(isControllerPage('orbis')).toBe(true)
    expect(isControllerPage('apps')).toBe(false); expect(isControllerPage('settings')).toBe(false); expect(isControllerPage('home')).toBe(false)
  })
})