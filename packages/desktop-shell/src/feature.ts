import type { ProductId } from './index'

export const FEATURE_IDS = ['exithibition'] as const
export type FeatureId = (typeof FEATURE_IDS)[number]

export function isFeatureId(value: unknown): value is FeatureId {
  return typeof value === 'string' && FEATURE_IDS.some((id) => id === value)
}

export interface FeaturePaths {
  /** Absolute path to the feature's compiled preload (.cjs). */
  preload: string
  /** Dev-server URL for the feature's renderer page (dev mode only). */
  rendererUrl?: string
  /** Absolute path to the feature's renderer html (packaged mode). */
  rendererFile: string
  /** Absolute path to the feature's native helper executable. */
  nativeExecutable: string
}

export interface FeatureContext {
  id: FeatureId
  mode: 'suite' | 'standalone'
  productId: ProductId
  paths: FeaturePaths
}

export interface MoirasiaFeature {
  readonly id: string
  /** Bring the feature to life: create windows, register IPC, start native helpers. */
  register(ctx: FeatureContext): Promise<void> | void
  /** Full teardown: destroy windows, remove IPC handlers, stop native helpers. */
  dispose(): Promise<void> | void
  /** Show/focus the feature's primary window. */
  activate?(): void
}
