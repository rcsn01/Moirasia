import { describe, expect, it } from 'vitest'
import { buildFeatureStagingPlan, loadFeatureArtifactData } from './feature-staging-plan.mjs'

const options = {
  repoRoot: '/repo',
  productRoots: {
    amove: '/repo/apps/integrated/Amove',
    bonded: '/repo/apps/integrated/Bonded',
    shout: '/repo/apps/integrated/Shout'
  },
  platform: 'darwin',
  arch: 'arm64',
  configuration: 'release'
}

describe('feature staging plan', () => {
  it('creates one exact copy record for each current artifact', () => {
    const plan = buildFeatureStagingPlan(options, loadFeatureArtifactData())

    expect(plan).toEqual([
      {
        featureId: 'amove', artifactName: 'addon', kind: 'native', mode: 'file',
        sourcePath: '/repo/apps/integrated/Amove/native/amove-native.darwin-arm64.node',
        destinationPath: '/repo/native/staged/features/amove/native/amove-native.darwin-arm64.node',
        expectedPath: '/repo/apps/integrated/Amove/native/amove-native.darwin-arm64.node'
      },
      {
        featureId: 'amove', artifactName: 'assets', kind: 'assets', mode: 'directory',
        sourcePath: '/repo/apps/integrated/Amove/assets',
        destinationPath: '/repo/native/staged/features/amove/assets',
        expectedPath: '/repo/apps/integrated/Amove/assets'
      },
      {
        featureId: 'bonded', artifactName: 'helper', kind: 'executable', mode: 'file',
        sourcePath: '/repo/apps/integrated/Bonded/native/.build/arm64-apple-macosx/release/BondedFirewallHelper',
        destinationPath: '/repo/native/staged/features/bonded/native/BondedFirewallHelper',
        expectedPath: '/repo/apps/integrated/Bonded/native/.build/arm64-apple-macosx/release/BondedFirewallHelper'
      },
      {
        featureId: 'shout', artifactName: 'helper', kind: 'executable', mode: 'file',
        sourcePath: '/repo/apps/integrated/Shout/native/.build/out/Products/Release/ShoutAudioHelper',
        destinationPath: '/repo/native/staged/features/shout/native/ShoutAudioHelper',
        expectedPath: '/repo/apps/integrated/Shout/native/.build/out/Products/Release/ShoutAudioHelper'
      },
      {
        featureId: 'shout', artifactName: 'driver', kind: 'bundle', mode: 'directory',
        sourcePath: '/repo/apps/integrated/Shout/native/driver/dist',
        destinationPath: '/repo/native/staged/features/shout/driver',
        expectedPath: '/repo/apps/integrated/Shout/native/driver/dist/ShoutMic.driver'
      }
    ])
  })

  it('uses the explicit target instead of the running process architecture', () => {
    const plan = buildFeatureStagingPlan({ ...options, arch: 'x64' }, loadFeatureArtifactData())
    expect(plan[0].sourcePath).toBe('/repo/apps/integrated/Amove/native/amove-native.darwin-x64.node')
  })

  it('rejects malformed artifact data before a copy adapter can run', () => {
    const data = structuredClone(loadFeatureArtifactData())
    data.amove[0].buildOutput = '../outside'

    expect(() => buildFeatureStagingPlan(options, data)).toThrow(/amove.*addon|path/i)
  })
})
