import { app } from 'electron'
import { isFeatureId, type FeatureContext, type FeatureId, type MoirasiaFeature } from '@moirasia/desktop-shell/feature'
import type { ApplicationId, FeatureStatus } from '../../shared/contracts'
import type { EmbeddedFeatureHost } from './embedded-host'
import type { ShellSettingsStore } from '../settings'
import { isNativeHostHealth, isNativeHostSnapshot, type NativeHostClientLike, type NativeHostConnectionEvent } from '../../shared/native-host-contracts'
import { suiteFeatureContext } from './suite-context'

export { suiteFeatureContext }

type FeatureLoader = () => Promise<{ feature: MoirasiaFeature }>
type NativeFeatureLoader = (client: NativeHostClientLike) => Promise<{ feature: MoirasiaFeature }>

// Keep these imports as string literals. Electron-vite turns each feature into
// a separate chunk, and an uninstalled feature is never evaluated.
const LOADERS: Record<FeatureId, FeatureLoader> = {
  amove: () => import('../../../apps/integrated/Amove/src/main/feature'),
  bonded: () => import('../../../apps/integrated/Bonded/src/main/feature'),
  shout: () => import('../../../apps/integrated/Shout/src/main/feature')
}

// Native adapters contain only renderer IPC and surface wiring. They are
// imported eagerly for installed features so their ipcMain handlers exist
// before the shell renderer can mount a feature panel.
const NATIVE_LOADERS: Record<FeatureId, NativeFeatureLoader> = {
  amove: async (client) => (await import('../../../apps/integrated/Amove/src/main/native-feature')).createNativeFeature(client),
  bonded: async (client) => (await import('../../../apps/integrated/Bonded/src/main/native-feature')).createNativeFeature(client),
  shout: async (client) => (await import('../../../apps/integrated/Shout/src/main/native-feature')).createNativeFeature(client)
}

export class FeatureRuntime {
  #instances = new Map<FeatureId, MoirasiaFeature>()
  #loadedThisSession = new Set<FeatureId>()
  #loadErrors = new Map<FeatureId, string>()
  #operations = new Map<FeatureId, Promise<void>>()
  #active: FeatureId | undefined
  readonly #statusListeners = new Set<() => void>()
  readonly #loaders: Partial<Record<FeatureId, FeatureLoader>>
  readonly #nativeLoaders: Partial<Record<FeatureId, NativeFeatureLoader>>
  readonly #context: (id: FeatureId) => FeatureContext
  readonly #host: EmbeddedFeatureHost | undefined
  readonly #nativeClient: NativeHostClientLike | undefined
  readonly #nativeStatuses = new Map<FeatureId, { installed: boolean; state: 'stopped' | 'starting' | 'running' | 'error'; error?: string }>()
  #nativeServiceState: 'starting' | 'running' | 'error' | 'stopped' | undefined
  #nativeServiceError: string | undefined
  #unsubscribeNative: (() => void) | undefined
  #unsubscribeNativeConnection: (() => void) | undefined
  #nativeRecovery: Promise<void> | undefined

  constructor(
    private readonly settings: ShellSettingsStore,
    options: { loaders?: Partial<Record<FeatureId, FeatureLoader>>; nativeLoaders?: Partial<Record<FeatureId, NativeFeatureLoader>>; context?: (id: FeatureId) => FeatureContext; host?: EmbeddedFeatureHost; nativeClient?: NativeHostClientLike } = {}
  ) {
    this.#loaders = options.loaders ?? LOADERS
    this.#nativeLoaders = options.nativeLoaders ?? NATIVE_LOADERS
    this.#host = options.host
    this.#nativeClient = options.nativeClient
    this.#context = options.context ?? (this.#host
      ? (id) => suiteFeatureContext(id, this.#host!.surface(id))
      : () => { throw new Error('FeatureRuntime requires an embedded host or an explicit feature context') })
  }

