import { describe, expect, it } from 'vitest'
import { APPLICATION_IDS, isApplicationId, isControllerPage } from '../src/shared/contracts'
describe('controller contracts', () => {
  it('exposes only standalone applications and two pages', () => {
    expect(APPLICATION_IDS).toEqual(['amove', 'vox', 'exithibition'])
    expect(isApplicationId('vox')).toBe(true); expect(isApplicationId('module')).toBe(false)
    expect(isControllerPage('apps')).toBe(true); expect(isControllerPage('settings')).toBe(true); expect(isControllerPage('home')).toBe(false)
  })
})
