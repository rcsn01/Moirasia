import { BrowserWindow, type WebContents } from 'electron'
import type { Appearance, ProductId } from './index'
import { desktopWindowChromeOptions, neutralWindowBackground, registerProductAppearance } from './main'

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
  validateOptions(options)
  const window = new BrowserWindow({
    title: options.title,
    width: options.width,
    height: options.height,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    show: false,
    ...desktopWindowChromeOptions(),
    fullscreenable: options.fullscreenable ?? true,
    backgroundColor: neutralWindowBackground(options.defaultAppearance),
    ...(options.icon ? { icon: options.icon } : {}),
    webPreferences: {
      preload: options.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: options.spellcheck ?? false,
      ...(options.devTools !== undefined ? { devTools: options.devTools } : {})
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  installNavigationGuard(window, options.navigation ?? 'deny')

  let disposeAppearance: (() => void) | undefined
  let disposed = false
  let readyPromise: Promise<void> | undefined
  const markDisposed = (): void => {
    if (disposed) return
    disposed = true
    disposeAppearance?.()
    disposeAppearance = undefined
  }

  try {
    disposeAppearance = await registerProductAppearance(options.productId, window, options.defaultAppearance, {
      applyNativeTheme: true,
      registryPath: options.appearanceFile
    })
  } catch (error) {
    window.destroy()
    throw error
  }
  window.on('closed', markDisposed)

  const surface: StandaloneSurface = {
    get webContents(): WebContents { return window.webContents },
    get window(): BrowserWindow { return window },
    ready(): Promise<void> {
      if (disposed) return Promise.resolve()
      readyPromise ??= (async () => {
        try {
          await (isHttpUrl(options.renderer) ? window.loadURL(options.renderer) : window.loadFile(options.renderer))
          if (!disposed && !window.isDestroyed()) window.show()
        } catch (error) {
          surface.dispose()
          throw error
        }
      })()
      return readyPromise
    },
    activate(): void {
      if (disposed || window.isDestroyed()) return
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    },
    dispose(): void {
      markDisposed()
      if (!window.isDestroyed()) window.destroy()
    }
  }
  return surface
}

function validateOptions(options: StandaloneSurfaceOptions): void {
  for (const [name, size] of [['width', options.width], ['height', options.height], ['minWidth', options.minWidth], ['minHeight', options.minHeight]] as const) {
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`Standalone window ${name} must be a positive integer.`)
  }
  if (options.minWidth > options.width || options.minHeight > options.height) throw new Error('Standalone window minimum size exceeds its initial size.')
  if (!isAbsolutePath(options.preload)) throw new Error('Standalone window preload must be an absolute path.')
  if (!isAbsolutePath(options.renderer) && !isHttpUrl(options.renderer)) throw new Error('Standalone window renderer must be an absolute path or HTTP URL.')
  if (!isAbsolutePath(options.appearanceFile)) throw new Error('Standalone appearance file must be an absolute path.')
}

function installNavigationGuard(window: BrowserWindow, policy: 'deny' | 'allow-same-url'): void {
  window.webContents.on('will-navigate', (event, url) => {
    if (policy === 'deny' || url !== window.webContents.getURL()) event.preventDefault()
  })
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || value.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(value)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
