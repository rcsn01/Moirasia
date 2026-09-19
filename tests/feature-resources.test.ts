import { describe, expect, it } from 'vitest'
import { resolveFeatureResources, resolveFeatureArtifact } from '@moirasia/desktop-shell/feature-resources'
import { nativeAddonFileName } from '@moirasia/desktop-shell/feature'

describe('feature resource resolver', () => {
  it('resolves suite development build-output artifacts and assets', () => {
    const resources = resolveFeatureResources('amove', { kind: 'suite-development', suiteRoot: '/workspace' })

    expect(resources.native.addon).toBe(`/workspace/apps/integrated/Amove/native/${nativeAddonFileName('amove-native')}`)
    expect(resources.assetsDirectory).toBe('/workspace/apps/integrated/Amove/assets')
    expect(resources.workers).toEqual({})
  })

  it('resolves suite development staged artifacts and explicit suite-staged lookup', () => {
    const source = { kind: 'suite-development' as const, suiteRoot: '/workspace' }
    expect(resolveFeatureResources('shout', source).native.driver).toBe('/workspace/native/staged/features/shout/driver/ShoutMic.driver')
    expect(resolveFeatureArtifact('shout', 'driver', { kind: 'suite-staged', suiteRoot: '/workspace' })).toBe('/workspace/native/staged/features/shout/driver/ShoutMic.driver')
  })

  it('resolves suite packaged files, bundles, and stable output maps', () => {
    const resources = resolveFeatureResources('shout', { kind: 'suite-packaged', resourcesRoot: '/Applications/Moirasia.app/Contents/Resources' })

    expect(resources.native).toEqual({
      helper: '/Applications/Moirasia.app/Contents/Resources/features/shout/native/ShoutAudioHelper',
      driver: '/Applications/Moirasia.app/Contents/Resources/features/shout/driver/ShoutMic.driver'
    })
    expect(resources.workers).toEqual({})
  })

  it('resolves standalone development and packaged resources', () => {
    const development = resolveFeatureResources('shout', { kind: 'standalone-development', productRoot: '/workspace/apps/integrated/Shout' })
    expect(development.native).toEqual({
      helper: '/workspace/apps/integrated/Shout/native/.build/out/Products/Debug/ShoutAudioHelper',
      driver: '/workspace/apps/integrated/Shout/native/driver/dist/ShoutMic.driver'
    })

    const packaged = resolveFeatureResources('amove', {
      kind: 'standalone-packaged',
      appRoot: '/Applications/Amove.app/Contents/Resources/app.asar',
      resourcesRoot: '/Applications/Amove.app/Contents/Resources'
    })
    expect(packaged.native.addon).toBe(`/Applications/Amove.app/Contents/Resources/native/${nativeAddonFileName('amove-native')}`)
    expect(packaged.assetsDirectory).toBe('/Applications/Amove.app/Contents/Resources/app.asar/assets')
  })

  it('expands both configuration placeholder casings', () => {
    expect(resolveFeatureArtifact('bonded', 'helper', { kind: 'suite-development', suiteRoot: '/workspace' })).toBe('/workspace/apps/integrated/Bonded/native/.build/arm64-apple-macosx/debug/BondedFirewallHelper')
    expect(resolveFeatureArtifact('shout', 'helper', { kind: 'standalone-development', productRoot: '/workspace/apps/integrated/Shout' })).toBe('/workspace/apps/integrated/Shout/native/.build/out/Products/Debug/ShoutAudioHelper')
  })

  it('reports unknown features, artifacts, invalid sources, and missing roots', () => {
    const source = { kind: 'suite-development' as const, suiteRoot: '/workspace' }
    expect(() => resolveFeatureResources('unknown' as never, source)).toThrow(/Unknown feature 'unknown'/)
    expect(() => resolveFeatureArtifact('amove', 'unknown', source)).toThrow(/Feature 'amove' has no artifact named 'unknown'/)
    expect(() => resolveFeatureResources('amove', { kind: 'invalid' } as never)).toThrow(/invalid resource source kind 'invalid'/)
    expect(() => resolveFeatureResources('amove', { kind: 'suite-development', suiteRoot: 'workspace' })).toThrow(/suiteRoot/)
    expect(() => resolveFeatureArtifact('shout', 'driver', { kind: 'standalone-packaged', appRoot: '/app', resourcesRoot: '' })).toThrow(/resourcesRoot/)
  })
})
