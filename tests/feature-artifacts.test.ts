import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { artifactPath, featureCatalog, nativeAddonFileName, type FeatureArtifact, type FeatureId } from '../packages/desktop-shell/src/feature-catalog'

const repoFile = (relativePath: string): string => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

/** Reads an app-repo file as text. The root gitignores apps/, so a missing repo fails loudly instead of throwing a bare ENOENT. */
const appRepoFile = (directory: string, relativePath: string): string => {
  const url = new URL(`../apps/integrated/${directory}/${relativePath}`, import.meta.url)
  expect(existsSync(url), `apps/integrated/${directory}/${relativePath} is missing`).toBe(true)
  return readFileSync(url, 'utf8')
}

const artifact = (id: FeatureId, name: string): FeatureArtifact => {
  const found = featureCatalog.get(id).artifacts.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`catalog invariant broken: '${id}' has no artifact '${name}'`)
  return found
}

describe('artifact facet table', () => {
  it('pins the Amove facts: napi addon plus asar-embedded assets', () => {
    const entry = featureCatalog.get('amove')
    expect(entry.directory).toBe('Amove')
    expect(entry.artifacts).toEqual([
      { name: 'addon', kind: 'native', file: 'amove-native', buildOutput: 'native', staged: 'native/staged/features/amove/native', suiteResource: 'features/amove/native', suiteDevSource: 'buildOutput', standaloneResource: 'native' },
      { name: 'assets', kind: 'assets', buildOutput: 'assets', staged: 'native/staged/features/amove/assets', suiteResource: 'features/amove/assets', suiteDevSource: 'buildOutput', standaloneResource: 'assets' }
    ])
  })

  it('pins the Bonded firewall helper', () => {
    const entry = featureCatalog.get('bonded')
    expect(entry.directory).toBe('Bonded')
    expect(entry.artifacts).toEqual([
      { name: 'helper', kind: 'executable', file: 'BondedFirewallHelper', buildOutput: 'native/.build/arm64-apple-macosx/{configuration}', staged: 'native/staged/features/bonded/native', suiteResource: 'features/bonded/native', suiteDevSource: 'buildOutput', standaloneResource: 'native' }
    ])
  })

})

describe('nativeAddonFileName', () => {
  it('names darwin addons after the arch', () => {
    expect(nativeAddonFileName('amove-native', 'darwin', 'arm64')).toBe('amove-native.darwin-arm64.node')
    expect(nativeAddonFileName('amove-native', 'darwin', 'x64')).toBe('amove-native.darwin-x64.node')
  })

  it('pins the win32 and linux filenames byte-exact and arch-independent', () => {
    expect(nativeAddonFileName('amove-native', 'win32', 'arm64')).toBe('amove-native.win32-x64-msvc.node')
    expect(nativeAddonFileName('amove-native', 'win32', 'x64')).toBe('amove-native.win32-x64-msvc.node')
  })

  it('defaults to the running platform and arch', () => {
    expect(nativeAddonFileName('amove-native')).toBe(nativeAddonFileName('amove-native', process.platform, process.arch))
  })
})

describe('artifactPath', () => {
  const ADDON = artifact('amove', 'addon')
  const ASSETS = artifact('amove', 'assets')
  const EXECUTABLE = artifact('bonded', 'helper')

  it('appends the exact filename for exact-filename kinds', () => {
    expect(artifactPath('/Resources/features/bonded/native', EXECUTABLE)).toBe('/Resources/features/bonded/native/BondedFirewallHelper')
  })

  it('appends the platform-resolved filename for napi addons', () => {
    expect(artifactPath('/Resources/native', ADDON)).toBe(`/Resources/native/${nativeAddonFileName('amove-native')}`)
  })

  it('returns the directory itself for assets', () => {
    expect(artifactPath('/Resources/features/amove/assets', ASSETS)).toBe('/Resources/features/amove/assets')
  })

  it('tolerates a trailing separator on the directory', () => {
    expect(artifactPath('/Resources/features/bonded/native/', EXECUTABLE)).toBe('/Resources/features/bonded/native/BondedFirewallHelper')
  })
})

