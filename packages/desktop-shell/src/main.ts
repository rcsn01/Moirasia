import { app, ipcMain, nativeTheme, type BrowserWindow, type BrowserWindowConstructorOptions, type NativeTheme, type WebContents } from 'electron'
import { copyFile, mkdir, open, readFile, rename, rm, stat, watch } from 'node:fs/promises'
import { writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { APPEARANCES, PRODUCT_IDS, isAppearance, isProductId, type Appearance, type AppearanceSnapshot, type LoginItemControlResult, type ProductId } from './index'

const DEFAULTS: Record<ProductId, Appearance> = { moirasia: 'system', amove: 'system', vox: 'system', exithibition: 'dark', bonded: 'system', orbis: 'system', yn360: 'system' }
const EMPTY: AppearanceSnapshot = { version: 1, revision: 0, values: DEFAULTS }

export function appearanceRegistryPath(appData = app.getPath('appData')): string {
  return join(appData, 'Moirasia', 'appearance.json')
}

export class AppearanceRegistry {
  readonly filePath: string
  #snapshot: AppearanceSnapshot = structuredClone(EMPTY)
  #listeners = new Set<(snapshot: AppearanceSnapshot) => void>()
  #watcher: ReturnType<typeof watch> | undefined
  #watchAbort: AbortController | undefined
  #reloadTimer: NodeJS.Timeout | undefined
  #queue: Promise<void> = Promise.resolve()

  constructor(filePath = appearanceRegistryPath()) { this.filePath = filePath }

  async load(legacy: Partial<Record<ProductId, Appearance>> = {}): Promise<AppearanceSnapshot> {
    const primary = await readSnapshot(this.filePath)
    const loaded = primary ?? await readSnapshot(`${this.filePath}.backup`)
    this.#snapshot = loaded ?? { version: 1, revision: 0, values: { ...DEFAULTS, ...validLegacy(legacy) } }
    if (!primary) await this.#persist(this.#snapshot)
    await this.#watch()
    return this.get()
  }

  get(): AppearanceSnapshot { return structuredClone(this.#snapshot) }

  async set(product: ProductId, appearance: Appearance): Promise<AppearanceSnapshot> {
    if (!isProductId(product) || !isAppearance(appearance)) throw new TypeError('Invalid appearance update')
    return this.#update((current) => ({ ...current.values, [product]: appearance }))
  }

  async setAll(appearance: Appearance): Promise<AppearanceSnapshot> {
    if (!isAppearance(appearance)) throw new TypeError('Invalid appearance update')
    return this.#update(() => Object.fromEntries(PRODUCT_IDS.map((id) => [id, appearance])) as Record<ProductId, Appearance>)
  }

  subscribe(listener: (snapshot: AppearanceSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  close(): void {
    if (this.#reloadTimer) clearTimeout(this.#reloadTimer)
    this.#watchAbort?.abort(); this.#watcher = undefined; this.#watchAbort = undefined
  }

  async #update(update: (current: AppearanceSnapshot) => Record<ProductId, Appearance>): Promise<AppearanceSnapshot> {
    this.#queue = this.#queue.then(async () => {
      await withFileLock(`${this.filePath}.lock`, async () => {
        const disk = await readSnapshot(this.filePath) ?? await readSnapshot(`${this.filePath}.backup`) ?? this.#snapshot
        const next: AppearanceSnapshot = { version: 1, revision: Math.max(disk.revision, this.#snapshot.revision) + 1, values: update(disk) }
        await this.#persist(next)
        this.#accept(next)
      })
    })
    await this.#queue
    return this.get()
  }

  async #persist(snapshot: AppearanceSnapshot): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.tmp`
    const handle = await open(temporary, 'w', 0o600)
    try { await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`); await handle.sync() } finally { await handle.close() }
    await rename(temporary, this.filePath)
    await copyFile(this.filePath, `${this.filePath}.backup`)
  }

  #accept(snapshot: AppearanceSnapshot): void {
    if (snapshot.revision < this.#snapshot.revision) return
    const changed = JSON.stringify(snapshot) !== JSON.stringify(this.#snapshot)
    this.#snapshot = snapshot
    if (changed) for (const listener of this.#listeners) listener(this.get())
  }

  async #watch(): Promise<void> {
    if (this.#watcher) return
    await mkdir(dirname(this.filePath), { recursive: true })
    this.#watchAbort = new AbortController()
    this.#watcher = watch(dirname(this.filePath), { signal: this.#watchAbort.signal })
    void (async () => {
      try {
        for await (const event of this.#watcher!) {
          if (event.filename !== undefined && !String(event.filename).startsWith('appearance.json')) continue
          if (this.#reloadTimer) clearTimeout(this.#reloadTimer)
          this.#reloadTimer = setTimeout(() => void this.#reload(), 40)
        }
      } catch { /* watcher closed */ }
    })()
  }

  async #reload(): Promise<void> {
    const next = await readSnapshot(this.filePath) ?? await readSnapshot(`${this.filePath}.backup`)
    if (next) this.#accept(next)
  }
}

export function applyAppearance(nativeTheme: NativeTheme, appearance: Appearance): void {
  nativeTheme.themeSource = appearance
}

export const NEUTRAL_WINDOW_BACKGROUNDS = { light: '#ffffff', dark: '#1c1917' } as const

export function neutralWindowBackground(appearance: Appearance, systemDark = nativeTheme.shouldUseDarkColors): string {
  return appearance === 'dark' || (appearance === 'system' && systemDark) ? NEUTRAL_WINDOW_BACKGROUNDS.dark : NEUTRAL_WINDOW_BACKGROUNDS.light
}

export function applyWindowAppearance(theme: NativeTheme, window: BrowserWindow, appearance: Appearance): void {
  applyAppearance(theme, appearance)
  if (!window.isDestroyed()) window.setBackgroundColor(neutralWindowBackground(appearance, theme.shouldUseDarkColors))
}

export interface ProductAppearanceOptions {
  /** Suite windows use per-window document themes; standalone hosts may own nativeTheme. */
  readonly applyNativeTheme?: boolean
}

export async function registerProductAppearance(product: ProductId, window: BrowserWindow, legacy?: Appearance, options: ProductAppearanceOptions = {}): Promise<() => void> {
  const registry = new AppearanceRegistry(); await registry.load(legacy ? { [product]: legacy } : {})
  const applyNativeTheme = options.applyNativeTheme ?? true
  const getChannel = `desktop-shell:${product}:appearance:get`, setChannel = `desktop-shell:${product}:appearance:set`, changedChannel = `desktop-shell:${product}:appearance:changed`
  const authorize = (event: { sender: unknown }) => {
    if (event.sender !== window.webContents || window.webContents.isDestroyed()) throw new Error('Unauthorized appearance IPC sender')
  }
  const apply = (snapshot = registry.get()) => {
    const value = snapshot.values[product]
    if (applyNativeTheme) applyWindowAppearance(nativeTheme, window, value)
    else if (!window.isDestroyed()) window.setBackgroundColor(neutralWindowBackground(value, nativeTheme.shouldUseDarkColors))
    sendToRenderer(window.webContents, changedChannel, value)
  }
  const updateSystemBackground = () => { const value = registry.get().values[product]; if (value === 'system' && !window.isDestroyed()) window.setBackgroundColor(neutralWindowBackground(value, nativeTheme.shouldUseDarkColors)) }
  apply()
  nativeTheme.on('updated', updateSystemBackground)
  let getRegistered = false
  let setRegistered = false
  try {
    ipcMain.handle(getChannel, (event) => { authorize(event); return registry.get().values[product] })
    getRegistered = true
    ipcMain.handle(setChannel, async (event, value: unknown) => { authorize(event); if (!isAppearance(value)) throw new TypeError('Invalid appearance'); const result = await registry.set(product, value); return result.values[product] })
    setRegistered = true
  } catch (error) {
    if (getRegistered) ipcMain.removeHandler(getChannel)
    if (setRegistered) ipcMain.removeHandler(setChannel)
    registry.close()
    nativeTheme.removeListener('updated', updateSystemBackground)
    throw error
  }
  const unsubscribe = registry.subscribe(apply)
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    unsubscribe(); registry.close(); nativeTheme.removeListener('updated', updateSystemBackground); ipcMain.removeHandler(getChannel); ipcMain.removeHandler(setChannel)
  }
}

export function desktopWindowChromeOptions(platform = process.platform): BrowserWindowConstructorOptions {
  return platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 11 } } : {}
}

export async function runLoginItemControl(appId: string, argv = process.argv): Promise<boolean> {
  const argument = argv.find((value) => value.startsWith('--moirasia-control='))
  const switchValue = app.commandLine.getSwitchValue('moirasia-control')
  if (!argument && !switchValue) return false
  const command = switchValue || argument!.slice('--moirasia-control='.length)
  const isolated = join(tmpdir(), `moirasia-control-${appId}-${process.pid}`)
  app.setPath('userData', isolated)
  let result: LoginItemControlResult
  try {
    await app.whenReady()
    if (command === 'login-item:set:on') app.setLoginItemSettings({ openAtLogin: true })
    else if (command === 'login-item:set:off') app.setLoginItemSettings({ openAtLogin: false })
    else if (command !== 'login-item:get') throw new Error('Unsupported control command')
    const settings = app.getLoginItemSettings()
    const status = process.platform !== 'darwin' ? 'unavailable' : settings.status === 'requires-approval' ? 'requires-approval' : settings.openAtLogin ? 'enabled' : command === 'login-item:set:on' ? 'requires-approval' : 'disabled'
    result = { protocolVersion: 1, appId, openAtLogin: settings.openAtLogin, status }
  } catch (error) {
    result = { protocolVersion: 1, appId, openAtLogin: false, status: process.platform === 'darwin' ? 'error' : 'unavailable', error: error instanceof Error ? error.message : String(error) }
  }
  writeSync(1, `${JSON.stringify(result)}\n`)
  await rm(isolated, { recursive: true, force: true }).catch(() => undefined)
  app.exit(result.status === 'error' ? 1 : 0)
  return true
}

async function readSnapshot(path: string): Promise<AppearanceSnapshot | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<AppearanceSnapshot>
    if (value.version !== 1 || !Number.isSafeInteger(value.revision) || !value.values) return undefined
    const values = value.values as Partial<Record<ProductId, Appearance>>
    const requiredLegacyProducts = ['moirasia', 'amove', 'vox', 'exithibition'] as const
    if (!requiredLegacyProducts.every((id) => isAppearance(values[id]))) return undefined
    return { version: 1, revision: value.revision!, values: { ...DEFAULTS, ...Object.fromEntries(PRODUCT_IDS.filter((id) => isAppearance(values[id])).map((id) => [id, values[id]])) } }
  } catch { return undefined }
}

function validLegacy(values: Partial<Record<ProductId, Appearance>>): Partial<Record<ProductId, Appearance>> {
  return Object.fromEntries(Object.entries(values).filter(([id, value]) => isProductId(id) && isAppearance(value)))
}

async function withFileLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 2_000
  for (;;) {
    try {
      const handle = await open(path, 'wx', 0o600)
      try { await handle.writeFile(`${process.pid}\n${Date.now()}\n`); return await operation() }
      finally { await handle.close(); await rm(path, { force: true }) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const age = await stat(path).then((value) => Date.now() - value.mtimeMs).catch(() => 0)
      if (age > 5_000) { await rm(path, { force: true }); continue }
      if (Date.now() >= deadline) throw new Error('Timed out waiting for appearance settings lock')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
}

interface RendererSender {
  send(channel: string, ...args: unknown[]): boolean
}

interface LifecycleTarget {
  readonly on?: (event: string, listener: (...args: any[]) => void) => unknown
  readonly removeListener?: (event: string, listener: (...args: any[]) => void) => unknown
  readonly isDestroyed?: () => boolean
  readonly isLoading?: () => boolean
  readonly getURL?: () => string
  readonly send: (channel: string, ...args: unknown[]) => void
}

const rendererSenders = new WeakMap<WebContents, RendererSender>()

/**
 * Best-effort delivery for main-process renderer notifications.
 *
 * A WebContents can outlive its WebFrameMain while a navigation, reload, or
 * renderer teardown is in progress. Electron logs before throwing if send()
 * is called in that interval, so checking isDestroyed() alone is insufficient.
 * This gate suppresses sends during the lifecycle events that make the frame
 * unavailable and retains a final catch for the unavoidable check/send race.
 */
export function sendToRenderer(target: WebContents, channel: string, ...args: unknown[]): boolean {
  let sender = rendererSenders.get(target)
  if (!sender) {
    sender = createRendererSender(target)
    rendererSenders.set(target, sender)
  }
  return sender.send(channel, ...args)
}

function createRendererSender(target: WebContents): RendererSender {
  const contents = target as unknown as LifecycleTarget
  let ready = initiallyReady(contents)
  let disposed = false
  const listeners: Array<[string, (...args: any[]) => void]> = []

  const addListener = (event: string, listener: (...args: any[]) => void): void => {
    if (!contents.on) return
    contents.on(event, listener)
    listeners.push([event, listener])
  }
  const removeListeners = (): void => {
    if (!contents.removeListener) return
    for (const [event, listener] of listeners) contents.removeListener(event, listener)
    listeners.length = 0
  }
  const markNotReady = (): void => { ready = false }
  const markReady = (): void => { if (!contents.isDestroyed?.()) ready = true }
  const markMainFrameNotReady = (...eventArgs: any[]): void => {
    if (eventArgs.length < 4 || eventArgs[3] === true) ready = false
  }
  const markMainFrameLoadFailed = (...eventArgs: any[]): void => {
    if (eventArgs.length < 5 || eventArgs[4] === true) ready = false
  }
  const onDestroyed = (): void => {
    disposed = true
    ready = false
    removeListeners()
    rendererSenders.delete(target)
  }

  addListener('did-start-loading', markNotReady)
  addListener('did-start-navigation', markMainFrameNotReady)
  addListener('did-fail-load', markMainFrameLoadFailed)
  addListener('render-process-gone', markNotReady)
  addListener('did-finish-load', markReady)
  addListener('destroyed', onDestroyed)

  return {
    send(channel, ...args): boolean {
      if (disposed || !ready || contents.isDestroyed?.() || contents.isLoading?.()) return false
      try {
        contents.send(channel, ...args)
        return true
      } catch {
        return false
      }
    }
  }
}

function initiallyReady(target: LifecycleTarget): boolean {
  if (target.isDestroyed?.()) return false
  // Minimal test doubles and legacy hosts may not expose the lifecycle API;
  // keep their previous send behavior and let the catch handle a fake race.
  if (!target.isLoading || !target.getURL) return true
  try {
    const url = target.getURL()
    return !target.isLoading() && url !== '' && url !== 'about:blank'
  } catch { return false }
}

export { APPEARANCES, PRODUCT_IDS }
export type { Appearance, AppearanceSnapshot, LoginItemControlResult, ProductId }
