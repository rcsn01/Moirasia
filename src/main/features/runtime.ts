import { app } from 'electron'
import { join } from 'node:path'
import { isFeatureId, type EmbeddedFeatureSurface, type FeatureContext, type FeatureId, type MoirasiaFeature } from '@moirasia/desktop-shell/feature'
import type { ApplicationId, FeatureStatus } from '../../shared/contracts'
import type { EmbeddedFeatureHost } from './embedded-host'
import { paths } from '../paths'
import type { ShellSettingsStore } from '../settings'

type FeatureLoader = () => Promise<{ feature: MoirasiaFeature }>

// Keep these imports as string literals. Electron-vite turns each feature into
// a separate chunk, and an uninstalled feature is never evaluated.
const LOADERS: Record<FeatureId, FeatureLoader> = {
  amove: () => import('../../../apps/integrated/Amove/src/main/feature'),
  exithibition: () => import('../../../apps/integrated/Exithibition/src/main/feature'),
  bonded: () => import('../../../apps/integrated/Bonded/src/main/feature'),
  orbis: () => import('../../../apps/integrated/Orbis/src/main/feature')
}

export class FeatureRuntime {
  #instances = new Map<FeatureId, MoirasiaFeature>()
  #loadedThisSession = new Set<FeatureId>()
  #loadErrors = new Map<FeatureId, string>()
  #operations = new Map<FeatureId, Promise<void>>()
  #active: FeatureId | undefined
  readonly #loaders: Partial<Record<FeatureId, FeatureLoader>>
  readonly #context: (id: FeatureId) => FeatureContext
  readonly #host: EmbeddedFeatureHost | undefined

  constructor(
    private readonly settings: ShellSettingsStore,
    options: { loaders?: Partial<Record<FeatureId, FeatureLoader>>; context?: (id: FeatureId) => FeatureContext; host?: EmbeddedFeatureHost } = {}
  ) {
    this.#loaders = options.loaders ?? LOADERS
    this.#host = options.host
    this.#context = options.context ?? (this.#host
      ? (id) => suiteFeatureContext(id, this.#host!.surface(id))
      : () => { throw new Error('FeatureRuntime requires an embedded host or an explicit feature context') })
  }

  statuses(): readonly FeatureStatus[] {
    return (Object.keys(this.#loaders) as FeatureId[]).map((id) => {
      const installed = this.isInstalled(id)
      const loaded = this.#loadedThisSession.has(id)
      const loadError = this.#loadErrors.get(id)
      return { id, installed, loaded, restartPending: loaded && !installed, ...(loadError ? { loadError } : {}) }
    })
  }

