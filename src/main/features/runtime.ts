import { app } from 'electron'
import { isFeatureId, type FeatureContext, type FeatureId, type MoirasiaFeature } from '@moirasia/desktop-shell/feature'
import type { ApplicationId, FeatureStatus } from '../../shared/contracts'
import type { EmbeddedFeatureHost } from './embedded-host'
import type { ShellSettingsStore } from '../settings'
import type { NativeHostClientLike } from '../../shared/native-host-contracts'
import { suiteFeatureContext } from './suite-context'
import { errorMessage, LOADERS, LocalFeatureMode, NATIVE_LOADERS, NativeFeatureMode, type FeatureLoader, type FeatureMode, type FeatureModeLinks, type NativeFeatureLoader } from './host-mode'

export { suiteFeatureContext }

export class FeatureRuntime {
  #instances = new Map<FeatureId, MoirasiaFeature>()
  #loadedThisSession = new Set<FeatureId>()
  #loadErrors = new Map<FeatureId, string>()
  #operations = new Map<FeatureId, Promise<void>>()
  #active: FeatureId | undefined
  #shellVisible = false
  readonly #statusListeners = new Set<() => void>()
  readonly #featureIds: readonly FeatureId[]
  readonly #context: (id: FeatureId) => FeatureContext
  readonly #host: EmbeddedFeatureHost | undefined
  readonly #mode: FeatureMode

  constructor(
    private readonly settings: ShellSettingsStore,
    options: { loaders?: Partial<Record<FeatureId, FeatureLoader>>; nativeLoaders?: Partial<Record<FeatureId, NativeFeatureLoader>>; context?: (id: FeatureId) => FeatureContext; host?: EmbeddedFeatureHost; nativeClient?: NativeHostClientLike } = {}
  ) {
    this.#featureIds = Object.keys(options.loaders ?? LOADERS) as FeatureId[]
    this.#host = options.host
    this.#context = options.context ?? (this.#host
      ? (id) => suiteFeatureContext(id, this.#host!.surface(id))
      : () => { throw new Error('FeatureRuntime requires an embedded host or an explicit feature context') })
    const links: FeatureModeLinks = {
      enqueue: (id, operation) => this.#enqueue(id, operation),
      acquire: (id) => this.#acquire(id),
      instance: (id) => this.#instances.get(id),
      removeInstance: (id) => { this.#instances.delete(id) },
      setInstanceActive: (id, active) => this.#setInstanceActive(id, active),
      loadError: (id) => this.#loadErrors.get(id),
      forgetLoadError: (id) => { this.#loadErrors.delete(id) },
      activeId: () => this.#active,
      setActive: (id) => this.setActive(id),
      embeddedHost: this.#host,
      onStatusesChanged: () => { for (const listener of this.#statusListeners) listener() }
    }
    this.#mode = options.nativeClient
      ? new NativeFeatureMode(options.nativeClient, this.settings, options.nativeLoaders ?? NATIVE_LOADERS, this.#featureIds, links)
      : new LocalFeatureMode(this.settings, options.loaders ?? LOADERS, this.#featureIds, links)
  }

  statuses(): readonly FeatureStatus[] {
    return this.#featureIds.map((id) => this.#mode.describeFeature(id, {
      instanceLoaded: this.#instances.has(id),
      sessionLoaded: this.#loadedThisSession.has(id),
      loadError: this.#loadErrors.get(id)
    }))
  }

  isInstalled(id: FeatureId): boolean { return this.#mode.installed(id) }
  hasInstalledFeatures(): boolean { return this.#featureIds.some((id) => this.#mode.installed(id)) }
  isLoaded(id: FeatureId): boolean { return this.#mode.isLoaded(id, this.#instances.has(id)) }
  get activeFeature(): FeatureId | undefined { return this.#active }
  subscribe(listener: () => void): () => void { this.#statusListeners.add(listener); return () => this.#statusListeners.delete(listener) }

  setShellVisible(visible: boolean): void {
    this.#shellVisible = visible
    this.#mode.setShellVisible(visible)
  }

  async syncAtLaunch(): Promise<void> { await this.#mode.start() }

  async setInstalled(id: ApplicationId, installed: boolean): Promise<void> {
    return this.#mode.setInstalled(narrow(id), installed)
  }

  /** Select a loaded feature tab, or clear selection for Apps/Settings. */
  setActive(id: FeatureId | undefined): void {
    id = this.#mode.resolveActive(id, id !== undefined && this.#instances.has(id))
    this.#active = id
    this.#host?.setActive(id)
    for (const featureId of this.#instances.keys()) this.#setInstanceActive(featureId, featureId === id)
    this.#mode.applyActive(id)
  }

  activate(id: ApplicationId): void | Promise<void> {
    return this.#mode.activate(narrow(id))
  }

  async openShelf(): Promise<void> { await this.#shelf('open') }

  async toggleShelf(): Promise<void> { await this.#shelf('toggle') }

  async #shelf(action: 'open' | 'toggle'): Promise<void> {
    await this.#enqueue('amove', () => this.#mode.shelf(action))
  }

  relaunch(): void { app.relaunch(); app.exit(0) }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.#operations.values()].map((operation) => operation.catch(() => undefined)))
    this.#mode.stop()
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

  async #acquire(id: FeatureId): Promise<boolean> {
    if (this.#instances.has(id)) return true
    const loader = this.#mode.loader(id)
    if (!loader) return false
    let loaded: { feature: MoirasiaFeature }
    try {
      loaded = await loader()
    } catch (error) {
      this.#loadErrors.set(id, errorMessage(error))
      if (this.#mode.logsAcquisitionErrors) console.error(`Feature '${id}' failed to load`, error)
      return false
    }
    try {
      await loaded.feature.register(this.#context(id))
    } catch (error) {
      this.#loadErrors.set(id, errorMessage(error))
      if (this.#mode.logsAcquisitionErrors) console.error(`Feature '${id}' failed to register`, error)
      try { await loaded.feature.dispose() } catch { /* Best-effort rollback. */ }
      return false
    }
    this.#loadErrors.delete(id)
    this.#loadedThisSession.add(id)
    this.#instances.set(id, loaded.feature)
    try {
      const result = loaded.feature.setShellVisible?.(this.#shellVisible)
      if (result && typeof result.then === 'function') void result.catch((error) => console.error(`Feature '${id}' failed to update shell visibility`, error))
    } catch (error) { console.error(`Feature '${id}' failed to update shell visibility`, error) }
    return true
  }
}

function narrow(id: ApplicationId): FeatureId {
  if (!isFeatureId(id)) throw new TypeError(`'${id}' is not a Moirasia feature`)
  return id
}