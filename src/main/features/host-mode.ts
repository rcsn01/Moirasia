import { isFeatureId, type FeatureId, type MoirasiaFeature } from '@moirasia/desktop-shell/feature'
import type { FeatureStatus } from '../../shared/contracts'
import type { EmbeddedFeatureHost } from './embedded-host'
import type { ShellSettingsStore } from '../settings'
import { isNativeHostHealth, isNativeHostSnapshot, type NativeHostClientLike, type NativeHostConnectionEvent } from '../../shared/native-host-contracts'

export type FeatureLoader = () => Promise<{ feature: MoirasiaFeature }>
export type NativeFeatureLoader = (client: NativeHostClientLike) => Promise<{ feature: MoirasiaFeature }>

// Keep these imports as string literals. Electron-vite turns each feature into
// a separate chunk, and an uninstalled feature is never evaluated.
export const LOADERS: Record<FeatureId, FeatureLoader> = {
  amove: () => import('../../../apps/integrated/Amove/src/main/feature'),
  bonded: () => import('../../../apps/integrated/Bonded/src/main/feature'),
  shout: () => import('../../../apps/integrated/Shout/src/main/feature')
}

// Native adapters contain only renderer IPC and surface wiring. They are
// imported eagerly for installed features so their ipcMain handlers exist
// before the shell renderer can mount a feature panel.
export const NATIVE_LOADERS: Record<FeatureId, NativeFeatureLoader> = {
  amove: async (client) => (await import('../../../apps/integrated/Amove/src/main/native-feature')).createNativeFeature(client),
  bonded: async (client) => (await import('../../../apps/integrated/Bonded/src/main/native-feature')).createNativeFeature(client),
  shout: async (client) => (await import('../../../apps/integrated/Shout/src/main/native-feature')).createNativeFeature(client)
}

/** The shared per-feature facts every mode adapter composes its status from. */
export interface SharedFeatureState {
  instanceLoaded: boolean          // runtime: #instances.has(id)
  sessionLoaded: boolean           // runtime: #loadedThisSession.has(id)
  loadError: string | undefined    // runtime: #loadErrors.get(id)
}

/** The narrow callback surface the shared runtime machinery exposes to its mode adapters. */
export interface FeatureModeLinks {
  enqueue(id: FeatureId, operation: () => Promise<void> | void): Promise<void>  // the per-feature queue
  acquire(id: FeatureId): Promise<boolean>                                      // the unified load kernel
  instance(id: FeatureId): MoirasiaFeature | undefined
  removeInstance(id: FeatureId): void
  setInstanceActive(id: FeatureId, active: boolean): void
  loadError(id: FeatureId): string | undefined
  forgetLoadError(id: FeatureId): void
  activeId(): FeatureId | undefined
  setActive(id: FeatureId | undefined): void            // the public method; documented re-entrancy
  embeddedHost: EmbeddedFeatureHost | undefined
  onStatusesChanged(): void                             // native: fires wherever #emitNativeStatus fires today; the runtime wires it to the #statusListeners fan-out; local: never called
}

/** The Feature mode seam: the two executions of the Feature runtime behind its unchanged interface. */
export interface FeatureMode {
  start(): Promise<void>                                                      // the two syncAtLaunch bodies, verbatim
  installed(id: FeatureId): boolean
  isLoaded(id: FeatureId, instanceLoaded: boolean): boolean
  describeFeature(id: FeatureId, shared: SharedFeatureState): FeatureStatus   // full per-feature composition
  setInstalled(id: FeatureId, installed: boolean): Promise<void>              // the two arms, verbatim
  resolveActive(id: FeatureId | undefined, instanceLoaded: boolean): FeatureId | undefined
  applyActive(id: FeatureId | undefined): void                                // native: setUiState + lazy load; local: no-op
  activate(id: FeatureId): void | Promise<void>                               // the two arms, verbatim
  shelf(action: 'open' | 'toggle'): Promise<void>                             // the collapsed twins' arms
  stop(): void                                                                // native: unsubscribe both; local: no-op
  loader(id: FeatureId): (() => Promise<{ feature: MoirasiaFeature }>) | undefined
  readonly logsAcquisitionErrors: boolean                                     // local: true; native: false
}

