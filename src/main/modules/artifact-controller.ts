import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { BrowserWindow, WebContentsView, globalShortcut } from 'electron'
import {
  ResourceLedger,
  acquireDirectoryLock,
  type CloseDecision,
  type MoirasiaModule,
  type ModuleFactory,
  type ModuleHostServices,
  type ModuleSurface
} from '@moirasia/module-sdk'
import type { ModuleController, ModuleStopWarning, ModuleView } from './types'
import type { DiscoveryStatus } from './discovery'
import { ShortcutRegistry } from './shortcut-registry'
import { NativeViewSurface, type NativeViewModuleSurface } from './native-view-bridge'

export interface ArtifactControllerOptions {
  readonly artifact: Extract<DiscoveryStatus, { state: 'available' }>
  readonly dataDirectory: string
  readonly cacheDirectory: string
  readonly shortcuts: ShortcutRegistry
  readonly stopModuleDev?: () => void
  readonly setLaunchAtLogin?: (enabled: boolean) => Promise<void>
  readonly cleanupTimeoutMs?: number
}

export class ArtifactController implements ModuleController {
  readonly id
  readonly #ledger = new ResourceLedger()
  readonly #abort = new AbortController()
  readonly #cleanupTimeoutMs: number
  #module: MoirasiaModule | undefined
  #surface: ModuleSurface | undefined
  #stopping: Promise<void> | undefined

  constructor(private readonly options: ArtifactControllerOptions) {
    this.id = options.artifact.manifest.id as ModuleController['id']
    this.#cleanupTimeoutMs = options.cleanupTimeoutMs ?? 4_000
  }

  async start(): Promise<ModuleView> {
    if (this.#surface) return this.#surface as ModuleView
    const lock = await acquireDirectoryLock(this.options.dataDirectory, {
      productId: this.id,
      mode: 'module',
      hostBundleId: 'com.moirasia.desktop'
    })
    this.#ledger.track(() => lock.release(), 'data directory lock')
    if (this.options.artifact.manifest.kind === 'native-view') {
      const entry = this.options.artifact.manifest.entrypoints.nativeBundle!
      const nativeSurface = new NativeViewSurface(resolve(this.options.artifact.moduleRoot, entry))
      this.#ledger.track(() => nativeSurface.dispose(), 'native view bridge')
      this.#surface = {
        id: this.id, kind: 'native-view', nativeView: nativeSurface, nativeSurface
      } as NativeViewModuleSurface
      return this.#surface as ModuleView
    }
    const entry = this.options.artifact.manifest.entrypoints.main
    if (!entry) throw new Error(`${this.id} has no JavaScript module entrypoint`)
    const exports = await import(/* @vite-ignore */ pathToFileURL(resolve(this.options.artifact.moduleRoot, entry)).href)
    const factory = (exports.createMoirasiaModule ?? exports.default) as ModuleFactory | undefined
    if (typeof factory !== 'function') throw new Error(`${this.id} entrypoint does not export createMoirasiaModule`)
    const module = await factory()
    if (module.manifest.id !== this.id) throw new Error(`${this.id} factory returned a different manifest`)
    this.#module = module
    this.#surface = await module.start(this.#context())
    if (this.#surface.id !== this.id) throw new Error(`${this.id} returned a surface for ${this.#surface.id}`)
    return this.#surface as ModuleView
  }

  async activate(): Promise<void> {
    if (this.#surface?.kind === 'native-view') (this.#surface as NativeViewModuleSurface).nativeSurface.focus()
    else await this.#module?.activate()
  }
  async deactivate(): Promise<void> { await this.#module?.deactivate() }

  async preStop(): Promise<ModuleStopWarning | null> {
    const decision: CloseDecision = await this.#module?.canClose() ?? { allow: true }
    if (decision.allow) return null
    return {
      moduleId: this.id,
      title: decision.title ?? `Close ${this.options.artifact.manifest.name}?`,
      detail: decision.detail ?? 'This module has work in progress.'
    }
  }

  stop(): Promise<void> {
    if (this.#stopping) return this.#stopping
    this.#stopping = this.#stop()
    return this.#stopping
  }

  async #stop(): Promise<void> {
    this.#abort.abort()
    const errors: unknown[] = []
    if (this.#module) {
      await withTimeout(this.#module.stop(), this.#cleanupTimeoutMs, `${this.id} cleanup timed out`).catch((error) => errors.push(error))
    }
    await this.#ledger.cleanup().catch((error) => errors.push(error))
    this.options.stopModuleDev?.()
    this.#module = undefined
    this.#surface = undefined
    if (errors.length) throw new AggregateError(errors, `${this.id} did not stop cleanly`)
  }

  #context(): ModuleHostServices {
    const root = this.options.artifact.moduleRoot
    return {
      mode: 'moirasia',
      moduleRoot: root,
      dataDirectory: this.options.dataDirectory,
      cacheDirectory: this.options.cacheDirectory,
      signal: this.#abort.signal,
      resources: this.#ledger,
      createWebSurface: async ({ renderer, preload }) => {
        const view = new WebContentsView({
          webPreferences: {
            ...(preload ? { preload: resolve(root, preload) } : {}),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            partition: `moirasia:${this.id}`,
            additionalArguments: [`--moirasia-module=${this.id}`, '--moirasia-host-mode=module']
          }
        })
        view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        this.#ledger.track(() => { if (!view.webContents.isDestroyed()) view.webContents.close() }, 'main view')
        await view.webContents.loadFile(resolve(root, renderer))
        return { id: this.id, kind: 'web', nativeView: view }
      },
      createUtilityWindow: async (options) => {
        const window = new BrowserWindow({ ...options, show: false } as Electron.BrowserWindowConstructorOptions)
        this.#ledger.track(() => { if (!window.isDestroyed()) window.destroy() }, 'utility window')
        return window
      },
      registerShortcut: (accelerator, handler) => {
        const dispose = this.options.shortcuts.register(this.id, accelerator, handler)
        const tracked = this.#ledger.track(dispose, `shortcut ${accelerator}`)
        return { accelerator, dispose: () => { void tracked.dispose() } }
      },
      setLaunchAtLogin: async (enabled) => { await this.options.setLaunchAtLogin?.(enabled) },
      resolvePayloadPath: (relativePath) => resolve(root, relativePath)
    }
  }
}

export function createShortcutRegistry(): ShortcutRegistry {
  return new ShortcutRegistry(globalShortcut)
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([operation, new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    timer.unref()
  })])
}
