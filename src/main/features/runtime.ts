import { app } from 'electron'
import { join } from 'node:path'
import { isFeatureId, type FeatureContext, type FeatureId, type MoirasiaFeature } from '@moirasia/desktop-shell/feature'
import type { ApplicationId, FeatureStatus } from '../../shared/contracts'
import { paths } from '../paths'
import type { ShellSettingsStore } from '../settings'

type FeatureLoader = () => Promise<{ feature: MoirasiaFeature }>

// String-literal dynamic imports: rollup code-splits each feature into its own
// chunk. An uninstalled feature's chunk is never evaluated.
const LOADERS: Record<FeatureId, FeatureLoader> = {
  exithibition: () => import('@moirasia/feature-exithibition/main')
}

export class FeatureRuntime {
  #instances = new Map<FeatureId, MoirasiaFeature>()
  #loadedThisSession = new Set<FeatureId>()
  #operations = new Map<FeatureId, Promise<void>>()
  readonly #loaders: Record<FeatureId, FeatureLoader>
  readonly #context: (id: FeatureId) => FeatureContext

  constructor(
    private readonly settings: ShellSettingsStore,
    options: { loaders?: Record<FeatureId, FeatureLoader>; context?: (id: FeatureId) => FeatureContext } = {}
  ) {
    this.#loaders = options.loaders ?? LOADERS
    this.#context = options.context ?? suiteFeatureContext
  }

  statuses(): readonly FeatureStatus[] {
    return (Object.keys(this.#loaders) as FeatureId[]).map((id) => {
      const installed = this.isInstalled(id)
      const loaded = this.#loadedThisSession.has(id)
      return { id, installed, loaded, restartPending: loaded && !installed }
    })
  }

  isInstalled(id: FeatureId): boolean { return this.settings.get().features[id] !== false }

  /** Load and register every installed feature. Uninstalled features are never imported. */
  async syncAtLaunch(): Promise<void> {
    for (const id of Object.keys(this.#loaders) as FeatureId[]) {
      if (this.isInstalled(id)) await this.#enqueue(id, () => this.#load(id))
    }
  }

  async setInstalled(id: ApplicationId, installed: boolean): Promise<void> {
    const featureId = narrow(id)
    await this.#enqueue(featureId, async () => {
      if (!installed) {
        if (!this.isInstalled(featureId)) return
        await this.settings.update({ features: { [featureId]: false } })
        const instance = this.#instances.get(featureId)
        if (!instance) return
        this.#instances.delete(featureId)
        await instance.dispose()
        return
      }
      if (!this.isInstalled(featureId)) await this.settings.update({ features: { [featureId]: true } })
      await this.#load(featureId)
    })
  }

  activate(id: ApplicationId): void {
    const instance = this.#instances.get(narrow(id))
    if (!instance?.activate) throw new Error('Feature is not running inside Moirasia. Relaunch or reinstall it.')
    instance.activate()
  }

  relaunch(): void { app.relaunch(); app.exit(0) }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.#operations.values()].map((operation) => operation.catch(() => undefined)))
    const instances = [...this.#instances.values()]
    this.#instances.clear()
    for (const instance of instances) await instance.dispose()
  }

  #enqueue(id: FeatureId, operation: () => Promise<void> | void): Promise<void> {
    const previous = this.#operations.get(id) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.#operations.set(id, next)
    return next.finally(() => { if (this.#operations.get(id) === next) this.#operations.delete(id) })
  }

  async #load(id: FeatureId): Promise<void> {
    if (this.#instances.has(id)) return
    let loaded: { feature: MoirasiaFeature }
    try {
      loaded = await this.#loaders[id]()
    } catch (error) {
      console.error(`Feature '${id}' failed to load`, error)
      return
    }
    try {
      await loaded.feature.register(this.#context(id))
    } catch (error) {
      console.error(`Feature '${id}' failed to register`, error)
      try { await loaded.feature.dispose() } catch { /* best-effort cleanup */ }
      return
    }
    this.#loadedThisSession.add(id)
    this.#instances.set(id, loaded.feature)
  }
}

function narrow(id: ApplicationId): FeatureId {
  if (!isFeatureId(id)) throw new TypeError(`'${id}' is not a Moirasia feature`)
  return id
}

function suiteFeatureContext(id: FeatureId): FeatureContext {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  // Today every feature follows the feature-<id> naming scheme for built assets.
  return {
    id,
    mode: 'suite',
    productId: id,
    paths: {
      preload: paths.preload(`feature-${id}`),
      ...(rendererUrl ? { rendererUrl: `${rendererUrl}/feature-${id}.html` } : {}),
      rendererFile: paths.renderer(`feature-${id}`),
      nativeExecutable: app.isPackaged
        ? join(process.resourcesPath, 'native', 'ExithibitionNative')
        : join(app.getAppPath(), 'apps', 'Exithibition', '.build', 'arm64-apple-macosx', 'debug', 'ExithibitionNative')
    }
  }
}