  statuses(): readonly FeatureStatus[] {
    return (Object.keys(this.#loaders) as FeatureId[]).map((id) => {
      const native = this.#nativeStatuses.get(id)
      const nativeMode = this.#nativeClient !== undefined
      const installed = native?.installed ?? this.isInstalledFromSettings(id)
      const serviceError = installed ? this.#nativeServiceError : undefined
      const state = nativeMode
        ? (this.#nativeServiceState === 'starting' ? 'starting' : serviceError ? 'error' : native?.state ?? 'stopped')
        : undefined
      const loadError = native?.error ?? serviceError ?? this.#loadErrors.get(id)
      const loaded = nativeMode
        ? (serviceError === undefined && (this.#instances.has(id) || (native?.state === 'running' && this.#nativeServiceState !== 'starting')))
        : this.#loadedThisSession.has(id)
      return { id, installed, ...(state ? { state, ...(loadError ? { error: loadError } : {}) } : {}), loaded, restartPending: loaded && !installed, ...(loadError ? { loadError } : {}) }
    })
  }

  isInstalled(id: FeatureId): boolean { return this.#nativeClient ? (this.#nativeStatuses.get(id)?.installed ?? this.isInstalledFromSettings(id)) : this.isInstalledFromSettings(id) }
  hasInstalledFeatures(): boolean { return (Object.keys(this.#loaders) as FeatureId[]).some((id) => this.isInstalled(id)) }
  isLoaded(id: FeatureId): boolean { return this.#nativeClient ? this.#instances.has(id) || this.#nativeStatuses.get(id)?.state === 'running' : this.#instances.has(id) }
  get activeFeature(): FeatureId | undefined { return this.#active }
  subscribe(listener: () => void): () => void { this.#statusListeners.add(listener); return () => this.#statusListeners.delete(listener) }

  async syncAtLaunch(): Promise<void> {
    if (this.#nativeClient) {
      await this.#nativeClient.connect()
      this.#unsubscribeNative = this.#nativeClient.subscribe('host.snapshotChanged', (payload) => { this.#handleNativeSnapshotChanged(payload) })
      this.#unsubscribeNativeConnection = this.#nativeClient.subscribeConnection?.((event) => { this.#handleNativeConnection(event) })
      await this.#refreshNativeSnapshot()
      // Feature panels invoke feature IPC the moment they mount, so every
      // installed feature's adapter (and its ipcMain handlers) must exist
      // before the shell renderer can navigate to its page.
      await Promise.all((Object.keys(this.#loaders) as FeatureId[])
        .filter((id) => this.isInstalled(id))
        .map((id) => this.#enqueue(id, async () => { await this.#loadNative(id) })))
      return
    }
    for (const id of Object.keys(this.#loaders) as FeatureId[]) {
      if (this.isInstalled(id)) await this.#enqueue(id, async () => { await this.#load(id) })
    }
  }

  async setInstalled(id: ApplicationId, installed: boolean): Promise<void> {
    const featureId = narrow(id)
    if (this.#nativeClient) {
      if (!installed && this.#active === featureId) this.setActive(undefined)
      const current = this.#nativeStatuses.get(featureId)
      const retry = installed && current?.installed === true && (current.state === 'error' || this.#nativeServiceError !== undefined)
      await this.#nativeClient.request(retry ? 'host.retryFeature' : 'host.setFeatureInstalled', { id: featureId, ...(retry ? {} : { installed }) })
      await this.#refreshNativeSnapshot()
      const instance = this.#instances.get(featureId)
      if (instance && !installed) {
        this.#instances.delete(featureId)
        try { await instance.dispose() }
        catch (error) { console.error(`Feature '${featureId}' failed to dispose after uninstall`, error) }
      }
      if (installed && this.#nativeStatuses.get(featureId)?.state === 'running') await this.#enqueue(featureId, async () => { await this.#loadNative(featureId) })
      return
    }
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
    if (id !== undefined && (!this.isInstalled(id) || (!this.#nativeClient && !this.#instances.has(id)))) id = undefined
    this.#active = id
    this.#host?.setActive(id)
    for (const featureId of this.#instances.keys()) this.#setInstanceActive(featureId, featureId === id)
    if (this.#nativeClient) {
      void this.#nativeClient.request('host.setUiState', { page: id ?? 'general' }).catch(() => undefined)
      if (id && !this.#instances.has(id)) void this.#enqueue(id, async () => { await this.#loadNative(id) })
    }
  }

  activate(id: ApplicationId): void | Promise<void> {
    const featureId = narrow(id)
    if (this.#nativeClient) return this.#activateNative(featureId)
    const instance = this.#instances.get(featureId)
    if (!instance?.activate && !this.#host) throw new Error('Feature is not running inside Moirasia. Relaunch or reinstall it.')
    if (!instance) throw new Error('Feature is not loaded. Relaunch or reinstall it.')
    this.setActive(featureId)
    if (instance.activate) instance.activate()
    else this.#host?.activate(featureId)
  }

  async openShelf(): Promise<void> {
    await this.#enqueue('amove', async () => {
      if (!this.#nativeClient) {
        const instance = this.#instances.get('amove')
        if (instance?.openShelf) await instance.openShelf()
        else this.activate('amove')
        return
      }
      if (!this.isInstalled('amove')) throw new Error('Amove is not installed.')
      if (!await this.#loadNative('amove')) throw new Error(this.#loadErrors.get('amove') ?? 'Amove UI adapter could not be loaded.')
      const instance = this.#instances.get('amove')
      if (instance?.openShelf) await instance.openShelf()
      else throw new Error('Amove shelf adapter is unavailable.')
    })
  }

  async toggleShelf(): Promise<void> {
    await this.#enqueue('amove', async () => {
      if (!this.#nativeClient) {
        const instance = this.#instances.get('amove')
        if (instance?.toggleShelf) await instance.toggleShelf()
        else if (instance?.openShelf) await instance.openShelf()
        else this.activate('amove')
        return
      }
      if (!this.isInstalled('amove')) throw new Error('Amove is not installed.')
      if (!await this.#loadNative('amove')) throw new Error(this.#loadErrors.get('amove') ?? 'Amove UI adapter could not be loaded.')
      const instance = this.#instances.get('amove')
      if (instance?.toggleShelf) await instance.toggleShelf()
      else throw new Error('Amove shelf adapter is unavailable.')
    })
  }

  relaunch(): void { app.relaunch(); app.exit(0) }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.#operations.values()].map((operation) => operation.catch(() => undefined)))
    this.#unsubscribeNative?.(); this.#unsubscribeNative = undefined
    this.#unsubscribeNativeConnection?.(); this.#unsubscribeNativeConnection = undefined
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

  /** Load an adapter for each feature whose native state has reached running
   * without one yet — covers a first load attempt that lost the race with a
   * still-starting feature service. */
  #loadRunningNativeAdapters(): void {
    if (!this.#nativeClient || this.#nativeServiceError) return
    for (const id of Object.keys(this.#loaders) as FeatureId[]) {
      if (this.#instances.has(id) || this.#nativeStatuses.get(id)?.state !== 'running') continue
      void this.#enqueue(id, async () => { await this.#loadNative(id) })
    }
  }

  #enqueue(id: FeatureId, operation: () => Promise<void> | void): Promise<void> {
    const previous = this.#operations.get(id) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.#operations.set(id, next)
    return next.finally(() => { if (this.#operations.get(id) === next) this.#operations.delete(id) })
  }

  async #activateNative(id: FeatureId): Promise<void> {
    if (!this.isInstalled(id)) throw new Error(`Feature '${id}' is not installed.`)
    const loaded = await this.#loadNative(id)
    if (!loaded) throw new Error(this.#loadErrors.get(id) ?? `Feature '${id}' could not be loaded.`)
    this.setActive(id)
    this.#instances.get(id)?.activate?.()
  }

  async #loadNative(id: FeatureId): Promise<boolean> {
    if (this.#instances.has(id)) return true
    const loader = this.#nativeLoaders[id]
    if (!this.#nativeClient || !loader) return false
    let loaded: { feature: MoirasiaFeature }
    try { loaded = await loader(this.#nativeClient) }
    catch (error) { this.#loadErrors.set(id, errorMessage(error)); return false }
    try { await loaded.feature.register(this.#context(id)) }
    catch (error) { this.#loadErrors.set(id, errorMessage(error)); try { await loaded.feature.dispose() } catch { /* rollback */ }; return false }
    this.#loadErrors.delete(id); this.#loadedThisSession.add(id); this.#instances.set(id, loaded.feature); return true
  }

  async #refreshNativeSnapshot(): Promise<void> {
    if (!this.#nativeClient) return
    const snapshot = await this.#nativeClient.request<unknown>('host.getSnapshot')
    if (this.#applyNativeSnapshot(snapshot)) {
      this.#loadRunningNativeAdapters()
      this.#emitNativeStatus()
    }
  }

  #handleNativeSnapshotChanged(value: unknown): void {
    if (this.#applyNativeHealth(value)) {
      this.#emitNativeStatus()
      return
    }
    if (this.#applyNativeSnapshot(value)) {
      this.#loadRunningNativeAdapters()
      this.#emitNativeStatus()
    }
  }

  #handleNativeConnection(event: NativeHostConnectionEvent): void {
    if (event.state === 'disconnected') {
      this.#nativeServiceState = 'error'
      this.#nativeServiceError = event.error?.message ?? 'Native host disconnected.'
      this.#emitNativeStatus()
      return
    }
    if (event.state !== 'reconnected') return
    this.#nativeServiceState = 'starting'
    this.#nativeServiceError = 'Native host is reconnecting.'
    this.#emitNativeStatus()
    if (!this.#nativeRecovery) {
      this.#nativeRecovery = this.#refreshNativeSnapshot().catch((error) => {
        this.#nativeServiceState = 'error'
        this.#nativeServiceError = errorMessage(error)
        this.#emitNativeStatus()
      }).finally(() => { this.#nativeRecovery = undefined })
    }
  }

  #applyNativeHealth(value: unknown): boolean {
    let payload: unknown = value
    if (value && typeof value === 'object' && 'featureService' in value && (value as { featureService?: unknown }).featureService === 'error') {
      payload = { featureService: { state: 'error', error: 'MoirasiaFeatureService is unavailable.', restartCount: 0 } }
    }
    if (!isNativeHostHealth(payload)) return false
    const health = payload.featureService
    this.#nativeServiceState = health.state
    this.#nativeServiceError = health.state === 'error'
      ? health.error
      : health.state === 'starting'
        ? 'MoirasiaFeatureService is starting.'
        : health.state === 'stopped'
          ? 'MoirasiaFeatureService is stopped.'
          : this.#nativeServiceError
    return true
  }

  #applyNativeSnapshot(value: unknown): boolean {
    const full = isNativeHostSnapshot(value)
    const features = full ? value.features : value && typeof value === 'object' ? (value as { features?: unknown }).features : undefined
    if (!Array.isArray(features)) return false
    const expected = new Set(Object.keys(this.#loaders) as FeatureId[])
    const known = new Set<FeatureId>(['amove', 'bonded', 'shout'])
    const next = new Map<FeatureId, { installed: boolean; state: 'stopped' | 'starting' | 'running' | 'error'; error?: string }>()
    for (const entry of features) {
      if (!entry || typeof entry !== 'object') return false
      const item = entry as { id?: unknown; installed?: unknown; state?: unknown; error?: unknown }
      if (!isFeatureId(item.id) || !known.has(item.id) || next.has(item.id) || typeof item.installed !== 'boolean' || !['stopped', 'starting', 'running', 'error'].includes(String(item.state))) return false
      if (expected.has(item.id)) next.set(item.id, { installed: item.installed, state: item.state as 'stopped' | 'starting' | 'running' | 'error', ...(typeof item.error === 'string' ? { error: item.error } : {}) })
    }
    if (next.size !== expected.size || [...expected].some((id) => !next.has(id))) return false
    this.#nativeStatuses.clear()
    for (const [id, status] of next) this.#nativeStatuses.set(id, status)
    this.#nativeServiceState = 'running'
    this.#nativeServiceError = undefined
    return true
  }

  #emitNativeStatus(): void { for (const listener of this.#statusListeners) listener() }

  private isInstalledFromSettings(id: FeatureId): boolean { return this.settings.get().features[id] !== false }

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

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

export type { FeatureLoader }
