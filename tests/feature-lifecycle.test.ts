import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { FeatureContext } from '../packages/desktop-shell/src/feature'
import type { FeatureSurfaceHandle } from '../packages/desktop-shell/src/feature-surface-host'

const surfaceHost = vi.hoisted(() => ({ acquire: vi.fn() }))
vi.mock('../packages/desktop-shell/src/feature-surface-host', () => ({ acquireFeatureSurface: surfaceHost.acquire }))

import { createFeatureLifecycle, type FeatureCleanup, type FeatureMountContext } from '../packages/desktop-shell/src/feature-lifecycle'

function context(overrides: Partial<FeatureContext> = {}): FeatureContext {
  return {
    id: 'bonded',
    productId: 'bonded',
    mode: 'suite',
    paths: {},
    surface: {
      renderer: { current: () => undefined, send: () => false, subscribe: () => () => undefined },
      state: { active: false, focused: false },
      activate: () => undefined,
      focus: () => undefined,
      subscribe: () => () => undefined
    },
    ...overrides
  } as FeatureContext
}

type SurfaceMock = FeatureSurfaceHandle & {
  ready: Mock
  activate: Mock
  dispose: Mock
}

function fakeSurface(): SurfaceMock {
  return {
    mode: 'suite',
    renderer: { current: () => undefined, send: () => false, subscribe: () => () => undefined },
    window: undefined,
    ready: vi.fn(async () => undefined),
    activate: vi.fn(),
    dispose: vi.fn()
  }
}

