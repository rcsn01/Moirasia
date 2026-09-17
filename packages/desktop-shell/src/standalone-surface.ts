import type { BrowserWindow, WebContents } from 'electron'
import type { Appearance, ProductId } from './index'
import { acquireOwnedWindowSurface } from './owned-window-surface'

export interface StandaloneSurfaceOptions {
  readonly productId: ProductId
  readonly title: string
  readonly width: number
  readonly height: number
  readonly minWidth: number
  readonly minHeight: number
  readonly preload: string
  readonly renderer: string
  readonly appearanceFile: string
  readonly defaultAppearance: Appearance
  readonly fullscreenable?: boolean
  readonly navigation?: 'deny' | 'allow-same-url'
  readonly icon?: string
  readonly devTools?: boolean
  readonly spellcheck?: boolean
}

export interface StandaloneSurface {
  readonly webContents: WebContents
  readonly window: BrowserWindow
  ready(): Promise<void>
  activate(): void
  dispose(): void
}

/**
 * Create an application-owned window, hidden and unloaded. Callers can wire
 * controllers and IPC against the returned webContents before ready() loads
 * and shows the renderer.
 */
export async function acquireStandaloneSurface(options: StandaloneSurfaceOptions): Promise<StandaloneSurface> {
  return acquireOwnedWindowSurface({
    productId: options.productId,
    title: options.title,
    width: options.width,
    height: options.height,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    preload: options.preload,
    renderer: options.renderer,
    appearance: { initial: options.defaultAppearance, registry: { path: options.appearanceFile } },
    ...(options.fullscreenable !== undefined ? { fullscreenable: options.fullscreenable } : {}),
    ...(options.navigation !== undefined ? { navigation: options.navigation } : {}),
    ...(options.icon ? { icon: options.icon } : {}),
    ...(options.devTools !== undefined ? { devTools: options.devTools } : {}),
    ...(options.spellcheck !== undefined ? { spellcheck: options.spellcheck } : {})
  })
}
