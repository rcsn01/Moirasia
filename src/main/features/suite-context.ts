import { app } from 'electron'
import { join } from 'node:path'
import { type EmbeddedFeatureSurface, type FeatureContext, type FeatureId } from '@moirasia/desktop-shell/feature'
import { resolveFeatureResources } from '@moirasia/desktop-shell/feature-resources'
import { paths } from '../paths'

/**
 * The suite-side join between the feature catalog's artifact facts and the
 * suite host's roots. The catalog owns every filename, staged path, packaged
 * destination, and dev build layout; this module only picks the root for the
 * current host mode (packaged resources, the app repo's build output, or the
 * staged copy). The literal `import()` loaders that keep rollup code-splitting
 * the backends — and uninstalled features never evaluated — stay in runtime.ts.
 */
export function suiteFeatureContext(id: FeatureId, surface: EmbeddedFeatureSurface): FeatureContext {
  const resources = app.isPackaged
    ? resolveFeatureResources(id, { kind: 'suite-packaged', resourcesRoot: process.resourcesPath })
    : resolveFeatureResources(id, { kind: 'suite-development', suiteRoot: app.getAppPath() })
  const dataDirectory = join(app.getPath('userData'), 'features', id)

  switch (id) {
    case 'amove': {
      const rendererUrl = process.env.ELECTRON_RENDERER_URL
      return {
        id, mode: 'suite', productId: id, surface,
        paths: {
          preloads: { shelf: paths.preload('feature-amove-shelf') },
          renderers: { shelf: rendererUrl ? `${rendererUrl}/apps/integrated/Amove/src/renderer/shelf.html` : paths.renderer('feature-amove-shelf') },
          native: resources.native,
          assetsDirectory: resources.assetsDirectory!,
          dataDirectory,
          legacyDataDirectories: [join(app.getPath('appData'), 'Amove')]
        }
      }
    }
    case 'bonded':
      return {
        id, mode: 'suite', productId: id, surface,
        paths: {
          native: resources.native,
          dataDirectory,
          legacyDataDirectories: [join(app.getPath('appData'), 'Bonded')]
        }
      }
    case 'shout':
      return {
        id, mode: 'suite', productId: id, surface,
        paths: {
          native: resources.native,
          dataDirectory,
          legacyDataDirectories: [join(app.getPath('appData'), 'Shout')]
        }
      }
    default:
      return assertNever(id)
  }
}

function assertNever(value: never): never { throw new Error(`Unknown feature '${String(value)}'`) }