function deferred(): { promise: Promise<void>; resolve(): void; reject(error: unknown): void } {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

function cleanup(label: string, calls: string[], error?: Error): FeatureCleanup {
  return () => { calls.push(label); if (error) throw error }
}

describe('embedded feature lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    surfaceHost.acquire.mockResolvedValue(fakeSurface())
  })

  it('validates identity and accepted modes before side effects', async () => {
    const mount = vi.fn()
    const feature = createFeatureLifecycle({ id: 'bonded', modes: ['suite'], mount })

    await expect(feature.register(context({ id: 'shout' } as never))).rejects.toThrow(/bonded.*suite/i)
    await expect(feature.register(context({ productId: 'shout' } as never))).rejects.toThrow(/bonded.*suite/i)
    await expect(feature.register(context({ mode: 'standalone' } as never))).rejects.toThrow(/bonded.*suite/i)

    expect(surfaceHost.acquire).not.toHaveBeenCalled()
    expect(mount).not.toHaveBeenCalled()
  })

  it('acquires, mounts, and readies one registration', async () => {
    const surface = fakeSurface()
    surfaceHost.acquire.mockResolvedValue(surface)
    const mount = vi.fn()
    const feature = createFeatureLifecycle({ id: 'bonded', modes: ['suite'], mount })
    const ctx = context()

    await feature.register(ctx)
    await feature.register(ctx)

    expect(surfaceHost.acquire).toHaveBeenCalledOnce()
    expect(surfaceHost.acquire).toHaveBeenCalledWith(ctx)
    expect(mount).toHaveBeenCalledOnce()
    expect(mount.mock.calls[0]?.[0]).toMatchObject({ context: ctx, surface })
    expect(surface.ready).toHaveBeenCalledOnce()
  })

  it('suppresses duplicate in-flight registration', async () => {
    const gate = deferred()
    const surface = fakeSurface()
    surfaceHost.acquire.mockResolvedValue(surface)
    const mount = vi.fn(() => gate.promise)
    const feature = createFeatureLifecycle({ id: 'bonded', modes: ['suite'], mount })
    const ctx = context()

    const first = feature.register(ctx)
    const second = feature.register(ctx)
    gate.resolve()
    await Promise.all([first, second])

    expect(surfaceHost.acquire).toHaveBeenCalledOnce()
    expect(mount).toHaveBeenCalledOnce()
  })

  it('activates only after readiness and stops when disposal begins', async () => {
    const gate = deferred()
    const surface = fakeSurface()
    surfaceHost.acquire.mockResolvedValue(surface)
    const feature = createFeatureLifecycle({ id: 'bonded', modes: ['suite'], mount: () => gate.promise })

    const registering = feature.register(context())
    feature.activate?.()
    expect(surface.activate).not.toHaveBeenCalled()

    gate.resolve()
    await registering
    feature.activate?.()
    expect(surface.activate).toHaveBeenCalledOnce()

    const disposal = feature.dispose()
    feature.activate?.()
    expect(surface.activate).toHaveBeenCalledOnce()
    await disposal
  })

  it('rolls back a mount failure in LIFO order and preserves the mount error', async () => {
    const surface = fakeSurface()
    surfaceHost.acquire.mockResolvedValue(surface)
    const mountFailure = new Error('mount failed')
    const cleanupFailure = new Error('cleanup failed')
    const calls: string[] = []
    const feature = createFeatureLifecycle({
      id: 'bonded',
      modes: ['suite'],
      mount: ({ own }) => {
        own(cleanup('c1', calls, cleanupFailure))
        own(cleanup('c2', calls))
        own(cleanup('c3', calls))
        throw mountFailure
      }
    })

    await expect(feature.register(context())).rejects.toBe(mountFailure)
    expect(calls).toEqual(['c3', 'c2', 'c1'])
    expect(surface.dispose).toHaveBeenCalledOnce()
  })

  it('rolls back a readiness failure', async () => {
    const surface = fakeSurface()
    surface.ready.mockRejectedValue(new Error('load failed'))
    surfaceHost.acquire.mockResolvedValue(surface)
    const calls: string[] = []
    const feature = createFeatureLifecycle({
      id: 'bonded',
      modes: ['suite'],
      mount: ({ own }) => {
        own(cleanup('c1', calls))
        own(cleanup('c2', calls))
      }
    })

    await expect(feature.register(context())).rejects.toThrow('load failed')
    expect(calls).toEqual(['c2', 'c1'])
    expect(surface.dispose).toHaveBeenCalledOnce()
  })

  it('attempts every disposal cleanup in reverse order and throws the first error', async () => {
    const surface = fakeSurface()
    surfaceHost.acquire.mockResolvedValue(surface)
    const firstFailure = new Error('c1 cleanup failed')
    const secondFailure = new Error('c2 cleanup failed')
    const calls: string[] = []
    const feature = createFeatureLifecycle({
      id: 'bonded',
      modes: ['suite'],
      mount: ({ own }) => {
        own(cleanup('c1', calls, firstFailure))
        own(async () => {
          calls.push('c2')
          await Promise.resolve()
          throw secondFailure
        })
        own(cleanup('c3', calls))
      }
    })
    await feature.register(context())

    await expect(feature.dispose()).rejects.toBe(secondFailure)
    expect(calls).toEqual(['c3', 'c2', 'c1'])
    expect(surface.dispose).toHaveBeenCalledOnce()
  })

  it('disposes idempotently, including after a failed disposal', async () => {
    const surface = fakeSurface()
    surfaceHost.acquire.mockResolvedValue(surface)
    const failure = new Error('cleanup failed')
    const calls: string[] = []
    const feature = createFeatureLifecycle({
      id: 'bonded',
      modes: ['suite'],
      mount: ({ own }) => {
        own(cleanup('c1', calls, failure))
      }
    })
    await feature.register(context())

    await expect(feature.dispose()).rejects.toBe(failure)
    expect(calls).toEqual(['c1'])

    await feature.dispose()
    expect(calls).toEqual(['c1'])
    expect(surface.dispose).toHaveBeenCalledOnce()
  })

  it('contains surface-acquisition failure and allows a retry', async () => {
    const failure = new Error('surface unavailable')
    surfaceHost.acquire.mockRejectedValueOnce(failure)
    const surface = fakeSurface()
    surfaceHost.acquire.mockResolvedValueOnce(surface)
    const mount = vi.fn()
    const feature = createFeatureLifecycle({ id: 'bonded', modes: ['suite'], mount })

    await expect(feature.register(context())).rejects.toBe(failure)
    expect(mount).not.toHaveBeenCalled()

    await expect(feature.register(context())).resolves.toBeUndefined()
    expect(surfaceHost.acquire).toHaveBeenCalledTimes(2)
    expect(mount).toHaveBeenCalledOnce()
  })

  it('allows retry after a failed mount', async () => {
    const firstSurface = fakeSurface()
    const secondSurface = fakeSurface()
    surfaceHost.acquire.mockResolvedValueOnce(firstSurface).mockResolvedValueOnce(secondSurface)
    const mount = vi.fn().mockRejectedValueOnce(new Error('mount failed')).mockResolvedValue(undefined)
    const feature = createFeatureLifecycle({ id: 'bonded', modes: ['suite'], mount })

    await expect(feature.register(context())).rejects.toThrow('mount failed')
    expect(firstSurface.dispose).toHaveBeenCalledOnce()

    await expect(feature.register(context())).resolves.toBeUndefined()
    expect(surfaceHost.acquire).toHaveBeenCalledTimes(2)
    expect(secondSurface.ready).toHaveBeenCalledOnce()
  })

  it('allows registration after settled disposal with an independent cleanup scope', async () => {
    const firstSurface = fakeSurface()
    const secondSurface = fakeSurface()
    surfaceHost.acquire.mockResolvedValueOnce(firstSurface).mockResolvedValueOnce(secondSurface)
    const calls: string[] = []
    const feature = createFeatureLifecycle({
      id: 'bonded',
      modes: ['suite'],
      mount: ({ own }) => {
        own(cleanup('mount', calls))
      }
    })

    await feature.register(context())
    await feature.dispose()
    expect(firstSurface.dispose).toHaveBeenCalledOnce()
    expect(calls).toEqual(['mount'])

    await feature.register(context())
    expect(secondSurface.dispose).not.toHaveBeenCalled()
    calls.length = 0
    await feature.dispose()
    expect(calls).toEqual(['mount'])
    expect(secondSurface.dispose).toHaveBeenCalledOnce()
  })

  it('rejects invalid and late ownership', async () => {
    const surface = fakeSurface()
    surfaceHost.acquire.mockResolvedValue(surface)
    const invalidOwnFeature = createFeatureLifecycle({
      id: 'bonded',
      modes: ['suite'],
      mount: ({ own }) => {
        own('not-a-function' as never)
      }
    })

    await expect(invalidOwnFeature.register(context())).rejects.toThrow(TypeError)
    expect(surface.dispose).toHaveBeenCalledOnce()

    const secondSurface = fakeSurface()
    surfaceHost.acquire.mockResolvedValueOnce(secondSurface)
    const calls: string[] = []
    let retainedOwn: FeatureMountContext['own'] | undefined
    const lateFeature = createFeatureLifecycle({
      id: 'bonded',
      modes: ['suite'],
      mount: ({ own }) => {
        own(cleanup('c1', calls))
        retainedOwn = own
      }
    })
    await lateFeature.register(context())

    expect(() => retainedOwn!(cleanup('late', calls))).toThrow(TypeError)
    expect(calls).toEqual([])

    await expect(lateFeature.dispose()).resolves.toBeUndefined()
    expect(calls).toEqual(['c1'])
    expect(secondSurface.dispose).toHaveBeenCalledOnce()
  })
})