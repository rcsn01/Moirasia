import { BrowserWindow, type WebContents } from 'electron'
import type { Appearance, ProductId } from './index'
import { desktopWindowChromeOptions, neutralWindowBackground, registerProductAppearance } from './main'

export type OwnedWindowNavigation = 'deny' | 'allow-same-url'

export type OwnedWindowAppearance =
  | {
      readonly initial: Appearance
      readonly registry: 'shared'
    }
  | {
      readonly initial: Appearance
      readonly registry: {
        readonly path: string
      }
    }

export interface OwnedWindowSurfaceOptions {
  readonly productId: ProductId
  readonly title: string
  readonly width: number
  readonly height: number
  readonly minWidth: number
  readonly minHeight: number
  readonly preload: string
  readonly renderer: string
  readonly appearance: OwnedWindowAppearance
  readonly fullscreenable?: boolean
  readonly navigation?: OwnedWindowNavigation
  readonly icon?: string
  readonly devTools?: boolean
  readonly spellcheck?: boolean
}

export interface OwnedWindowSurface {
  readonly webContents: WebContents
  readonly window: BrowserWindow
  ready(): Promise<void>
  activate(): void
  dispose(): void
}

export async function acquireOwnedWindowSurface(options: OwnedWindowSurfaceOptions): Promise<OwnedWindowSurface> {
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
    backgroundColor: neutralWindowBackground(options.appearance.initial),
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

  let disposed = false
  let disposeAppearance: (() => void) | undefined
  let readyPromise: Promise<void> | undefined

  const markDisposed = (): void => {
    if (disposed) return
    disposed = true
    const cleanup = disposeAppearance
    disposeAppearance = undefined
    cleanup?.()
  }

  window.on('closed', markDisposed)

  try {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    installNavigationGuard(window, options.navigation ?? 'deny')
    const cleanup = options.appearance.registry === 'shared'
      ? await registerProductAppearance(options.productId, window, undefined, { applyNativeTheme: true })
      : await registerProductAppearance(options.productId, window, options.appearance.initial, {
          applyNativeTheme: true,
          registryPath: options.appearance.registry.path
        })
    if (disposed || window.isDestroyed()) cleanup()
    else disposeAppearance = cleanup
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    throw error
  }

  const surface: OwnedWindowSurface = {
    get webContents(): WebContents { return window.webContents },
    get window(): BrowserWindow { return window },
    ready(): Promise<void> {
      if (disposed || window.isDestroyed()) return Promise.resolve()
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

function validateOptions(options: OwnedWindowSurfaceOptions): void {
  for (const [name, size] of [['width', options.width], ['height', options.height], ['minWidth', options.minWidth], ['minHeight', options.minHeight]] as const) {
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`Standalone window ${name} must be a positive integer.`)
  }
  if (options.minWidth > options.width || options.minHeight > options.height) throw new Error('Standalone window minimum size exceeds its initial size.')
  if (!isAbsolutePath(options.preload)) throw new Error('Standalone window preload must be an absolute path.')
  if (!isAbsolutePath(options.renderer) && !isHttpUrl(options.renderer)) throw new Error('Standalone window renderer must be an absolute path or HTTP URL.')
  if (options.appearance.registry !== 'shared' && !isAbsolutePath(options.appearance.registry.path)) {
    throw new Error('Standalone appearance file must be an absolute path.')
  }
}

function installNavigationGuard(window: BrowserWindow, policy: OwnedWindowNavigation): void {
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
