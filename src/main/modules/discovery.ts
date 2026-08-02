import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { hashPayload } from '@moirasia/module-sdk/build'
import { MOIRASIA_HOST_API_VERSION, isHostApiCompatible, validateManifest, type ModuleManifestV1 } from '@moirasia/module-sdk'
import type { ModuleCatalogEntry } from './catalog'

const execFile = promisify(execFileCallback)

export type DiscoveryStatus =
  | { readonly state: 'available'; readonly manifest: ModuleManifestV1; readonly moduleRoot: string; readonly source: 'installed' | 'development' }
  | { readonly state: 'missing' | 'incompatible' | 'corrupt'; readonly reason: string }

export interface DiscoveryDependencies {
  locateApplication(bundleId: string): Promise<string | undefined>
  readBundleIdentifier(appPath: string): Promise<string>
  verifyCodeSeal(appPath: string): Promise<void>
}

export class ModuleDiscovery {
  constructor(
    private readonly cacheRoot: string,
    private readonly dependencies: DiscoveryDependencies = macOSDiscoveryDependencies
  ) {}

  async discoverInstalled(entry: ModuleCatalogEntry): Promise<DiscoveryStatus> {
    const appPath = await this.dependencies.locateApplication(entry.bundleId)
    if (!appPath) return { state: 'missing', reason: `${entry.label}.app is not installed. Installation is not available yet.` }
    try {
      if (await this.dependencies.readBundleIdentifier(appPath) !== entry.bundleId) throw new Error('the enclosing app has the wrong bundle identifier')
      await this.dependencies.verifyCodeSeal(appPath)
      const artifact = join(appPath, 'Contents', 'PlugIns', `${entry.id}.moirasia-module`)
      return await this.validateAndCache(join(artifact, 'Contents', 'Resources'), entry, 'installed')
    } catch (error) {
      return { state: 'corrupt', reason: errorMessage(error) }
    }
  }

  async validateDevelopmentManifest(manifestPath: string, entry: ModuleCatalogEntry): Promise<DiscoveryStatus> {
    try {
      if (basename(manifestPath) !== 'manifest.json') throw new Error('development readiness did not point to manifest.json')
      return await this.validateAndCache(dirname(manifestPath), entry, 'development')
    } catch (error) {
      return { state: 'corrupt', reason: errorMessage(error) }
    }
  }

  private async validateAndCache(moduleRoot: string, entry: ModuleCatalogEntry, source: 'installed' | 'development'): Promise<DiscoveryStatus> {
    const root = await realpath(moduleRoot)
    await assertNoLinks(root, root)
    const manifest = validateManifest(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')))
    if (manifest.id !== entry.id || manifest.application.bundleId !== entry.bundleId) throw new Error('module identity does not match its application')
    if (!isHostApiCompatible(manifest, MOIRASIA_HOST_API_VERSION)) {
      return { state: 'incompatible', reason: `${entry.label} ${manifest.version} requires host API ${manifest.hostApi.min}–${manifest.hostApi.maxExclusive}` }
    }
    for (const payloadPath of Object.values(manifest.entrypoints)) if (payloadPath) await assertContained(root, payloadPath)
    if (await hashPayload(root) !== manifest.payload.sha256) throw new Error('module payload hash does not match manifest')
    const cached = join(this.cacheRoot, entry.id, manifest.version, manifest.payload.sha256)
    await atomicCopy(root, cached)
    return { state: 'available', manifest, moduleRoot: cached, source }
  }
}

export const macOSDiscoveryDependencies: DiscoveryDependencies = {
  async locateApplication(bundleId) {
    const { stdout } = await execFile('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${bundleId}'`])
    return stdout.split('\n').map((value) => value.trim()).find((value) => value.endsWith('.app'))
  },
  async readBundleIdentifier(appPath) {
    const { stdout } = await execFile('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(appPath, 'Contents', 'Info.plist')])
    return stdout.trim()
  },
  async verifyCodeSeal(appPath) {
    await execFile('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  }
}

async function assertContained(root: string, payloadPath: string): Promise<void> {
  if (isAbsolute(payloadPath)) throw new Error('module entrypoint must be relative')
  const resolved = await realpath(resolve(root, payloadPath))
  const within = relative(root, resolved)
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error(`module entrypoint escapes payload: ${payloadPath}`)
  const metadata = await stat(resolved)
  if (!metadata.isFile() && !metadata.isDirectory()) throw new Error(`module entrypoint is not loadable: ${payloadPath}`)
}

async function assertNoLinks(root: string, directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`module payload contains a symbolic link: ${relative(root, path)}`)
    if (entry.isDirectory()) await assertNoLinks(root, path)
  }
}

async function atomicCopy(source: string, destination: string): Promise<void> {
  try { await stat(destination); return } catch {}
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.tmp-${process.pid}-${createHash('sha1').update(source).digest('hex').slice(0, 8)}`
  await rm(temporary, { recursive: true, force: true })
  await cp(source, temporary, { recursive: true, dereference: false, errorOnExist: true })
  try {
    await rename(temporary, destination)
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    try { await stat(destination) } catch { throw error }
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
