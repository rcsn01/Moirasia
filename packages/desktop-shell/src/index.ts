export const PRODUCT_IDS = ['moirasia', 'amove', 'vox', 'exithibition'] as const
export type ProductId = (typeof PRODUCT_IDS)[number]
export const APPEARANCES = ['system', 'light', 'dark'] as const
export type Appearance = (typeof APPEARANCES)[number]

export interface AppearanceSnapshot {
  readonly version: 1
  readonly revision: number
  readonly values: Readonly<Record<ProductId, Appearance>>
}

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