/** Native mode: the Feature host owns installed-truth; adapters load eagerly against the authenticated client. */
export class NativeFeatureMode implements FeatureMode {
  readonly #client: NativeHostClientLike
  readonly #settings: ShellSettingsStore
  readonly #nativeLoaders: Partial<Record<FeatureId, NativeFeatureLoader>>
  readonly #featureIds: readonly FeatureId[]
  readonly #links: FeatureModeLinks
  readonly #statuses = new Map<FeatureId, { installed: boolean; state: 'stopped' | 'starting' | 'running' | 'error'; error?: string }>()
  #serviceState: 'starting' | 'running' | 'error' | 'stopped' | undefined
  #serviceError: string | undefined
  #unsubscribeSnapshot: (() => void) | undefined
  #unsubscribeConnection: (() => void) | undefined
  #recovery: Promise<void> | undefined
  readonly logsAcquisitionErrors = false

  constructor(client: NativeHostClientLike, settings: ShellSettingsStore, nativeLoaders: Partial<Record<FeatureId, NativeFeatureLoader>>, featureIds: readonly FeatureId[], links: FeatureModeLinks) {
    this.#client = client
    this.#settings = settings
    this.#nativeLoaders = nativeLoaders
    this.#featureIds = featureIds
    this.#links = links
  }

