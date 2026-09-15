import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ app: { isPackaged: false, getAppPath: vi.fn(() => '/workspace'), getPath: vi.fn((name: string) => name === 'userData' ? '/Users/test/Library/Application Support/Moirasia' : '/Users/test/Library/Application Support') } }))
vi.mock('electron', () => ({ app: electron.app }))

import { suiteFeatureContext } from '../src/main/features/runtime'

const surface = { webContents: {}, state: { active: false, focused: false }, activate: vi.fn(), focus: vi.fn(), subscribe: vi.fn(() => () => undefined) }
const originalResourcesPath = process.resourcesPath
const RESOURCES = '/Applications/Moirasia.app/Contents/Resources'
const useResourcesPath = (value: string): void => { Object.defineProperty(process, 'resourcesPath', { value, configurable: true }) }
afterEach(() => { electron.app.isPackaged = false; Object.defineProperty(process, 'resourcesPath', { value: originalResourcesPath, configurable: true }) })

// The final paths below are pinned literally (repo culture): they pin the join
// between the catalog's artifact facts and the host roots. A catalog or host
// change that moves a path turns one of these red instead of silently re-encoding.
describe('suite feature paths', () => {
  describe('Amove', () => {
    it('uses the app repo build output and isolated settings in development', () => {
      const context = suiteFeatureContext('amove', surface as never)
      expect(context.paths.native?.addon).toBe('/workspace/apps/integrated/Amove/native/amove-native.darwin-arm64.node')
      expect(context.paths.assetsDirectory).toBe('/workspace/apps/integrated/Amove/assets')
      expect(context.paths.dataDirectory).toBe('/Users/test/Library/Application Support/Moirasia/features/amove')
      expect(context.paths.legacyDataDirectories).toEqual(['/Users/test/Library/Application Support/Amove'])
    })

    it('uses the namespaced packaged addon and assets', () => {
      electron.app.isPackaged = true
      Object.defineProperty(process, 'resourcesPath', { value: RESOURCES, configurable: true })
      const context = suiteFeatureContext('amove', surface as never)
      expect(context.paths.native?.addon).toBe(`${RESOURCES}/features/amove/native/amove-native.darwin-arm64.node`)
      expect(context.paths.assetsDirectory).toBe(`${RESOURCES}/features/amove/assets`)
    })
  })



  describe('Bonded', () => {
    it('uses the debug helper and isolated settings in development', () => {
      const context = suiteFeatureContext('bonded', surface as never)
      expect(context.paths.native?.helper).toBe('/workspace/apps/integrated/Bonded/native/.build/arm64-apple-macosx/debug/BondedFirewallHelper')
      expect(context.paths.dataDirectory).toBe('/Users/test/Library/Application Support/Moirasia/features/bonded')
      expect(context.paths.legacyDataDirectories).toEqual(['/Users/test/Library/Application Support/Bonded'])
    })

    it('uses the namespaced packaged helper', () => {
      electron.app.isPackaged = true
      Object.defineProperty(process, 'resourcesPath', { value: RESOURCES, configurable: true })
      const context = suiteFeatureContext('bonded', surface as never)
      expect(context.paths.native?.helper).toBe('/Applications/Moirasia.app/Contents/Resources/features/bonded/native/BondedFirewallHelper')
    })
  })

  describe('Shout', () => {
    it('uses the debug helper and staged driver in development', () => {
      const context = suiteFeatureContext('shout', surface as never)
      expect(context.paths.native?.helper).toBe('/workspace/apps/integrated/Shout/native/.build/out/Products/Debug/ShoutAudioHelper')
      expect(context.paths.native?.driver).toBe('/workspace/native/staged/features/shout/driver/ShoutMic.driver')
      expect(context.paths.dataDirectory).toBe('/Users/test/Library/Application Support/Moirasia/features/shout')
      expect(context.paths.legacyDataDirectories).toEqual(['/Users/test/Library/Application Support/Shout'])
    })

    it('uses the namespaced packaged helper and driver', () => {
      electron.app.isPackaged = true
      Object.defineProperty(process, 'resourcesPath', { value: RESOURCES, configurable: true })
      const context = suiteFeatureContext('shout', surface as never)
      expect(context.paths.native?.helper).toBe('/Applications/Moirasia.app/Contents/Resources/features/shout/native/ShoutAudioHelper')
      expect(context.paths.native?.driver).toBe('/Applications/Moirasia.app/Contents/Resources/features/shout/driver/ShoutMic.driver')
    })
  })


})