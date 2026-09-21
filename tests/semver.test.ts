import { describe, expect, it } from 'vitest'
import { compareSemver, parseSemver } from '@moirasia/desktop-shell/app-updater'

describe('semver', () => {
  it('accepts semantic versions and rejects malformed versions', () => {
    expect(parseSemver('1.0.0')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: [] })
    expect(parseSemver('2.1.0-rc.1+build.7')).toMatchObject({ major: 2, minor: 1, patch: 0, prerelease: ['rc', '1'] })
    expect(parseSemver('1.0')).toBeUndefined()
    expect(parseSemver('01.0.0')).toBeUndefined()
  })

  it('orders releases the same way as the packaging script', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
    expect(compareSemver('0.9.9', '1.0.0')).toBeLessThan(0)
    expect(compareSemver('1.0.1', '1.0.0')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
  })
})
