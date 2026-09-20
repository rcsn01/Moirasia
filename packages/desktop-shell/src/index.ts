import { FEATURE_IDS } from './feature-catalog'

export { applicationCatalog, APPLICATION_IDS, isApplicationId } from './application-catalog'
export type { ApplicationId, ApplicationCatalog, ApplicationCatalogEntry } from './application-catalog'

// Visual product identities include standalone-only apps. Application and
// feature catalogs separately define what Moirasia controls and embeds.
export const PRODUCT_IDS = ['moirasia', ...FEATURE_IDS, 'vox', 'exithibition', 'orbis', 'yn360'] as const
export type ProductId = (typeof PRODUCT_IDS)[number]
export const APPEARANCES = ['system', 'light', 'dark'] as const
export type Appearance = (typeof APPEARANCES)[number]

export interface AppearanceSnapshot {
  readonly version: 1
  readonly revision: number
  readonly values: Readonly<Record<ProductId, Appearance>>
}

/** The suite-wide appearance seed table: one owner of every product's default appearance. Pure data, renderer-safe. */
export const DEFAULT_PRODUCT_APPEARANCES: Record<ProductId, Appearance> = { moirasia: 'system', amove: 'system', vox: 'system', exithibition: 'dark', bonded: 'system', shout: 'system', orbis: 'system', yn360: 'system' }

export function defaultAppearanceSnapshot(): AppearanceSnapshot { return { version: 1, revision: 0, values: { ...DEFAULT_PRODUCT_APPEARANCES } } }

export interface LoginItemControlResult {
  readonly protocolVersion: 1
  readonly appId: string
  readonly openAtLogin: boolean
  readonly status: 'enabled' | 'disabled' | 'requires-approval' | 'unavailable' | 'error'
  readonly error?: string
}

export interface AppearanceApi {
  getAppearance(): Promise<Appearance>
  setAppearance(appearance: Appearance): Promise<Appearance>
  onAppearance(listener: (appearance: Appearance) => void): () => void
}

export function isAppearance(value: unknown): value is Appearance {
  return typeof value === 'string' && APPEARANCES.some((item) => item === value)
}

export function isProductId(value: unknown): value is ProductId {
  return typeof value === 'string' && PRODUCT_IDS.some((item) => item === value)
}
