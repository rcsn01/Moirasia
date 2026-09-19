import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { moirasiaNativeFeaturePaths } from '../src/main/paths'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function setupRoots(): { resourcesRoot: string; suiteRoot: string; packagedBonded: string; packagedShout: string; stagedBonded: string; stagedShout: string } {
  const root = mkdtempSync(join(tmpdir(), 'moirasia-native-paths-'))
  roots.push(root)
  const resourcesRoot = join(root, 'Resources')
  const suiteRoot = join(root, 'suite')
  const packagedBonded = join(resourcesRoot, 'features/bonded/native/BondedFirewallHelper')
  const packagedShout = join(resourcesRoot, 'features/shout/driver')
  const stagedBonded = join(suiteRoot, 'native/staged/features/bonded/native/BondedFirewallHelper')
  const stagedShout = join(suiteRoot, 'native/staged/features/shout/driver')
  return { resourcesRoot, suiteRoot, packagedBonded, packagedShout, stagedBonded, stagedShout }
}

function createFile(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '')
}

describe('native feature paths', () => {
  it('uses the packaged helper file and Shout parent directory first', () => {
    const paths = setupRoots()
    createFile(paths.packagedBonded)
    mkdirSync(paths.packagedShout, { recursive: true })
    createFile(paths.stagedBonded)
    mkdirSync(paths.stagedShout, { recursive: true })

    expect(moirasiaNativeFeaturePaths(paths.resourcesRoot, paths.suiteRoot)).toEqual({
      bondedHelperPath: paths.packagedBonded,
      shoutDriverPath: paths.packagedShout
    })
  })

  it('falls back to the staged helper file and driver parent directory', () => {
    const paths = setupRoots()
    createFile(paths.stagedBonded)
    mkdirSync(paths.stagedShout, { recursive: true })

    expect(moirasiaNativeFeaturePaths(paths.resourcesRoot, paths.suiteRoot)).toEqual({
      bondedHelperPath: paths.stagedBonded,
      shoutDriverPath: paths.stagedShout
    })
  })

  it('checks the Shout parent directory rather than requiring the bundle itself', () => {
    const paths = setupRoots()
    mkdirSync(paths.packagedShout, { recursive: true })
    createFile(paths.stagedShout + '/ShoutMic.driver')

    expect(moirasiaNativeFeaturePaths(paths.resourcesRoot, paths.suiteRoot).shoutDriverPath).toBe(paths.packagedShout)
  })
})
