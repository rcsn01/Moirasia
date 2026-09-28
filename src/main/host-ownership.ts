import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AppPresence, type NativeMenuBarHostOptions } from './app-presence'
import { applicationAgentPath, moirasiaFeatureServicePath, moirasiaHostPath, moirasiaHostSocketPath, moirasiaNativeFeaturePaths } from './paths'
import { NativeHostClient } from './native-host/client'
import type { NativeHostClientLike } from '../shared/native-host-contracts'
import type { AppPresenceMode, ControllerPage } from '../shared/contracts'

/** The presence operations ownership relies on; `AppPresence` satisfies this structurally. */
export interface OwnedPresence {
  readonly mode: AppPresenceMode
  apply(mode: AppPresenceMode): void
  waitForNativeHost(timeoutMs?: number): Promise<boolean>
  restartNativeHost(timeoutMs?: number): Promise<boolean>
  preserveNativeHost(): void
  abortNativeBootstrap(): void
  dispose(): void
}

export type PresenceFactory = (options: { menuBarIconPath: string; open(): void; nativeHost?: NativeMenuBarHostOptions }) => OwnedPresence
export type NativeClientFactory = (options: { socketPath: string; tokenPath: string }) => NativeHostClientLike

export interface HostOwnershipOptions {
  readonly userData: string
  readonly menuBarIconPath: string
  readonly applicationPath: string
  readonly resourcesPath: string
  readonly platform: string
  readonly initialPresence: AppPresenceMode
  readonly openShell: (page?: ControllerPage) => void | Promise<void>
  readonly toggleShelf: () => void | Promise<void>
  readonly shelfVisible: (visible: boolean) => void
  readonly onAvailabilityChanged: () => void
  readonly createPresence?: PresenceFactory
  readonly createClient?: NativeClientFactory
}

/** Owns which process hosts the suite: runtime selection, bootstrap, reconnect, native event routing, and quit coordination. */
export class HostOwnership {
  readonly #options: HostOwnershipOptions
  #presence: OwnedPresence
  #client: NativeHostClientLike | undefined
  #nativeSelected: boolean
  #willQuit = false
  #exitRecorded = false
  #reconnecting: Promise<void> | undefined
  #started = false
  #unsubscribers: Array<() => void> = []

  private constructor(options: HostOwnershipOptions, presence: OwnedPresence, client: NativeHostClientLike | undefined, nativeSelected: boolean) {
    this.#options = options
    this.#presence = presence
    this.#client = client
    this.#nativeSelected = nativeSelected
  }

  /** Detects the host runtime and bootstraps the matching ownership; failures abort and rethrow with no local fallback. */
  static async acquire(options: HostOwnershipOptions): Promise<HostOwnership> {
    const nativeRuntimeAvailable = options.platform === 'darwin' && existsSync(moirasiaHostPath(options.resourcesPath)) && existsSync(moirasiaFeatureServicePath(options.resourcesPath))
    const createPresence: PresenceFactory = options.createPresence ?? ((presenceOptions) => new AppPresence(presenceOptions))
    const createClient: NativeClientFactory = options.createClient ?? ((clientOptions) => new NativeHostClient(clientOptions))
    const open = (): void => { void Promise.resolve(options.openShell()).catch(console.error) }
    const nativeFeaturePaths = nativeRuntimeAvailable ? moirasiaNativeFeaturePaths(options.resourcesPath) : undefined
    const nativeHostOptions = nativeRuntimeAvailable ? {
      executable: moirasiaHostPath(options.resourcesPath),
      featureServicePath: moirasiaFeatureServicePath(options.resourcesPath),
      applicationPath: options.applicationPath,
      userData: options.userData,
      iconPath: options.menuBarIconPath,
      pidPath: join(options.userData, 'menu-host.pid'),
      bondedHelperPath: nativeFeaturePaths!.bondedHelperPath,
      shoutDriverPath: nativeFeaturePaths!.shoutDriverPath
    } : undefined
    const localHostOptions = options.platform === 'darwin' ? {
      executable: applicationAgentPath(options.resourcesPath),
      applicationPath: options.applicationPath,
      pidPath: join(options.userData, 'menu-host.pid')
    } : undefined

    if (nativeRuntimeAvailable && nativeHostOptions) {
      const candidate = createPresence({ menuBarIconPath: options.menuBarIconPath, open, nativeHost: nativeHostOptions })
      const client = createClient({ socketPath: moirasiaHostSocketPath(options.userData), tokenPath: join(options.userData, 'runtime', 'client.token') })
      try {
        candidate.apply(options.initialPresence)
        if (!await candidate.waitForNativeHost() || !await connectNativeHost(client)) throw new Error('MoirasiaHost.app did not become ready.')
        return new HostOwnership(options, candidate, client, true)
      } catch (error) {
        candidate.abortNativeBootstrap()
        client.close()
        console.error('Native Moirasia bootstrap failed; local ownership was not selected.', error)
        throw error
      }
    }

    const presence = createPresence({ menuBarIconPath: options.menuBarIconPath, open, ...(localHostOptions ? { nativeHost: localHostOptions } : {}) })
    presence.apply(options.initialPresence)
    return new HostOwnership(options, presence, undefined, false)
  }

