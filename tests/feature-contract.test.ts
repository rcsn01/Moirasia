import { describe, expect, it } from 'vitest'
import { validateFeatureResources, type FeatureContext } from '../packages/desktop-shell/src/feature'

const context = (paths: FeatureContext['paths'], id: FeatureContext['id'] = 'amove', mode: FeatureContext['mode'] = 'suite'): FeatureContext => (mode === 'suite' ? {
  id, mode, productId: id, paths,
  surface: { renderer: { current: () => undefined, send: () => false, subscribe: () => () => undefined }, state: { active: false, focused: false }, activate: () => undefined, focus: () => undefined, subscribe: () => () => undefined }
} : {
  id, mode, productId: id, paths
})


describe('feature resource contract', () => {
  it('validates named suite resources and development renderer URLs', () => {
    expect(() => validateFeatureResources(context({
      preloads: { main: '/tmp/main.cjs', shelf: '/tmp/shelf.cjs' },
      renderers: { main: 'http://localhost:5173/feature-amove-main.html', shelf: 'http://localhost:5173/feature-amove-shelf.html' },
      native: { addon: '/tmp/amove.node' },
      assetsDirectory: '/tmp/assets',
      dataDirectory: '/tmp/data'
    }), { preloads: ['main', 'shelf'], renderers: ['main', 'shelf'], native: ['addon'], assetsDirectory: true, dataDirectory: true })).not.toThrow()
  })

  it('validates worker resources without requiring a native resource', () => {
    expect(() => validateFeatureResources(context({ workers: { scan: '/tmp/scan-worker.mjs' }, dataDirectory: '/tmp/amove-data' }, 'amove'), { workers: ['scan'], dataDirectory: true })).not.toThrow()
    expect(() => validateFeatureResources(context({ dataDirectory: '/tmp/amove-data' }, 'amove'), { workers: ['scan'], dataDirectory: true })).toThrow(/workers\.scan/)
  })

  it.each([
    { alias: 'preload', value: '/tmp/main.cjs', requirements: { preloads: ['main'] }, expected: /preloads\.main/ },
    { alias: 'rendererUrl', value: 'http://localhost:5173/index.html', requirements: { renderers: ['main'] }, expected: /renderers\.main/ },
    { alias: 'rendererFile', value: '/tmp/main.html', requirements: { renderers: ['main'] }, expected: /renderers\.main/ },
    { alias: 'nativeExecutable', value: '/tmp/helper', requirements: { native: ['executable'] }, expected: /native\.executable/ }
  ] as const)('rejects the removed $alias runtime alias', ({ alias, value, requirements, expected }) => {
    // This cast models untyped runtime JavaScript, not supported TypeScript input.
    const paths = { [alias]: value } as unknown as FeatureContext['paths']
    expect(() => validateFeatureResources(context(paths), requirements)).toThrow(expected)
  })

  it('uses the catalog requirements for every Shout standalone native resource', () => {
    expect(() => validateFeatureResources(context({
      preloads: { main: '/tmp/shout-preload.cjs' },
      renderers: { main: '/tmp/shout.html' },
      native: { helper: '/tmp/ShoutAudioHelper', driver: '/tmp/ShoutMic.driver' },
      dataDirectory: '/tmp/shout-data'
    }, 'shout', 'standalone'))).not.toThrow()
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
