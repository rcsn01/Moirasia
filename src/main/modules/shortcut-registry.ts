export class ShortcutConflictError extends Error {
  readonly code = 'MOIRASIA_SHORTCUT_CONFLICT'
  constructor(readonly accelerator: string, readonly owner: string) {
    super(`${accelerator} is already used by ${owner}. Change one module's shortcut in Settings.`)
    this.name = 'ShortcutConflictError'
  }
}

export interface GlobalShortcutBackend {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export class ShortcutRegistry {
  readonly #owners = new Map<string, string>()
  constructor(private readonly backend: GlobalShortcutBackend) {}

  register(owner: string, accelerator: string, callback: () => void): () => void {
    const existing = this.#owners.get(accelerator)
    if (existing !== undefined && existing !== owner) throw new ShortcutConflictError(accelerator, existing)
    if (!this.backend.register(accelerator, callback)) throw new Error(`macOS rejected shortcut ${accelerator}`)
    this.#owners.set(accelerator, owner)
    let registered = true
    return () => {
      if (!registered) return
      registered = false
      if (this.#owners.get(accelerator) === owner) {
        this.#owners.delete(accelerator)
        this.backend.unregister(accelerator)
      }
    }
  }
}
