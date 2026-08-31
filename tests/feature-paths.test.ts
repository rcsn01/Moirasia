import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ app: { isPackaged: false, getAppPath: vi.fn(() => '/workspace'), getPath: vi.fn((name: string) => name === 'userData' ? '/Users/test/Library/Application Support/Moirasia' : '/Users/test/Library/Application Support') } }))
vi.mock('electron', () => ({ app: electron.app }))

import { suiteFeatureContext } from '../src/main/features/runtime'

const surface = { webContents: {}, state: { active: false, focused: false }, activate: vi.fn(), focus: vi.fn(), subscribe: vi.fn(() => () => undefined) }
const originalResourcesPath = process.resourcesPath
const originalVoxNativePath = process.env.VOX_NATIVE_PATH
afterEach(() => { electron.app.isPackaged = false; Object.defineProperty(process, 'resourcesPath', { value: originalResourcesPath, configurable: true }); if (originalVoxNativePath === undefined) delete process.env.VOX_NATIVE_PATH; else process.env.VOX_NATIVE_PATH = originalVoxNativePath })

describe('Vox suite paths', () => {
  it('uses isolated data, legacy import, overlay entries, and the debug native executable in development', () => {
    const context = suiteFeatureContext('vox', surface as never)
    expect(context.paths.dataDirectory).toBe('/Users/test/Library/Application Support/Moirasia/features/vox')
    expect(context.paths.legacyDataDirectories).toEqual(['/Users/test/Library/Application Support/Vox'])
    expect(context.paths.native?.executable).toBe('/workspace/apps/integrated/Vox/native/.build/arm64-apple-macosx/debug/VoxNative')
    expect(context.paths.preloads?.overlay).toMatch(/feature-vox-overlay\.cjs$/)
    expect(context.paths.renderers?.overlay).toMatch(/apps\/integrated\/Vox\/overlay\.html$/)
  })

  it('prefers the native executable test override', () => {
    process.env.VOX_NATIVE_PATH = '/tmp/VoxNative-fixture'
    expect(suiteFeatureContext('vox', surface as never).paths.native?.executable).toBe('/tmp/VoxNative-fixture')
  })

  it('uses the namespaced packaged executable', () => {
    electron.app.isPackaged = true
    Object.defineProperty(process, 'resourcesPath', { value: '/Applications/Moirasia.app/Contents/Resources', configurable: true })
    expect(suiteFeatureContext('vox', surface as never).paths.native?.executable).toBe('/Applications/Moirasia.app/Contents/Resources/features/vox/native/VoxNative')
  })
})

describe('Bonded suite paths', () => {
  it('uses the debug helper and isolated settings in development', () => {
    const context = suiteFeatureContext('bonded', surface as never)
    expect(context.paths.native?.helper).toBe('/workspace/apps/integrated/Bonded/native/.build/arm64-apple-macosx/debug/BondedFirewallHelper')
    expect(context.paths.dataDirectory).toBe('/Users/test/Library/Application Support/Moirasia/features/bonded')
    expect(context.paths.legacyDataDirectories).toEqual(['/Users/test/Library/Application Support/Bonded'])
  })

  it('uses the namespaced packaged helper', () => {
    electron.app.isPackaged = true
    Object.defineProperty(process, 'resourcesPath', { value: '/Applications/Moirasia.app/Contents/Resources', configurable: true })
    const context = suiteFeatureContext('bonded', surface as never)
    expect(context.paths.native?.helper).toBe('/Applications/Moirasia.app/Contents/Resources/features/bonded/native/BondedFirewallHelper')
  })
})
