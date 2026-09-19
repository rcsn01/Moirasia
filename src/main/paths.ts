import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveFeatureArtifact } from '@moirasia/desktop-shell/feature-resources'

const mainDirectory = dirname(fileURLToPath(import.meta.url))

/** Unix-socket endpoint for the native host control server. A userData path
 * plus `runtime/host.sock` can exceed the ~104-byte `sockaddr_un.sun_path`
 * limit on macOS, which made the host fail to publish its endpoint at all.
 * The endpoint therefore lives in the per-user temp directory keyed by a
 * SHA-256 hash of the userData path, mirrored exactly by
 * `moirasiaHostSocketPath` in MoirasiaProtocol (Protocol.swift). */
export function moirasiaHostSocketPath(userData: string, base = tmpdir()): string {
  const hash = createHash('sha256').update(userData, 'utf8').digest('hex').slice(0, 16)
  return join(base.replace(/\/+$/, ''), `moirasia-host-${hash}.sock`)
}

export function applicationAgentPath(resourcesPath = process.resourcesPath): string {
  const packaged = join(resourcesPath, 'application-agent')
  return existsSync(packaged) ? packaged : join(mainDirectory, '../../native/staged/application-agent')
}

export function moirasiaHostPath(resourcesPath = process.resourcesPath): string {
  // Packaged builds place the host in Contents/Library/LoginItems so it can
  // run as a login item service; development keeps it under native/staged.
  const packagedLoginItem = join(resourcesPath, '..', 'Library', 'LoginItems', 'MoirasiaHost.app', 'Contents', 'MacOS', 'MoirasiaHost')
  const packagedBundle = join(resourcesPath, 'runtime', 'MoirasiaHost.app', 'Contents', 'MacOS', 'MoirasiaHost')
  const packaged = join(resourcesPath, 'runtime', 'MoirasiaHost')
  const developmentBundle = join(mainDirectory, '../../native/staged/runtime/MoirasiaHost.app', 'Contents', 'MacOS', 'MoirasiaHost')
  const development = join(mainDirectory, '../../native/staged/runtime/MoirasiaHost')
  return existsSync(packagedLoginItem) ? packagedLoginItem : existsSync(packagedBundle) ? packagedBundle : existsSync(packaged) ? packaged : existsSync(developmentBundle) ? developmentBundle : development
}

export function moirasiaFeatureServicePath(resourcesPath = process.resourcesPath): string {
  const packagedBundle = join(resourcesPath, 'runtime', 'MoirasiaFeatureService.app', 'Contents', 'MacOS', 'MoirasiaFeatureService')
  const packaged = join(resourcesPath, 'runtime', 'MoirasiaFeatureService')
  const developmentBundle = join(mainDirectory, '../../native/staged/runtime/MoirasiaFeatureService.app', 'Contents', 'MacOS', 'MoirasiaFeatureService')
  const development = join(mainDirectory, '../../native/staged/runtime/MoirasiaFeatureService')
  return existsSync(packagedBundle) ? packagedBundle : existsSync(packaged) ? packaged : existsSync(developmentBundle) ? developmentBundle : development
}

export function moirasiaNativeFeaturePaths(
  resourcesPath = process.resourcesPath,
  suiteRoot = join(mainDirectory, '../..')
): { bondedHelperPath: string; shoutDriverPath: string } {
  const packagedBonded = resolveFeatureArtifact('bonded', 'helper', { kind: 'suite-packaged', resourcesRoot: resourcesPath })
  const stagedBonded = resolveFeatureArtifact('bonded', 'helper', { kind: 'suite-staged', suiteRoot })
  const packagedShout = dirname(resolveFeatureArtifact('shout', 'driver', { kind: 'suite-packaged', resourcesRoot: resourcesPath }))
  const stagedShout = dirname(resolveFeatureArtifact('shout', 'driver', { kind: 'suite-staged', suiteRoot }))

  return {
    bondedHelperPath: existsSync(packagedBonded) ? packagedBonded : stagedBonded,
    shoutDriverPath: existsSync(packagedShout) ? packagedShout : stagedShout
  }
}

const preloadPages = {
  shell: '../preload/shell.cjs',
  'feature-amove-shelf': '../preload/feature-amove-shelf.cjs'
} as const

// Renderer pages mirror the renderer root of the suite build (the repository
// root), so app-owned entries keep their repository-relative paths.
const rendererPages = {
  shell: '../renderer/src/renderer/shell.html',
  'feature-amove-shelf': '../renderer/apps/integrated/Amove/src/renderer/shelf.html'
} as const

export const paths = {
  preload(page: keyof typeof preloadPages): string {
    return join(mainDirectory, preloadPages[page])
  },
  renderer(page: keyof typeof rendererPages): string {
    return join(mainDirectory, rendererPages[page])
  }
}
