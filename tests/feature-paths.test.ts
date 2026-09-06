import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ app: { isPackaged: false, getAppPath: vi.fn(() => '/workspace'), getPath: vi.fn((name: string) => name === 'userData' ? '/Users/test/Library/Application Support/Moirasia' : '/Users/test/Library/Application Support') } }))
vi.mock('electron', () => ({ app: electron.app }))

import { suiteFeatureContext } from '../src/main/features/runtime'

const surface = { webContents: {}, state: { active: false, focused: false }, activate: vi.fn(), focus: vi.fn(), subscribe: vi.fn(() => () => undefined) }
const originalResourcesPath = process.resourcesPath
afterEach(() => { electron.app.isPackaged = false; Object.defineProperty(process, 'resourcesPath', { value: originalResourcesPath, configurable: true }) })

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
