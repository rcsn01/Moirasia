import { BrowserWindow, type WebContents } from 'electron'
import { defaultProductAppearance, desktopWindowChromeOptions, neutralWindowBackground, registerProductAppearance } from './main'
import { featureCatalog, validateFeatureResources, type FeatureContext, type FeatureHostMode } from './feature'

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
  /** The IPC target: the shell webContents in suite mode, the standalone window's otherwise. */
  readonly webContents: WebContents
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
    get webContents(): WebContents { return surface.webContents },
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
  const facts = entry.standaloneWindow
  const window = new BrowserWindow({
    title: entry.label,
    width: facts.width,
    height: facts.height,
    minWidth: facts.minWidth,
    minHeight: facts.minHeight,
    show: false,
    ...desktopWindowChromeOptions(),
    fullscreenable: facts.fullscreenable ?? true,
    backgroundColor: neutralWindowBackground(defaultProductAppearance(context.productId)),
    ...(options.icon ? { icon: options.icon } : {}),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      ...(options.devTools !== undefined ? { devTools: options.devTools } : {})
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  installNavigationGuard(window, facts.navigation ?? 'deny')

  let disposeAppearance: (() => void) | undefined
  let disposed = false
  let loaded = false
  const markDisposed = (): void => {
    if (disposed) return
    disposed = true
    disposeAppearance?.()
    disposeAppearance = undefined
  }
  try {
    disposeAppearance = await registerProductAppearance(context.productId, window, undefined, { applyNativeTheme: true })
  } catch (error) {
    window.destroy()
    throw error
  }
  window.on('closed', markDisposed)

  const handle: FeatureSurfaceHandle = {
    mode: 'standalone',
    get webContents(): WebContents { return window.webContents },
    get window(): BrowserWindow { return window },
    async ready(): Promise<void> {
      if (disposed || loaded) return
      const renderer = context.paths.renderers?.main
      if (!renderer) {
        handle.dispose()
        throw new Error(`Feature '${context.id}' is missing the standalone renderer 'renderers.main'.`)
      }
      try {
        await (isHttpUrl(renderer) ? window.loadURL(renderer) : window.loadFile(renderer))
      } catch (error) {
        handle.dispose()
        throw error
      }
      loaded = true
      if (!window.isDestroyed()) window.show()
    },
    activate(): void {
      if (window.isDestroyed()) return
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    },
    dispose(): void {
      markDisposed()
      if (!window.isDestroyed()) window.destroy()
    }
  }
  return handle
}

/** window-open is always denied; will-navigate follows the catalog's policy —
 *  'deny' prevents every navigation, 'allow-same-url' additionally permits
 *  reload/same-URL navigation. */
function installNavigationGuard(window: BrowserWindow, policy: 'deny' | 'allow-same-url'): void {
  window.webContents.on('will-navigate', (event, url) => {
    if (policy === 'deny' || url !== window.webContents.getURL()) event.preventDefault()
  })
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}