  async start(): Promise<void> {
    await this.#client.connect()
    this.#unsubscribeSnapshot = this.#client.subscribe('host.snapshotChanged', (payload) => { this.#handleSnapshotChanged(payload) })
    this.#unsubscribeConnection = this.#client.subscribeConnection?.((event) => { this.#handleConnection(event) })
    await this.#refreshSnapshot()
    // Feature panels invoke feature IPC the moment they mount, so every
    // installed feature's adapter (and its ipcMain handlers) must exist
    // before the shell renderer can navigate to its page.
    await Promise.all(this.#featureIds
      .filter((id) => this.installed(id))
      .map((id) => this.#links.enqueue(id, async () => { await this.#links.acquire(id) })))
  }

  installed(id: FeatureId): boolean { return this.#statuses.get(id)?.installed ?? this.#isInstalledFromSettings(id) }
  isLoaded(id: FeatureId, instanceLoaded: boolean): boolean { return instanceLoaded || this.#statuses.get(id)?.state === 'running' }

  describeFeature(id: FeatureId, shared: SharedFeatureState): FeatureStatus {
    const native = this.#statuses.get(id)
    const installed = native?.installed ?? this.#isInstalledFromSettings(id)
    const serviceError = installed ? this.#serviceError : undefined
    const state = this.#serviceState === 'starting' ? 'starting' : serviceError ? 'error' : native?.state ?? 'stopped'
    const loadError = native?.error ?? serviceError ?? shared.loadError
    const loaded = serviceError === undefined && (shared.instanceLoaded || (native?.state === 'running' && this.#serviceState !== 'starting'))
    return { id, installed, ...(state ? { state } : {}), loaded, restartPending: loaded && !installed, ...(loadError ? { loadError } : {}) }
  }

  async setInstalled(id: FeatureId, installed: boolean): Promise<void> {
    if (!installed && this.#links.activeId() === id) this.#links.setActive(undefined)
    const current = this.#statuses.get(id)
    const retry = installed && current?.installed === true && (current.state === 'error' || this.#serviceError !== undefined)
    await this.#client.request(retry ? 'host.retryFeature' : 'host.setFeatureInstalled', { id, ...(retry ? {} : { installed }) })
    await this.#refreshSnapshot()
    const instance = this.#links.instance(id)
    if (instance && !installed) {
      this.#links.removeInstance(id)
      try { await instance.dispose() }
      catch (error) { console.error(`Feature '${id}' failed to dispose after uninstall`, error) }
    }
    if (installed && this.#statuses.get(id)?.state === 'running') await this.#links.enqueue(id, async () => { await this.#links.acquire(id) })
  }

  resolveActive(id: FeatureId | undefined, _instanceLoaded: boolean): FeatureId | undefined {
    if (id !== undefined && !this.installed(id)) return undefined
    return id
  }

  applyActive(id: FeatureId | undefined): void {
    void this.#client.request('host.setUiState', { page: id ?? 'general' }).catch(() => undefined)
    if (id && !this.#links.instance(id)) void this.#links.enqueue(id, async () => { await this.#links.acquire(id) })
  }

  async activate(id: FeatureId): Promise<void> {
    if (!this.installed(id)) throw new Error(`Feature '${id}' is not installed.`)
    const loaded = await this.#links.acquire(id)
    if (!loaded) throw new Error(this.#links.loadError(id) ?? `Feature '${id}' could not be loaded.`)
    this.#links.setActive(id)
    this.#links.instance(id)?.activate?.()
  }

  async shelf(action: 'open' | 'toggle'): Promise<void> {
    if (!this.installed('amove')) throw new Error('Amove is not installed.')
    if (!await this.#links.acquire('amove')) throw new Error(this.#links.loadError('amove') ?? 'Amove UI adapter could not be loaded.')
    const instance = this.#links.instance('amove')
    if (action === 'open' && instance?.openShelf) await instance.openShelf()
    else if (action === 'toggle' && instance?.toggleShelf) await instance.toggleShelf()
    else throw new Error('Amove shelf adapter is unavailable.')
  }

  stop(): void {
    this.#unsubscribeSnapshot?.(); this.#unsubscribeSnapshot = undefined
    this.#unsubscribeConnection?.(); this.#unsubscribeConnection = undefined
  }

  loader(id: FeatureId): (() => Promise<{ feature: MoirasiaFeature }>) | undefined {
    const loader = this.#nativeLoaders[id]
    if (!loader) return undefined
    return () => loader(this.#client)
  }

  /** Load an adapter for each feature whose native state has reached running
   * without one yet — covers a first load attempt that lost the race with a
   * still-starting feature service. */
  #loadRunningNativeAdapters(): void {
    if (this.#serviceError) return
    for (const id of this.#featureIds) {
      if (this.#links.instance(id) || this.#statuses.get(id)?.state !== 'running') continue
      void this.#links.enqueue(id, async () => { await this.#links.acquire(id) })
    }
  }

  async #refreshSnapshot(): Promise<void> {
    const snapshot = await this.#client.request<unknown>('host.getSnapshot')
    if (this.#applySnapshot(snapshot)) {
      this.#loadRunningNativeAdapters()
      this.#onStatusesChanged()
    }
  }

  #handleSnapshotChanged(value: unknown): void {
    if (this.#applyHealth(value)) {
      this.#onStatusesChanged()
      return
    }
    if (this.#applySnapshot(value)) {
      this.#loadRunningNativeAdapters()
      this.#onStatusesChanged()
    }
  }

  #handleConnection(event: NativeHostConnectionEvent): void {
    if (event.state === 'disconnected') {
      this.#serviceState = 'error'
      this.#serviceError = event.error?.message ?? 'Native host disconnected.'
      this.#onStatusesChanged()
      return
    }
    if (event.state !== 'reconnected') return
    this.#serviceState = 'starting'
    this.#serviceError = 'Native host is reconnecting.'
    this.#onStatusesChanged()
    if (!this.#recovery) {
      this.#recovery = this.#refreshSnapshot().catch((error) => {
        this.#serviceState = 'error'
        this.#serviceError = errorMessage(error)
        this.#onStatusesChanged()
      }).finally(() => { this.#recovery = undefined })
    }
  }

  #applyHealth(value: unknown): boolean {
    let payload: unknown = value
    if (value && typeof value === 'object' && 'featureService' in value && (value as { featureService?: unknown }).featureService === 'error') {
      payload = { featureService: { state: 'error', error: 'MoirasiaFeatureService is unavailable.', restartCount: 0 } }
    }
    if (!isNativeHostHealth(payload)) return false
    const health = payload.featureService
    this.#serviceState = health.state
    this.#serviceError = health.state === 'error'
      ? health.error
      : health.state === 'starting'
        ? 'MoirasiaFeatureService is starting.'
        : health.state === 'stopped'
          ? 'MoirasiaFeatureService is stopped.'
          : this.#serviceError
    return true
  }

  #applySnapshot(value: unknown): boolean {
    const full = isNativeHostSnapshot(value)
    const features = full ? value.features : value && typeof value === 'object' ? (value as { features?: unknown }).features : undefined
    if (!Array.isArray(features)) return false
    const expected = new Set(this.#featureIds)
    const known = new Set<FeatureId>(['amove', 'bonded', 'shout'])
    const next = new Map<FeatureId, { installed: boolean; state: 'stopped' | 'starting' | 'running' | 'error'; error?: string }>()
    for (const entry of features) {
      if (!entry || typeof entry !== 'object') return false
      const item = entry as { id?: unknown; installed?: unknown; state?: unknown; error?: unknown }
      if (!isFeatureId(item.id) || !known.has(item.id) || next.has(item.id) || typeof item.installed !== 'boolean' || !['stopped', 'starting', 'running', 'error'].includes(String(item.state))) return false
      if (expected.has(item.id)) next.set(item.id, { installed: item.installed, state: item.state as 'stopped' | 'starting' | 'running' | 'error', ...(typeof item.error === 'string' ? { error: item.error } : {}) })
    }
    if (next.size !== expected.size || [...expected].some((id) => !next.has(id))) return false
    this.#statuses.clear()
    for (const [id, status] of next) this.#statuses.set(id, status)
    this.#serviceState = 'running'
    this.#serviceError = undefined
    return true
  }

  #onStatusesChanged(): void { this.#links.onStatusesChanged() }

  #isInstalledFromSettings(id: FeatureId): boolean { return this.#settings.get().features[id] !== false }
}

/** Local mode: Electron owns everything; installed-truth lives in the Shell settings store. */
export class LocalFeatureMode implements FeatureMode {
  readonly #settings: ShellSettingsStore
  readonly #loaders: Partial<Record<FeatureId, FeatureLoader>>
  readonly #featureIds: readonly FeatureId[]
  readonly #links: FeatureModeLinks
  readonly logsAcquisitionErrors = true

  constructor(settings: ShellSettingsStore, loaders: Partial<Record<FeatureId, FeatureLoader>>, featureIds: readonly FeatureId[], links: FeatureModeLinks) {
    this.#settings = settings
    this.#loaders = loaders
    this.#featureIds = featureIds
    this.#links = links
  }

  async start(): Promise<void> {
    for (const id of this.#featureIds) {
      if (this.installed(id)) await this.#links.enqueue(id, async () => { await this.#links.acquire(id) })
    }
  }

  installed(id: FeatureId): boolean { return this.#settings.get().features[id] !== false }
  isLoaded(_id: FeatureId, instanceLoaded: boolean): boolean { return instanceLoaded }

  describeFeature(id: FeatureId, shared: SharedFeatureState): FeatureStatus {
    const installed = this.installed(id)
    const loaded = shared.sessionLoaded
    return { id, installed, loaded, restartPending: loaded && !installed, ...(shared.loadError ? { loadError: shared.loadError } : {}) }
  }

  async setInstalled(id: FeatureId, installed: boolean): Promise<void> {
    await this.#links.enqueue(id, async () => {
      if (!installed) {
        this.#links.forgetLoadError(id)
        if (!this.installed(id)) return
        // The renderer must leave the feature tab before the feature removes
        // its IPC handlers and native listeners.
        if (this.#links.activeId() === id) this.#links.setActive(undefined)
        await this.#settings.update({ features: { [id]: false } })
        const instance = this.#links.instance(id)
        if (!instance) return
        try { await instance.dispose() }
        catch (error) {
          await this.#settings.update({ features: { [id]: true } })
          throw error
        }
        this.#links.removeInstance(id)
        return
      }
      const newlyInstalled = !this.installed(id)
      if (newlyInstalled) await this.#settings.update({ features: { [id]: true } })
      const loaded = await this.#links.acquire(id)
      if (!loaded && newlyInstalled) await this.#settings.update({ features: { [id]: false } })
      if (loaded && this.#links.activeId() === id) this.#links.setInstanceActive(id, true)
    })
  }

  resolveActive(id: FeatureId | undefined, instanceLoaded: boolean): FeatureId | undefined {
    if (id !== undefined && (!this.installed(id) || !instanceLoaded)) return undefined
    return id
  }

  applyActive(_id: FeatureId | undefined): void { /* local statuses surface through command-returned snapshots only */ }

  activate(id: FeatureId): void {
    const instance = this.#links.instance(id)
    if (!instance?.activate && !this.#links.embeddedHost) throw new Error('Feature is not running inside Moirasia. Relaunch or reinstall it.')
    if (!instance) throw new Error('Feature is not loaded. Relaunch or reinstall it.')
    this.#links.setActive(id)
    if (instance.activate) instance.activate()
    else this.#links.embeddedHost?.activate(id)
  }

  async shelf(action: 'open' | 'toggle'): Promise<void> {
    const instance = this.#links.instance('amove')
    if (action === 'open') {
      if (instance?.openShelf) await instance.openShelf()
      else this.activate('amove')
      return
    }
    if (instance?.toggleShelf) await instance.toggleShelf()
    else if (instance?.openShelf) await instance.openShelf()
    else this.activate('amove')
  }

  stop(): void { /* local mode holds no native subscriptions */ }

  loader(id: FeatureId): (() => Promise<{ feature: MoirasiaFeature }>) | undefined { return this.#loaders[id] }
}

export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }