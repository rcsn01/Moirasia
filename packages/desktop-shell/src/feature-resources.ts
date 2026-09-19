import { isAbsolute, join } from 'node:path'
import { artifactPath, featureCatalog, type FeatureArtifact, type FeatureCatalogEntry, type FeatureId } from './feature-catalog'

export type FeatureResourceSource =
  | { readonly kind: 'suite-development'; readonly suiteRoot: string }
  | { readonly kind: 'suite-staged'; readonly suiteRoot: string }
  | { readonly kind: 'suite-packaged'; readonly resourcesRoot: string }
  | { readonly kind: 'standalone-development'; readonly productRoot: string }
  | { readonly kind: 'standalone-packaged'; readonly appRoot: string; readonly resourcesRoot: string }

export interface ResolvedFeatureResources {
  readonly native: Readonly<Record<string, string>>
  readonly workers: Readonly<Record<string, string>>
  readonly assetsDirectory?: string
}

export function resolveFeatureResources(id: FeatureId, source: FeatureResourceSource): ResolvedFeatureResources {
  const entry = getFeature(id)
  validateSource(id, source)

  const native: Record<string, string> = {}
  const workers: Record<string, string> = {}
  let assetsDirectory: string | undefined

  for (const artifact of entry.artifacts) {
    const resolved = resolveArtifactPath(entry, artifact, source)
    if (artifact.kind === 'assets') assetsDirectory = resolved
    else if (artifact.kind === 'worker') workers[artifact.name] = resolved
    else native[artifact.name] = resolved
  }

  return assetsDirectory === undefined
    ? { native, workers }
    : { native, workers, assetsDirectory }
}

export function resolveFeatureArtifact(id: FeatureId, artifactName: string, source: FeatureResourceSource): string {
  const entry = getFeature(id)
  const artifact = entry.artifacts.find((candidate) => candidate.name === artifactName)
  if (!artifact) throw new Error(`Feature '${String(id)}' has no artifact named '${String(artifactName)}'.`)
  validateSource(id, source, artifactName)
  return resolveArtifactPath(entry, artifact, source)
}

function getFeature(id: FeatureId): FeatureCatalogEntry {
  try {
    return featureCatalog.get(id)
  } catch {
    throw new Error(`Unknown feature '${String(id)}'.`)
  }
}

function sourceKind(source: unknown): string {
  if (typeof source === 'object' && source !== null && 'kind' in source) {
    return String((source as { kind?: unknown }).kind)
  }
  return String(source)
}

function validateSource(id: FeatureId, source: FeatureResourceSource, artifactName?: string): void {
  const kind = sourceKind(source)
  const subject = artifactName === undefined ? `Feature '${String(id)}'` : `Feature '${String(id)}' artifact '${artifactName}'`
  if (typeof source !== 'object' || source === null) {
    throw new Error(`${subject} has an invalid resource source kind '${kind}'.`)
  }

  switch (source.kind) {
    case 'suite-development':
    case 'suite-staged':
      requireRoot(subject, source.kind, source.suiteRoot, 'suiteRoot')
      return
    case 'suite-packaged':
      requireRoot(subject, source.kind, source.resourcesRoot, 'resourcesRoot')
      return
    case 'standalone-development':
      requireRoot(subject, source.kind, source.productRoot, 'productRoot')
      return
    case 'standalone-packaged':
      requireRoot(subject, source.kind, source.appRoot, 'appRoot')
      requireRoot(subject, source.kind, source.resourcesRoot, 'resourcesRoot')
      return
    default:
      throw new Error(`${subject} has an invalid resource source kind '${kind}'.`)
  }
}

function requireRoot(subject: string, kind: string, value: unknown, role: string): asserts value is string {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error(`${subject} source '${kind}' requires an absolute ${role}.`)
  }
}

function resolveArtifactPath(entry: FeatureCatalogEntry, artifact: FeatureArtifact, source: FeatureResourceSource): string {
  const { root, relative } = sourceLocation(entry, artifact, source)
  return artifactPath(join(root, relative), artifact)
}

function sourceLocation(entry: FeatureCatalogEntry, artifact: FeatureArtifact, source: FeatureResourceSource): { root: string; relative: string } {
  switch (source.kind) {
    case 'suite-development':
      return artifact.suiteDevSource === 'buildOutput'
        ? { root: join(source.suiteRoot, 'apps', 'integrated', entry.directory), relative: expandDevelopment(artifact.buildOutput) }
        : { root: source.suiteRoot, relative: artifact.staged }
    case 'suite-staged':
      return { root: source.suiteRoot, relative: artifact.staged }
    case 'suite-packaged':
      return { root: source.resourcesRoot, relative: artifact.suiteResource }
    case 'standalone-development':
      return { root: source.productRoot, relative: expandDevelopment(artifact.buildOutput) }
    case 'standalone-packaged':
      return artifact.kind === 'assets'
        ? { root: source.appRoot, relative: artifact.standaloneResource }
        : { root: source.resourcesRoot, relative: artifact.standaloneResource }
    default:
      return assertNever(source)
  }
}

function expandDevelopment(value: string): string {
  return value.replaceAll('{configuration}', 'debug').replaceAll('{Configuration}', 'Debug')
}

function assertNever(value: never): never {
  throw new Error(`Unknown feature resource source '${String(value)}'.`)
}