  /** Registers the native subscriptions; no native callback fires before this. */
  start(): void {
    if (this.#started) return
    this.#started = true
    const client = this.#client
    if (!this.#nativeSelected || !client) return
    this.#unsubscribers.push(
      client.subscribeConnection
        ? client.subscribeConnection((event) => {
          this.#options.onAvailabilityChanged()
          if (event.state === 'disconnected') void this.#reconnect()
        })
        : () => undefined,
      client.subscribe('host.willQuit', () => { this.#willQuit = true }),
      client.subscribe('ui.openShell', () => { void this.#options.openShell() }),
      client.subscribe('ui.toggleShelf', () => { void this.#options.toggleShelf() }),
      client.subscribe('host.uiStateChanged', (payload) => {
        if (payload && typeof payload === 'object' && typeof (payload as { shelfVisible?: unknown }).shelfVisible === 'boolean') this.#options.shelfVisible((payload as { shelfVisible: boolean }).shelfVisible)
      })
    )
  }

  get presence(): OwnedPresence { return this.#presence }
  get nativeClient(): NativeHostClientLike | undefined { return this.#client }

  canExitToNativeHost(): boolean { return this.#nativeSelected && this.#client?.isConnected() === true }

  /** Records the exit-to-host intent so quit preserves the native host instead of stopping it. */
  exitToHost(): void { this.#exitRecorded = this.#nativeSelected && this.#client?.isConnected() === true }

  /** Runs the quit sequence; the client closes before the returned promise resolves, and the caller quits in its continuation. */
  async coordinateQuit(teardown: () => Promise<void>): Promise<void> {
    for (const stop of this.#unsubscribers) stop()
    this.#unsubscribers = []
    if (this.#exitRecorded && this.#client?.isConnected() === true) this.#presence.preserveNativeHost()
    this.#presence.dispose()
    const shouldStopNativeRuntime = Boolean(this.#nativeSelected && this.#client?.isConnected() && !this.#exitRecorded && !this.#willQuit)
    if (shouldStopNativeRuntime) await this.#client!.request('host.quitSuite').catch((error) => { console.error('Could not coordinate native suite quit', error) }).finally(() => this.#runTeardown(teardown))
    else await this.#runTeardown(teardown)
  }

  async #runTeardown(teardown: () => Promise<void>): Promise<void> {
    await teardown()
    this.#client?.close()
  }

  async #reconnect(): Promise<void> {
    if (!this.#nativeSelected || !this.#client || this.#willQuit || this.#reconnecting) return this.#reconnecting
    const client = this.#client
    this.#reconnecting = (async () => {
      if (!await this.#presence.restartNativeHost()) return
      await client.connect()
    })().catch((error) => { console.error('Could not reconnect to MoirasiaHost', error) }).finally(() => { this.#reconnecting = undefined })
    return this.#reconnecting
  }
}

async function connectNativeHost(client: NativeHostClientLike): Promise<boolean> {
  try {
    await client.connect()
    const snapshot = await client.getSnapshot()
    if (!snapshot) { console.error('MoirasiaHost returned an invalid snapshot.'); return false }
    return true
  } catch (error) {
    console.error('Could not connect to MoirasiaHost', error)
    return false
  }
}