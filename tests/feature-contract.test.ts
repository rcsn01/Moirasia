import { describe, expect, it } from 'vitest'
import { validateFeatureResources, type FeatureContext } from '../packages/desktop-shell/src/feature'

const context = (paths: FeatureContext['paths'], id: 'amove' | 'vox' | 'orbis' = 'amove', mode: 'suite' | 'standalone' = 'suite'): FeatureContext => (mode === 'suite' ? {
  id, mode, productId: id, paths,
  surface: { webContents: {} as never, state: { active: false, focused: false }, activate: () => undefined, focus: () => undefined, subscribe: () => () => undefined }
} : {
  id, mode, productId: id, paths
})


describe('feature resource contract', () => {
  it('validates Vox resources for standalone and suite hosts', () => {
    const shared = { preloads: { main: '/tmp/main.cjs', overlay: '/tmp/overlay.cjs' }, renderers: { main: '/tmp/main.html', overlay: '/tmp/overlay.html' }, native: { executable: '/tmp/VoxNative' }, dataDirectory: '/tmp/vox' }
    expect(() => validateFeatureResources(context(shared, 'vox', 'standalone'))).not.toThrow()
    expect(() => validateFeatureResources(context({ ...shared, preloads: { overlay: '/tmp/overlay.cjs' }, renderers: { overlay: '/tmp/overlay.html' } }, 'vox'))).not.toThrow()
    expect(() => validateFeatureResources(context({ native: shared.native, dataDirectory: shared.dataDirectory }, 'vox'))).toThrow(/preloads\.overlay/)
  })
  it('validates named suite resources and development renderer URLs', () => {
    expect(() => validateFeatureResources(context({
      preloads: { main: '/tmp/main.cjs', shelf: '/tmp/shelf.cjs' },
      renderers: { main: 'http://localhost:5173/feature-amove-main.html', shelf: 'http://localhost:5173/feature-amove-shelf.html' },
      native: { addon: '/tmp/amove.node' },
      assetsDirectory: '/tmp/assets',
      dataDirectory: '/tmp/data'
    }), { preloads: ['main', 'shelf'], renderers: ['main', 'shelf'], native: ['addon'], assetsDirectory: true, dataDirectory: true })).not.toThrow()
  })

  it('validates Orbis workers without requiring a native resource', () => {
    expect(() => validateFeatureResources(context({ workers: { scan: '/tmp/scan-worker.mjs' }, dataDirectory: '/tmp/orbis-data' }, 'orbis'), { workers: ['scan'], dataDirectory: true })).not.toThrow()
    expect(() => validateFeatureResources(context({ dataDirectory: '/tmp/orbis-data' }, 'orbis'), { workers: ['scan'], dataDirectory: true })).toThrow(/workers\.scan/)
  })

  it('keeps the legacy main resource fields usable during migration', () => {
    expect(() => validateFeatureResources(context({
      preload: '/tmp/main.cjs', rendererFile: '/tmp/main.html', nativeExecutable: '/tmp/helper'
    }), { preloads: ['main'], renderers: ['main'], native: ['executable'] })).not.toThrow()
  })

  it('rejects missing resources and non-file renderer schemes', () => {
    expect(() => validateFeatureResources(context({
      preloads: { main: 'main.cjs' }, renderers: { main: 'javascript:alert(1)' }, native: { addon: '/tmp/addon.node' }
    }), { preloads: ['main'], renderers: ['main'], native: ['addon'] })).toThrow(/preloads\.main/)
    expect(() => validateFeatureResources(context({
      preloads: { main: '/tmp/main.cjs' }, renderers: { main: 'javascript:alert(1)' }, native: { addon: '/tmp/addon.node' }
    }), { preloads: ['main'], renderers: ['main'], native: ['addon'] })).toThrow(/renderers\.main/)
  })
})