  isInstalled(id: FeatureId): boolean { return this.settings.get().features[id] !== false }
  isLoaded(id: FeatureId): boolean { return this.#instances.has(id) }
  get activeFeature(): FeatureId | undefined { return this.#active }

  async syncAtLaunch(): Promise<void> {
    for (const id of Object.keys(this.#loaders) as FeatureId[]) {
      if (this.isInstalled(id)) await this.#enqueue(id, async () => { await this.#load(id) })
    }
  }

  async setInstalled(id: ApplicationId, installed: boolean): Promise<void> {
    const featureId = narrow(id)
    await this.#enqueue(featureId, async () => {
      if (!installed) {
        this.#loadErrors.delete(featureId)
        if (!this.isInstalled(featureId)) return
        // The renderer must leave the feature tab before the feature removes
        // its IPC handlers and native listeners.
        if (this.#active === featureId) this.setActive(undefined)
        await this.settings.update({ features: { [featureId]: false } })
        const instance = this.#instances.get(featureId)
        if (!instance) return
        try { await instance.dispose() }
        catch (error) {
          await this.settings.update({ features: { [featureId]: true } })
          throw error
        }
        this.#instances.delete(featureId)
        return
      }
      const newlyInstalled = !this.isInstalled(featureId)
      if (newlyInstalled) await this.settings.update({ features: { [featureId]: true } })
      const loaded = await this.#load(featureId)
      if (!loaded && newlyInstalled) await this.settings.update({ features: { [featureId]: false } })
      if (loaded && this.#active === featureId) this.#setInstanceActive(featureId, true)
    })
  }

  /** Select a loaded feature tab, or clear selection for Apps/Settings. */
  setActive(id: FeatureId | undefined): void {
    if (id !== undefined && (!this.#instances.has(id) || !this.isInstalled(id))) id = undefined
    this.#active = id
    this.#host?.setActive(id)
    for (const featureId of this.#instances.keys()) this.#setInstanceActive(featureId, featureId === id)
  }

  activate(id: ApplicationId): void {
    const featureId = narrow(id)
    const instance = this.#instances.get(featureId)
    if (!instance?.activate && !this.#host) throw new Error('Feature is not running inside Moirasia. Relaunch or reinstall it.')
    if (!instance) throw new Error('Feature is not loaded. Relaunch or reinstall it.')
    this.setActive(featureId)
    if (instance.activate) instance.activate()
    else this.#host?.activate(featureId)
  }

  relaunch(): void { app.relaunch(); app.exit(0) }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.#operations.values()].map((operation) => operation.catch(() => undefined)))
    this.setActive(undefined)
    const instances = [...this.#instances.values()]
    this.#instances.clear()
    await Promise.all(instances.map(async (instance) => {
      try { await instance.dispose() }
      catch (error) { console.error(`Feature '${instance.id}' failed to dispose`, error) }
    }))
  }

  #setInstanceActive(id: FeatureId, active: boolean): void {
    try { this.#instances.get(id)?.setActive?.(active) }
    catch (error) { console.error(`Feature '${id}' failed to update active state`, error) }
  }

  #enqueue(id: FeatureId, operation: () => Promise<void> | void): Promise<void> {
    const previous = this.#operations.get(id) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.#operations.set(id, next)
    return next.finally(() => { if (this.#operations.get(id) === next) this.#operations.delete(id) })
  }

  async #load(id: FeatureId): Promise<boolean> {
    if (this.#instances.has(id)) return true
    const loader = this.#loaders[id]
    if (!loader) return false
    let loaded: { feature: MoirasiaFeature }
    try {
      loaded = await loader()
    } catch (error) {
      this.#loadErrors.set(id, errorMessage(error))
      console.error(`Feature '${id}' failed to load`, error)
      return false
    }
    try {
      await loaded.feature.register(this.#context(id))
    } catch (error) {
      this.#loadErrors.set(id, errorMessage(error))
      console.error(`Feature '${id}' failed to register`, error)
      try { await loaded.feature.dispose() } catch { /* Best-effort rollback. */ }
      return false
    }
    this.#loadErrors.delete(id)
    this.#loadedThisSession.add(id)
    this.#instances.set(id, loaded.feature)
    return true
  }
}

function narrow(id: ApplicationId): FeatureId {
  if (!isFeatureId(id)) throw new TypeError(`'${id}' is not a Moirasia feature`)
  return id
}

export function suiteFeatureContext(id: FeatureId, surface: EmbeddedFeatureSurface): FeatureContext {
  const dataDirectory = join(app.getPath('userData'), 'features', id)
  switch (id) {
    case 'amove': {
      const root = app.isPackaged ? join(process.resourcesPath, 'features', 'amove') : join(app.getAppPath(), 'apps', 'integrated', 'Amove')
      const rendererUrl = process.env.ELECTRON_RENDERER_URL
      return {
        id, mode: 'suite', productId: id, surface,
        paths: {
          preloads: { shelf: paths.preload('feature-amove-shelf') },
          renderers: { shelf: rendererUrl ? `${rendererUrl}/apps/integrated/Amove/src/renderer/shelf.html` : paths.renderer('feature-amove-shelf') },
          native: { addon: app.isPackaged ? join(root, 'native', nativeAddonName()) : join(app.getAppPath(), 'apps', 'integrated', 'Amove', 'native', nativeAddonName()) },
          assetsDirectory: app.isPackaged ? join(root, 'assets') : join(app.getAppPath(), 'apps', 'integrated', 'Amove', 'assets'),
          dataDirectory,
          legacyDataDirectories: [join(app.getPath('appData'), 'Amove')]
        }
      }
    }
    case 'exithibition':
      return {
        id, mode: 'suite', productId: id, surface,
        paths: {
          native: { executable: app.isPackaged ? join(process.resourcesPath, 'native', 'ExithibitionNative') : join(app.getAppPath(), 'apps', 'integrated', 'Exithibition', '.build', 'arm64-apple-macosx', 'debug', 'ExithibitionNative') },
          dataDirectory
        }
      }
    case 'bonded':
      return {
        id, mode: 'suite', productId: id, surface,
        paths: {
          native: { helper: app.isPackaged
            ? join(process.resourcesPath, 'features', 'bonded', 'native', 'BondedFirewallHelper')
            : join(app.getAppPath(), 'apps', 'integrated', 'Bonded', 'native', '.build', 'arm64-apple-macosx', 'debug', 'BondedFirewallHelper') },
          dataDirectory,
          legacyDataDirectories: [join(app.getPath('appData'), 'Bonded')]
        }
      }
    case 'orbis':
      return {
        id, mode: 'suite', productId: id, surface,
        paths: {
          workers: { scan: app.isPackaged
            ? join(process.resourcesPath, 'features', 'orbis', 'worker', 'scan-worker.mjs')
            : join(app.getAppPath(), 'native', 'staged', 'features', 'orbis', 'worker', 'scan-worker.mjs') },
          native: { metadata: app.isPackaged
            ? join(process.resourcesPath, 'features', 'orbis', 'native', nativeAddonName('orbis'))
            : join(app.getAppPath(), 'native', 'staged', 'features', 'orbis', 'native', nativeAddonName('orbis')) },
          dataDirectory
        }
      }
    default:
      return assertNever(id)
  }
}

function assertNever(value: never): never { throw new Error(`Unknown feature '${String(value)}'`) }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function nativeAddonName(feature: 'amove' | 'orbis' = 'amove'): string {
  if (feature === 'orbis') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    if (process.platform === 'darwin') return `orbis-metadata.darwin-${arch}.node`
    if (process.platform === 'win32') return 'orbis-metadata.win32-x64-msvc.node'
    return 'orbis-metadata.linux-x64-gnu.node'
  }
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'darwin') return `amove-native.darwin-${arch}.node`
  if (process.platform === 'win32') return 'amove-native.win32-x64-msvc.node'
  return 'amove-native.linux-x64-gnu.node'
}

export type { FeatureLoader }