describe('catalog artifact invariants', () => {
  it('resolves every native and workers requirement name to an artifact', () => {
    for (const entry of featureCatalog.entries) {
      for (const mode of ['standalone', 'suite'] as const) {
        for (const name of entry.requirements[mode].native ?? []) {
          const found = entry.artifacts.find((candidate) => candidate.name === name)
          expect(found, `${entry.id} ${mode} native requirement '${name}'`).toBeDefined()
          expect(['native', 'executable']).toContain(found!.kind)
        }
        for (const name of entry.requirements[mode].workers ?? []) {
          const found = entry.artifacts.find((candidate) => candidate.name === name)
          expect(found?.kind, `${entry.id} ${mode} workers requirement '${name}'`).toBe('worker')
        }
      }
    }
  })

  it('keeps artifact names unique per feature and every destination non-empty', () => {
    for (const entry of featureCatalog.entries) {
      const names = entry.artifacts.map((candidate) => candidate.name)
      expect(new Set(names).size, `duplicate artifact names in '${entry.id}'`).toBe(names.length)
      for (const candidate of entry.artifacts) {
        expect(candidate.staged.length).toBeGreaterThan(0)
        expect(candidate.suiteResource.length).toBeGreaterThan(0)
        expect(candidate.standaloneResource.length).toBeGreaterThan(0)
        expect(candidate.buildOutput.length).toBeGreaterThan(0)
        if (candidate.kind === 'assets') expect(candidate.file).toBeUndefined()
        else expect(candidate.file?.length ?? 0).toBeGreaterThan(0)
        if (candidate.kind === 'native') expect(candidate.file!.endsWith('.node'), `'${candidate.file}' must be a napi base name`).toBe(false)
      }
    }
  })
})

describe('contract pins — hand-written files agree with the catalog', () => {
  const stageScript = repoFile('scripts/stage-feature-binaries.mjs')
  const suiteBuilderYml = repoFile('electron-builder.yml')
  const rootPackageJson = JSON.parse(repoFile('package.json')) as { scripts: Record<string, string> }

  it('pins the staging script to every staged path and release source layout', () => {
    for (const entry of featureCatalog.entries) {
      for (const candidate of entry.artifacts) {
        expect(stageScript, `${entry.id}/${candidate.name} staged path`).toContain(candidate.staged)
        expect(stageScript, `${entry.id}/${candidate.name} release source`).toContain(candidate.buildOutput.replace('{configuration}', 'release'))
      }
    }
  })

  it('packages every artifact from its staged path to its suite destination', () => {
    for (const entry of featureCatalog.entries) {
      for (const candidate of entry.artifacts) {
        expect(suiteBuilderYml, `${entry.id}/${candidate.name} from`).toContain(`from: ${candidate.staged}`)
        expect(suiteBuilderYml, `${entry.id}/${candidate.name} to`).toContain(`to: ${candidate.suiteResource}`)
      }
    }
  })

  it('pins each standalone bundle layout against the app-owned builder configs', () => {
    for (const entry of featureCatalog.entries) {
      const yml = appRepoFile(entry.directory, 'electron-builder.yml')
      for (const candidate of entry.artifacts) {
        if (candidate.kind === 'assets') {
          // Amove's assets are asar-embedded, not an extraResource.
          expect(yml, `${entry.id}/${candidate.name} asar embedding`).toContain(`${candidate.standaloneResource}/**/*`)
          continue
        }
        expect(yml, `${entry.id}/${candidate.name} standalone destination`).toContain(`to: ${candidate.standaloneResource}`)
        if (candidate.kind === 'executable') expect(yml, `${entry.id}/${candidate.name} filename`).toContain(candidate.file!)
        else expect(yml, `${entry.id}/${candidate.name} build source`).toContain(`from: ${candidate.buildOutput}`)
      }
    }
  })
})