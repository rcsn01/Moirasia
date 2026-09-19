import type { AppPresenceMode } from '../shared/contracts'

/** Coordinates the lifetime of the shell and the independently owned shelf. */
export class UiLifetime {
  #shellVisible = false
  #shelfVisible = false
  #exitRequested = false
  constructor(private readonly options: {
    mode(): AppPresenceMode
    canExitToNativeHost?(): boolean
    onFinalWindowGone(): void
  }) {}

  shellOpened(): void { this.#shellVisible = true; this.#exitRequested = false }
  shellClosed(): void { this.#shellVisible = false; this.#maybeExit() }
  shelfVisible(visible: boolean): void { this.#shelfVisible = visible; if (!visible) this.#maybeExit() }
  nativeHostAvailabilityChanged(): void { this.#maybeExit() }
  reset(): void { this.#shellVisible = false; this.#shelfVisible = false; this.#exitRequested = false }
  get hasWindow(): boolean { return this.#shellVisible || this.#shelfVisible }

  #maybeExit(): void {
    if (this.#exitRequested || this.options.mode() !== 'menu-bar' || this.#shellVisible || this.#shelfVisible) return
    if (!(this.options.canExitToNativeHost?.() ?? true)) return
    this.#exitRequested = true
    this.options.onFinalWindowGone()
  }
}
