import type { Disposable, ResourceLedgerApi } from './types'

interface Entry {
  readonly label: string
  readonly disposable: Disposable
}

export class ResourceLedger implements ResourceLedgerApi {
  readonly #entries: Entry[] = []
  #cleaning: Promise<void> | undefined

  get size(): number {
    return this.#entries.length
  }

  track(disposable: Disposable | (() => void | Promise<void>), label = 'resource'): Disposable {
    const normalized = typeof disposable === 'function' ? { dispose: disposable } : disposable
    let active = true
    const tracked: Disposable = {
      dispose: async () => {
        if (!active) return
        active = false
        const index = this.#entries.findIndex((entry) => entry.disposable === tracked)
        if (index >= 0) this.#entries.splice(index, 1)
        await normalized.dispose()
      }
    }
    this.#entries.push({ label, disposable: tracked })
    return tracked
  }

  cleanup(): Promise<void> {
    if (this.#cleaning !== undefined) return this.#cleaning
    this.#cleaning = this.#cleanup().finally(() => {
      this.#cleaning = undefined
    })
    return this.#cleaning
  }

  async #cleanup(): Promise<void> {
    const errors: Error[] = []
    while (this.#entries.length > 0) {
      const entry = this.#entries.pop()!
      try {
        await entry.disposable.dispose()
      } catch (error) {
        errors.push(new Error(`Could not clean up ${entry.label}`, { cause: error }))
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Module resource cleanup failed')
  }
}
