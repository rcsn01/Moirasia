import type { BrowserWindow, WebContents } from 'electron'
import { isFeatureId, type EmbeddedFeatureSurface, type EmbeddedFeatureSurfaceState, type FeatureId } from '@moirasia/desktop-shell/feature'

export type EmbeddedNavigationListener = (feature: FeatureId | undefined) => void

type SurfaceRecord = {
  state: EmbeddedFeatureSurfaceState
  listeners: Set<(state: EmbeddedFeatureSurfaceState) => void>
  surface: EmbeddedFeatureSurface
}

/**
 * Adapts the single Moirasia BrowserWindow to the surface contract consumed by
 * embedded features. Features can focus and address the shell webContents, but
 * never own or destroy the shell window.
 */
export class EmbeddedFeatureHost {
  readonly window: BrowserWindow
  readonly webContents: WebContents
  #active: FeatureId | undefined
  #focused: boolean
  #surfaces = new Map<FeatureId, SurfaceRecord>()
  #navigationListeners = new Set<EmbeddedNavigationListener>()
  #disposed = false

  readonly #onFocus = (): void => this.#setFocused(true)
  readonly #onBlur = (): void => this.#setFocused(false)
  readonly #onClosed = (): void => this.#setFocused(false)

  constructor(window: BrowserWindow) {
    this.window = window
    this.webContents = window.webContents
    this.#focused = !window.isDestroyed() && window.isFocused()
    window.on('focus', this.#onFocus)
    window.on('blur', this.#onBlur)
    window.on('closed', this.#onClosed)
  }

  get activeFeature(): FeatureId | undefined { return this.#active }
  get focused(): boolean { return this.#focused }

  surface(id: FeatureId): EmbeddedFeatureSurface {
    if (this.#disposed) throw new Error('Embedded feature host has been disposed')
    const existing = this.#surfaces.get(id)
    if (existing) return existing.surface
    let record: SurfaceRecord
    const thisHost = this
    const surface: EmbeddedFeatureSurface = {
      get webContents() { return thisHost.webContents },
      get state() { return { ...record.state } },
      activate: () => this.#activate(id),
      focus: () => this.#focus(),
      subscribe: (listener) => {
        record.listeners.add(listener)
        listener({ ...record.state })
        return () => record.listeners.delete(listener)
      }
    }
    // Keep the adapter stable per feature while its state remains host-owned.
    record = { state: { active: this.#active === id, focused: this.#focused }, listeners: new Set(), surface }
    this.#surfaces.set(id, record)
    return surface
  }

  subscribeNavigation(listener: EmbeddedNavigationListener): () => void {
    this.#navigationListeners.add(listener)
    return () => this.#navigationListeners.delete(listener)
  }

  setActive(id: FeatureId | undefined): void {
    if (this.#disposed || this.window.isDestroyed()) return
    if (id !== undefined && !isFeatureId(id)) throw new TypeError(`Invalid embedded feature '${String(id)}'`)
    if (this.#active === id) {
      this.#notify()
      return
    }
    this.#active = id
    this.#notify()
    for (const listener of this.#navigationListeners) listener(id)
  }

  activate(id: FeatureId): void {
    this.surface(id).activate()
  }

  focus(): void { this.#focus() }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.window.removeListener('focus', this.#onFocus)
    this.window.removeListener('blur', this.#onBlur)
    this.window.removeListener('closed', this.#onClosed)
    this.#navigationListeners.clear()
    for (const record of this.#surfaces.values()) record.listeners.clear()
    this.#surfaces.clear()
    this.#active = undefined
  }

  #activate(id: FeatureId): void {
    if (this.#disposed) return
    this.setActive(id)
    this.#focus(true)
  }

  #focus(show = false): void {
    if (this.#disposed || this.window.isDestroyed()) return
    if (show) this.window.show()
    this.window.focus()
    this.#setFocused(true)
  }

  #setFocused(focused: boolean): void {
    if (this.#disposed || this.#focused === focused) return
    this.#focused = focused
    this.#notify()
  }

  #notify(): void {
    for (const [id, record] of this.#surfaces) {
      const next = { active: this.#active === id, focused: this.#focused }
      if (record.state.active === next.active && record.state.focused === next.focused) continue
      record.state = next
      for (const listener of record.listeners) listener({ ...next })
    }
  }
}
