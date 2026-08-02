import type {
  ModuleSnapshot,
  ModuleState,
  ModuleStatus,
  ModuleId
} from '../../shared/contracts'
import type {
  ModuleController,
  ModuleDefinition,
  ModuleView,
  ModuleViewHost,
  ModuleStopWarning
} from './types'

interface Runtime {
  readonly definition: ModuleDefinition
  state: ModuleState
  controller: ModuleController | undefined
  view: ModuleView | undefined
  error: string | undefined
}

type SnapshotListener = (snapshot: ModuleSnapshot) => void

interface StartedRuntime {
  readonly runtime: Runtime
  readonly controller: ModuleController
  readonly view: ModuleView
}

export class ModuleManager {
  readonly #runtimes: Map<ModuleId, Runtime>
  readonly #host: ModuleViewHost
  readonly #listeners = new Set<SnapshotListener>()
  readonly #stopTimeoutMs: number
  #activeId: ModuleId | null = null
  #queue: Promise<void> = Promise.resolve()

  constructor(definitions: readonly ModuleDefinition[], host: ModuleViewHost, stopTimeoutMs = 5_000) {
    this.#host = host
    this.#stopTimeoutMs = stopTimeoutMs
    this.#runtimes = new Map(
      definitions.map((definition) => [
        definition.id,
        {
          definition,
          state: 'stopped' as const,
          controller: undefined,
          view: undefined,
          error: undefined
        }
      ])
    )
  }

  snapshot(): ModuleSnapshot {
    const modules: ModuleStatus[] = [...this.#runtimes.values()].map((runtime) => {
      const availability = runtime.definition.availability?.() ?? { available: true as const }
      return {
        id: runtime.definition.id,
        label: runtime.definition.label,
        state: runtime.state,
        active: runtime.definition.id === this.#activeId,
        available: availability.available,
        ...(!availability.available ? { unavailableReason: availability.reason } : {}),
        ...(runtime.error === undefined ? {} : { error: runtime.error })
      }
    })
    return { modules, activeModuleId: this.#activeId }
  }

  subscribe(listener: SnapshotListener): () => void {
    this.#listeners.add(listener)
    listener(this.snapshot())
    return () => this.#listeners.delete(listener)
  }

  start(id: ModuleId): Promise<ModuleSnapshot> {
    return this.#serialize(async () => {
      await this.#start(id)
      return this.snapshot()
    })
  }

  activate(id: ModuleId): Promise<ModuleSnapshot> {
    return this.#serialize(async () => {
      const target = await this.#start(id)
      if (this.#activeId === id) return this.snapshot()

      const previousId = this.#activeId
      const previous = previousId === null ? undefined : this.#runtime(previousId)
      if (previous?.view !== undefined) {
        await previous.controller?.deactivate()
        this.#host.detach(previous.view)
      }

      try {
        this.#host.attach(target.view)
        await target.controller.activate()
        this.#activeId = id
        this.#emit()
      } catch (error) {
        this.#host.detach(target.view)
        target.runtime.state = 'failed'
        target.runtime.error = errorMessage(error)
        if (previous?.view !== undefined && previous.controller !== undefined) {
          this.#host.attach(previous.view)
          await previous.controller.activate()
          this.#activeId = previousId
        }
        this.#emit()
        throw error
      }
      return this.snapshot()
    })
  }

  hideActive(): Promise<ModuleSnapshot> {
    return this.#serialize(async () => {
      await this.#hideActive()
      return this.snapshot()
    })
  }

  stop(id: ModuleId): Promise<ModuleSnapshot> {
    return this.#serialize(async () => {
      await this.#stop(id)
      return this.snapshot()
    })
  }

  async stopWarnings(ids?: readonly ModuleId[]): Promise<readonly ModuleStopWarning[]> {
    const selected = ids ?? [...this.#runtimes.keys()]
    const warnings: ModuleStopWarning[] = []
    for (const id of selected) {
      const runtime = this.#runtime(id)
      if (runtime.state !== 'running' || runtime.controller?.preStop === undefined) continue
      const warning = await runtime.controller.preStop()
      if (warning !== null) warnings.push(warning)
    }
    return warnings
  }

  stopAll(): Promise<ModuleSnapshot> {
    return this.#serialize(async () => {
      const errors: unknown[] = []
      await this.#hideActive().catch((error: unknown) => errors.push(error))
      for (const id of this.#runtimes.keys()) {
        await this.#stop(id).catch((error: unknown) => errors.push(error))
      }
      if (errors.length > 0) throw new AggregateError(errors, 'One or more modules failed to stop')
      return this.snapshot()
    })
  }

  async #start(id: ModuleId): Promise<StartedRuntime> {
    const runtime = this.#runtime(id)
    const availability = runtime.definition.availability?.()
    if (availability && !availability.available) {
      throw new Error(`${runtime.definition.label} unavailable: ${availability.reason}`)
    }
    if (runtime.state === 'running' && runtime.controller && runtime.view) {
      return { runtime, controller: runtime.controller, view: runtime.view }
    }
    if (runtime.state !== 'stopped' && runtime.state !== 'failed') {
      throw new Error(`Cannot start ${id} from ${runtime.state}`)
    }

    runtime.state = 'starting'
    runtime.error = undefined
    this.#emit()
    let controller: ModuleController | undefined
    try {
      controller = await runtime.definition.load()
      if (controller.id !== id) throw new Error(`Loader for ${id} returned ${controller.id}`)
      const view = await controller.start()
      runtime.controller = controller
      runtime.view = view
      runtime.state = 'running'
      this.#emit()
      return { runtime, controller, view }
    } catch (error) {
      try {
        await controller?.stop()
      } catch {
        // Preserve the lifecycle error; stopAll will still process every registered module.
      }
      runtime.state = 'failed'
      runtime.error = errorMessage(error)
      runtime.controller = undefined
      runtime.view = undefined
      this.#emit()
      throw error
    }
  }

  async #hideActive(): Promise<void> {
    if (this.#activeId === null) return
    const runtime = this.#runtime(this.#activeId)
    if (runtime.view !== undefined) this.#host.detach(runtime.view)
    try {
      await runtime.controller?.deactivate()
    } finally {
      this.#activeId = null
      this.#emit()
    }
  }

  async #stop(id: ModuleId): Promise<void> {
    const runtime = this.#runtime(id)
    if (runtime.state === 'stopped') return
    let deactivationError: unknown
    if (this.#activeId === id) {
      await this.#hideActive().catch((error: unknown) => {
        deactivationError = error
      })
    }
    if (runtime.state !== 'running' && runtime.state !== 'failed') {
      throw new Error(`Cannot stop ${id} from ${runtime.state}`)
    }

    runtime.state = 'stopping'
    runtime.error = undefined
    this.#emit()
    try {
      const stopping = runtime.controller?.stop() ?? Promise.resolve()
      await withTimeout(stopping, this.#stopTimeoutMs, `${runtime.definition.label} did not stop within ${this.#stopTimeoutMs}ms`)
      runtime.controller = undefined
      runtime.view = undefined
      runtime.state = 'stopped'
      this.#emit()
    } catch (error) {
      runtime.state = 'failed'
      runtime.error = errorMessage(error)
      this.#emit()
      throw error
    }
    if (deactivationError !== undefined) throw deactivationError
  }

  #runtime(id: ModuleId): Runtime {
    const runtime = this.#runtimes.get(id)
    if (runtime === undefined) throw new Error(`Unknown module: ${id}`)
    return runtime
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation)
    this.#queue = result.then(() => undefined, () => undefined)
    return result
  }

  #emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.#listeners) listener(snapshot)
  }
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    timer.unref()
  })
  return Promise.race([operation, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
