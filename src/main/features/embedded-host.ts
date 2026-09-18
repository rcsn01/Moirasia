import type { BrowserWindow, WebContents } from 'electron'
import { isFeatureId, type EmbeddedFeatureSurface, type EmbeddedFeatureSurfaceState, type FeatureId } from '@moirasia/desktop-shell/feature'
import { MutableRendererTarget } from '@moirasia/desktop-shell/renderer-target'

export type EmbeddedNavigationListener = (feature: FeatureId | undefined) => void

type SurfaceRecord = {
  state: EmbeddedFeatureSurfaceState
  listeners: Set<(state: EmbeddedFeatureSurfaceState) => void>
  surface: EmbeddedFeatureSurface
}

/** Keeps stable feature surfaces while the shell attaches replaceable windows. */
export class EmbeddedFeatureHost {
  readonly renderer = new MutableRendererTarget()
  #window: BrowserWindow | undefined
  #active: FeatureId | undefined
  #focused = false
  #surfaces = new Map<FeatureId, SurfaceRecord>()
  #navigationListeners = new Set<EmbeddedNavigationListener>()
  #disposed = false

  readonly #onFocus = (): void => this.#setFocused(true)
  readonly #onBlur = (): void => this.#setFocused(false)
  readonly #onClosed = (): void => { if (this.#window?.isDestroyed()) this.detach(this.#window) }

  constructor(window?: BrowserWindow) { if (window) this.attach(window) }

  get window(): BrowserWindow | undefined { return this.#window }
  get webContents(): WebContents | undefined { return this.renderer.current() }
  get activeFeature(): FeatureId | undefined { return this.#active }
  get focused(): boolean { return this.#focused }

  attach(window: BrowserWindow): void {
    if (this.#disposed) throw new Error('Embedded feature host has been disposed')
    if (this.#window === window) return
    if (this.#window) this.detach(this.#window)
    this.#window = window
    this.#focused = !window.isDestroyed() && window.isFocused()
    window.on('focus', this.#onFocus)
    window.on('blur', this.#onBlur)
    window.on('closed', this.#onClosed)
    this.renderer.attach(window.webContents)
    this.#notify()
  }

  detach(window: BrowserWindow): void {
    if (this.#window !== window) return
    window.removeListener('focus', this.#onFocus)
    window.removeListener('blur', this.#onBlur)
    window.removeListener('closed', this.#onClosed)
    this.#window = undefined
    this.#active = undefined
    this.#focused = false
    this.renderer.detach(window.webContents)
    this.#notify()
  }

  surface(id: FeatureId): EmbeddedFeatureSurface {
    if (this.#disposed) throw new Error('Embedded feature host has been disposed')
    const existing = this.#surfaces.get(id)
    if (existing) return existing.surface
    let record: SurfaceRecord
    const surface: EmbeddedFeatureSurface = {
      renderer: this.renderer,
      get state() { return { ...record.state } },
      activate: () => this.#activate(id),
      focus: () => this.#focus(),
      subscribe: (listener) => {
        record.listeners.add(listener)
        listener({ ...record.state })
        return () => record.listeners.delete(listener)
      }
    }
    record = { state: { active: false, focused: this.#focused }, listeners: new Set(), surface }
    this.#surfaces.set(id, record)
    return surface
  }

  subscribeNavigation(listener: EmbeddedNavigationListener): () => void {
    this.#navigationListeners.add(listener)
    return () => this.#navigationListeners.delete(listener)
  }

  setActive(id: FeatureId | undefined): void {
    if (this.#disposed) return
    if (id !== undefined && !isFeatureId(id)) throw new TypeError(`Invalid embedded feature '${String(id)}'`)
    if (!this.#window || this.#window.isDestroyed()) {
      if (id !== undefined) this.#navigate(id)
      return
    }
    if (this.#active === id) { this.#notify(); return }
    this.#active = id
    this.#notify()
  }

  activate(id: FeatureId): void { this.surface(id).activate() }
  focus(): void { this.#focus() }

  dispose(): void {
    if (this.#disposed) return
    if (this.#window) this.detach(this.#window)
    this.#disposed = true
    this.renderer.dispose()
    this.#navigationListeners.clear()
    for (const record of this.#surfaces.values()) record.listeners.clear()
    this.#surfaces.clear()
  }

  #activate(id: FeatureId): void {
    if (this.#disposed) return
    if (!this.#window || this.#window.isDestroyed()) { this.#navigate(id); return }
    this.setActive(id)
    this.#navigate(id)
    this.#focus(true)
  }

  #focus(show = false): void {
    const window = this.#window
    if (this.#disposed || !window || window.isDestroyed()) return
    if (show) window.show()
    window.focus()
    this.#setFocused(true)
  }

  #setFocused(focused: boolean): void {
    if (this.#disposed || this.#focused === focused) return
    this.#focused = focused
    this.#notify()
  }

  #navigate(id: FeatureId | undefined): void { for (const listener of this.#navigationListeners) listener(id) }

  #notify(): void {
    const attached = Boolean(this.#window && !this.#window.isDestroyed())
    for (const [id, record] of this.#surfaces) {
      const next = { active: attached && this.#active === id, focused: attached && this.#focused }
      if (record.state.active === next.active && record.state.focused === next.focused) continue
      record.state = next
      for (const listener of record.listeners) listener({ ...next })
    }
  }
}
