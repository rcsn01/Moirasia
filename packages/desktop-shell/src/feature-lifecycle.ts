import type { FeatureContext, FeatureHostMode, FeatureId, MoirasiaFeature } from './feature'
import { acquireFeatureSurface, type FeatureSurfaceHandle } from './feature-surface-host'

export type FeatureCleanup = () => void | Promise<void>

export interface FeatureMountContext {
  readonly context: FeatureContext
  readonly surface: FeatureSurfaceHandle
  own(cleanup: FeatureCleanup): void
}

export interface FeatureLifecycleOptions {
  readonly id: FeatureId
  readonly modes: readonly FeatureHostMode[]
  mount(input: FeatureMountContext): void | Promise<void>
}

/**
 * The one owner of the shared outer feature lifecycle: validated contexts,
 * single-flight registration, surface acquisition and readiness, reverse-order
 * rollback, registration-only activation, and exhaustive idempotent disposal.
 * Cross-operation scheduling stays with FeatureRuntime and runStandaloneLaunch.
 */
export function createFeatureLifecycle(options: FeatureLifecycleOptions): MoirasiaFeature {
  let registration: Promise<void> | undefined
  let activeSurface: FeatureSurfaceHandle | undefined
  const committed: FeatureCleanup[] = []

  const runCleanups = async (entries: FeatureCleanup[]): Promise<unknown> => {
    let firstError: unknown
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      try {
        await entries[index]!()
      } catch (error) {
        firstError ??= error
      }
    }
    return firstError
  }

  return {
    id: options.id,
    register(context): Promise<void> {
      try {
        validateContext(options, context)
      } catch (error) {
        return Promise.reject(error)
      }
      if (activeSurface) return Promise.resolve()
      if (registration) return registration

      const cleanups: FeatureCleanup[] = []
      let scopeOpen = true
      const own = (entry: FeatureCleanup): void => {
        if (typeof entry !== 'function') throw new TypeError('Feature cleanup must be a function')
        if (!scopeOpen) throw new TypeError(`Feature '${options.id}' cleanup cannot be registered after mount settles`)
        cleanups.push(entry)
      }

      const work: Promise<void> = (async (): Promise<void> => {
        try {
          const surface = await acquireFeatureSurface(context)
          own(() => surface.dispose())
          await options.mount({ context, surface, own })
          scopeOpen = false
          await surface.ready()
          committed.push(...cleanups.splice(0))
          activeSurface = surface
        } catch (error) {
          scopeOpen = false
          await runCleanups(cleanups.splice(0))
          throw error
        } finally {
          registration = undefined
        }
      })()
      registration = work
      return work
    },
    dispose(): Promise<void> {
      if (!activeSurface) return Promise.resolve()
      activeSurface = undefined
      const stack = committed.splice(0)
      return (async () => {
        const firstError = await runCleanups(stack)
        if (firstError !== undefined) throw firstError
      })()
    },
    activate(): void { activeSurface?.activate() }
  }
}

function validateContext(options: FeatureLifecycleOptions, context: FeatureContext): void {
  if (context.id !== options.id || context.productId !== options.id || !options.modes.includes(context.mode)) {
    throw new Error(`Feature '${options.id}' requires one of these host modes: ${options.modes.join(', ')}`)
  }
}
