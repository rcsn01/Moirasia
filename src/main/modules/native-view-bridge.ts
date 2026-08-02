import { app } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { ModuleSurface } from '@moirasia/module-sdk'

interface NativeAddon {
  loadBundle(path: string): object
  attach(handle: object, nativeView: Buffer, x: number, y: number, width: number, height: number): void
  setBounds(handle: object, x: number, y: number, width: number, height: number): void
  detach(handle: object): void
  focus(handle: object): void
  dispose(handle: object): void
}

export interface NativeViewModuleSurface extends ModuleSurface {
  readonly kind: 'native-view'
  readonly nativeSurface: NativeViewSurface
}

export class NativeViewSurface {
  readonly #addon: NativeAddon
  readonly #handle: object
  #disposed = false
  constructor(bundlePath: string) {
    const require = createRequire(import.meta.url)
    const addonPath = app.isPackaged
      ? join(process.resourcesPath, 'native', 'native-view-bridge.node')
      : join(app.getAppPath(), 'native', 'staged', 'native-view-bridge.node')
    this.#addon = require(addonPath) as NativeAddon
    this.#handle = this.#addon.loadBundle(bundlePath)
  }
  attach(windowHandle: Buffer, bounds: Electron.Rectangle): void {
    this.#addon.attach(this.#handle, windowHandle, bounds.x, bounds.y, bounds.width, bounds.height)
  }
  setBounds(bounds: Electron.Rectangle): void {
    this.#addon.setBounds(this.#handle, bounds.x, bounds.y, bounds.width, bounds.height)
  }
  detach(): void { if (!this.#disposed) this.#addon.detach(this.#handle) }
  focus(): void { if (!this.#disposed) this.#addon.focus(this.#handle) }
  dispose(): void { if (!this.#disposed) { this.#disposed = true; this.#addon.dispose(this.#handle) } }
}

export function isNativeViewSurface(view: unknown): view is NativeViewModuleSurface {
  return typeof view === 'object' && view !== null && 'kind' in view && view.kind === 'native-view' && 'nativeSurface' in view
}
