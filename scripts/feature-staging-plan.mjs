import { readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

const FEATURE_IDS = new Set(['amove', 'bonded', 'shout'])
const ARTIFACT_KINDS = new Set(['native', 'executable', 'worker', 'assets', 'bundle'])
const SUITE_DEV_SOURCES = new Set(['buildOutput', 'staged'])
const CONFIGURATIONS = new Set(['debug', 'release'])

export function loadFeatureArtifactData() {
  const path = new URL('../packages/desktop-shell/src/feature-artifact-data.json', import.meta.url)
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function buildFeatureStagingPlan(options, artifactData) {
  validateOptions(options)
  validateFeatureData(artifactData, options.productRoots)

  const records = []
  for (const featureId of Object.keys(artifactData)) {
    const productRoot = options.productRoots[featureId]
    const artifacts = artifactData[featureId]
    const names = new Set()
    const featureRoot = resolve(options.repoRoot, 'native/staged/features', featureId)

    for (const [index, artifact] of artifacts.entries()) {
      validateArtifact(featureId, artifact, index)
      if (names.has(artifact.name)) fail(featureId, artifact.name, 'duplicate artifact name')
      names.add(artifact.name)

      const buildOutput = expandBuildOutput(featureId, artifact, options.configuration)
      const stagedRoot = resolve(options.repoRoot, artifact.staged)
      if (!isWithin(featureRoot, stagedRoot)) fail(featureId, artifact.name, `destination '${stagedRoot}' is outside '${featureRoot}'`)

      const sourceRoot = resolve(productRoot, buildOutput)
      if (artifact.kind === 'assets' || artifact.kind === 'bundle') {
        const expectedPath = artifact.kind === 'bundle' ? join(sourceRoot, artifact.file) : sourceRoot
        records.push({
          featureId,
          artifactName: artifact.name,
          kind: artifact.kind,
          mode: 'directory',
          sourcePath: sourceRoot,
          destinationPath: stagedRoot,
          expectedPath
        })
      } else {
        const sourcePath = join(sourceRoot, artifactFileName(artifact, options.platform, options.arch))
        const destinationPath = join(stagedRoot, artifactFileName(artifact, options.platform, options.arch))
        if (!isWithin(featureRoot, destinationPath)) fail(featureId, artifact.name, `destination '${destinationPath}' is outside '${featureRoot}'`)
        records.push({
          featureId,
          artifactName: artifact.name,
          kind: artifact.kind,
          mode: 'file',
          sourcePath,
          destinationPath,
          expectedPath: sourcePath
        })
      }
    }
  }
  return records
}

function validateOptions(options) {
  if (!isRecord(options)) throw new Error('Feature staging options must be an object.')
  if (!isAbsoluteString(options.repoRoot)) throw new Error('Feature staging options require an absolute repoRoot.')
  if (!isRecord(options.productRoots)) throw new Error('Feature staging options require productRoots.')
  if (typeof options.platform !== 'string' || !options.platform.trim()) throw new Error('Feature staging options require a platform.')
  if (typeof options.arch !== 'string' || !options.arch.trim()) throw new Error('Feature staging options require an architecture.')
  if (!CONFIGURATIONS.has(options.configuration)) throw new Error(`Unsupported staging configuration '${String(options.configuration)}'.`)

  const expected = [...FEATURE_IDS].sort()
  const actual = Object.keys(options.productRoots).sort()
  if (actual.join('\0') !== expected.join('\0')) throw new Error('Feature staging options must provide exactly the current product roots.')
  for (const featureId of expected) {
    if (!isAbsoluteString(options.productRoots[featureId])) throw new Error(`Feature '${featureId}' requires an absolute product root.`)
  }
}

function validateFeatureData(data, productRoots) {
  if (!isRecord(data)) throw new Error('Feature artifact data must be an object keyed by feature id.')
  const ids = Object.keys(data).sort()
  const expected = [...FEATURE_IDS].sort()
  if (ids.join('\0') !== expected.join('\0')) throw new Error('Feature artifact data must contain exactly the current feature ids.')
  for (const featureId of expected) {
    if (!Array.isArray(data[featureId])) fail(featureId, '<data>', 'artifact data must be an array')
    if (!productRoots[featureId]) fail(featureId, '<data>', 'product root is missing')
  }
}

function validateArtifact(featureId, artifact, index) {
  if (!isRecord(artifact)) fail(featureId, `index ${index}`, 'artifact must be an object')
  const label = typeof artifact.name === 'string' && artifact.name.trim() ? artifact.name : `index ${index}`
  if (typeof artifact.name !== 'string' || !isFilename(artifact.name)) fail(featureId, label, 'artifact name is invalid')
  if (typeof artifact.kind !== 'string' || !ARTIFACT_KINDS.has(artifact.kind)) fail(featureId, label, `unsupported kind '${String(artifact.kind)}'`)
  for (const field of ['buildOutput', 'staged', 'suiteResource', 'standaloneResource']) {
    if (typeof artifact[field] !== 'string' || !isRelativePath(artifact[field])) fail(featureId, label, `invalid ${field} path`)
  }
  if (typeof artifact.suiteDevSource !== 'string' || !SUITE_DEV_SOURCES.has(artifact.suiteDevSource)) fail(featureId, label, `invalid suiteDevSource '${String(artifact.suiteDevSource)}'`)
  if (artifact.kind === 'assets') {
    if (artifact.file !== undefined) fail(featureId, label, 'assets artifact must not carry a filename')
  } else if (typeof artifact.file !== 'string' || !isFilename(artifact.file)) {
    fail(featureId, label, 'artifact filename is missing or invalid')
  } else if (artifact.kind === 'native' && artifact.file.endsWith('.node')) {
    fail(featureId, label, 'native artifact must use a napi base name')
  }
}

function expandBuildOutput(featureId, artifact, configuration) {
  const value = artifact.buildOutput
    .replaceAll('{configuration}', configuration)
    .replaceAll('{Configuration}', configuration[0].toUpperCase() + configuration.slice(1))
  if (/[{}]/.test(value)) fail(featureId, artifact.name, `buildOutput contains an unresolved placeholder '${value}'`)
  return value
}

function artifactFileName(artifact, platform, arch) {
  if (artifact.kind !== 'native') return artifact.file
  const suffix = arch === 'arm64' ? 'arm64' : 'x64'
  if (platform === 'darwin') return `${artifact.file}.darwin-${suffix}.node`
  if (platform === 'win32') return `${artifact.file}.win32-x64-msvc.node`
  return `${artifact.file}.linux-x64-gnu.node`
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbsoluteString(value) {
  return typeof value === 'string' && isAbsolute(value)
}

function isRelativePath(value) {
  if (!value.trim() || isAbsolute(value)) return false
  return !value.split(/[\\/]+/).includes('..')
}

function isFilename(value) {
  return Boolean(value.trim()) && value !== '.' && value !== '..' && !/[\\/]/.test(value)
}

function isWithin(root, candidate) {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

function fail(featureId, artifactName, message) {
  throw new Error(`Feature staging plan '${featureId}/${artifactName}': ${message}.`)
}
