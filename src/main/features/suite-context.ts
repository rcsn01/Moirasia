import { app } from 'electron'
import { join } from 'node:path'
import {
  artifactPath,
  featureCatalog,
  type EmbeddedFeatureSurface,
  type FeatureArtifact,
  type FeatureCatalogEntry,
  type FeatureContext,
  type FeatureId
} from '@moirasia/desktop-shell/feature'
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
  const entry = featureCatalog.get(id)
  const appRoot = join(app.getAppPath(), 'apps', 'integrated', entry.directory)
  const dataDirectory = join(app.getPath('userData'), 'features', id)
  // Packaged mode reads the suite bundle; development reads the app repo's own
  // build output or the staged copy, exactly as the catalog's suiteDevSource says.
  const resource = (artifact: FeatureArtifact): string => {
    if (app.isPackaged) return artifactPath(join(process.resourcesPath, artifact.suiteResource), artifact)
    return artifact.suiteDevSource === 'buildOutput'
      ? artifactPath(join(appRoot, artifact.buildOutput.replace('{configuration}', 'debug')), artifact)
      : artifactPath(join(app.getAppPath(), artifact.staged), artifact)
  }

  switch (id) {
    case 'amove': {
      const rendererUrl = process.env.ELECTRON_RENDERER_URL
      return {
        id, mode: 'suite', productId: id, surface,
        paths: {
          preloads: { shelf: paths.preload('feature-amove-shelf') },
          renderers: { shelf: rendererUrl ? `${rendererUrl}/apps/integrated/Amove/src/renderer/shelf.html` : paths.renderer('feature-amove-shelf') },
          native: { addon: resource(artifact(entry, 'addon')) },
          assetsDirectory: resource(artifact(entry, 'assets')),
          dataDirectory,
          legacyDataDirectories: [join(app.getPath('appData'), 'Amove')]
        }
      }
    }
    case 'bonded':
      return {
        id, mode: 'suite', productId: id, surface,
        paths: {
          native: { helper: resource(artifact(entry, 'helper')) },
          dataDirectory,
          legacyDataDirectories: [join(app.getPath('appData'), 'Bonded')]
        }
      }
    default:
      return assertNever(id)
  }
}

function artifact(entry: FeatureCatalogEntry, name: string): FeatureArtifact {
  const found = entry.artifacts.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`Feature '${entry.id}' has no artifact named '${name}'.`)
  return found
}

function assertNever(value: never): never { throw new Error(`Unknown feature '${String(value)}'`) }