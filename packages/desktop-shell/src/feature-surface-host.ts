import type { BrowserWindow } from 'electron'
import { defaultProductAppearance } from './main'
import { acquireOwnedWindowSurface } from './owned-window-surface'
import { featureCatalog, validateFeatureResources, type FeatureContext, type FeatureHostMode, type RendererTarget } from './feature'

export interface FeatureSurfaceOptions {
  /** Standalone window icon (Amove's app icon; the tray/dock reuse the same path). */
  readonly icon?: string
  /** webPreferences.devTools override (Amove disables under CI). Default: Electron's true. */
  readonly devTools?: boolean
}

/**
 * The feature's primary surface, in either host mode. Suite: the shell surface
 * (this handle never creates, loads, shows, or destroys anything). Standalone:
 * a host-owned window — hidden until ready(), guarded, appearance-managed,
 * destroyed on dispose() (never close()).
 */
export interface FeatureSurfaceHandle {
  readonly mode: FeatureHostMode
  /** Stable renderer identity across suite window replacement. */
  readonly renderer: RendererTarget
  /** The standalone window when the host owns it; undefined in suite mode. Observe and act on it (dialogs, listeners); never create or destroy it. */
  readonly window: BrowserWindow | undefined
  /** Load the standalone renderer and show the window. No-op in suite mode. Awaits the load; rejects after cleaning up. */
  ready(): Promise<void>
  /** Suite: surface.activate() + focus(). Standalone: restore-if-minimized → show → focus. */
  activate(): void
  /** Standalone: dispose product appearance, then destroy the window. Idempotent; no-op in suite mode. */
  dispose(): void
}

/**
 * Validate the context against the catalog's per-mode requirements, then acquire
 * the feature's primary surface: the shell surface in suite mode, or a host-owned
 * standalone window whose facts come from the catalog entry and whose initial
 * background comes from the shared appearance defaults. The window is created
 * hidden and unloaded; wire controllers and IPC between acquire and ready().
 */
export async function acquireFeatureSurface(context: FeatureContext, options: FeatureSurfaceOptions = {}): Promise<FeatureSurfaceHandle> {
  validateFeatureResources(context)
  return context.mode === 'suite' ? suiteHandle(context) : standaloneHandle(context, options)
}

function suiteHandle(context: Extract<FeatureContext, { mode: 'suite' }>): FeatureSurfaceHandle {
  const surface = context.surface
  return {
    mode: 'suite',
    renderer: surface.renderer,
    window: undefined,
    async ready(): Promise<void> { /* The shell owns the surface's renderer. */ },
    activate(): void {
      surface.activate()
      surface.focus()
    },
    dispose(): void { /* The shell owns the surface's lifecycle. */ }
  }
}

async function standaloneHandle(context: Extract<FeatureContext, { mode: 'standalone' }>, options: FeatureSurfaceOptions): Promise<FeatureSurfaceHandle> {
  const entry = featureCatalog.get(context.id)
  const preload = context.paths.preloads?.main
  if (!preload) throw new Error(`Feature '${context.id}' is missing the standalone preload 'preloads.main'.`)
  const renderer = context.paths.renderers?.main
  if (!renderer) throw new Error(`Feature '${context.id}' is missing the standalone renderer 'renderers.main'.`)
  const facts = entry.standaloneWindow
  const surface = await acquireOwnedWindowSurface({
    productId: context.productId,
    title: entry.label,
    width: facts.width,
    height: facts.height,
    minWidth: facts.minWidth,
    minHeight: facts.minHeight,
    preload,
    renderer,
    appearance: { initial: defaultProductAppearance(context.productId), registry: 'shared' },
    ...(facts.fullscreenable !== undefined ? { fullscreenable: facts.fullscreenable } : {}),
    ...(facts.navigation !== undefined ? { navigation: facts.navigation } : {}),
    ...(options.icon ? { icon: options.icon } : {}),
    ...(options.devTools !== undefined ? { devTools: options.devTools } : {})
  })

  return {
    mode: 'standalone',
    renderer: surface.renderer,
    get window(): BrowserWindow { return surface.window },
    ready: () => surface.ready(),
    activate: () => surface.activate(),
    dispose: () => surface.dispose()
  }
}
