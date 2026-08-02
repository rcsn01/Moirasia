export const MOIRASIA_HOST_API_VERSION = '0.1.0' as const
export const MODULE_MANIFEST_VERSION = 1 as const

export type ModuleKind = 'web' | 'native-view'
export type ModuleCapability =
  | 'accessibility'
  | 'dialogs'
  | 'external-links'
  | 'global-shortcuts'
  | 'keychain'
  | 'microphone'
  | 'notifications'
  | 'utility-windows'

export interface ModuleManifestV1 {
  readonly manifestVersion: 1
  readonly id: string
  readonly name: string
  readonly version: string
  readonly application: {
    readonly bundleId: string
  }
  readonly hostApi: {
    readonly min: string
    readonly maxExclusive: string
  }
  readonly kind: ModuleKind
  readonly entrypoints: {
    readonly main?: string
    readonly preload?: string
    readonly renderer?: string
    readonly nativeBundle?: string
  }
  readonly capabilities: readonly ModuleCapability[]
  readonly data: {
    readonly owner: string
    readonly supportDirectory: string
    readonly lockName: string
  }
  readonly payload: {
    readonly sha256: string
  }
}

export interface ModuleSurface {
  readonly id: string
  readonly kind: ModuleKind
  readonly nativeView: unknown
}

export interface CloseDecision {
  readonly allow: boolean
  readonly title?: string
  readonly detail?: string
}

export interface Disposable {
  dispose(): void | Promise<void>
}

export interface ResourceLedgerApi {
  track(disposable: Disposable | (() => void | Promise<void>), label?: string): Disposable
  cleanup(): Promise<void>
  readonly size: number
}

export interface ShortcutRegistration {
  readonly accelerator: string
  readonly dispose: () => void
}

export interface ModuleHostServices {
  readonly mode: 'moirasia'
  readonly moduleRoot: string
  readonly dataDirectory: string
  readonly cacheDirectory: string
  readonly signal: AbortSignal
  readonly resources: ResourceLedgerApi
  createWebSurface(options: { renderer: string; preload?: string }): Promise<ModuleSurface>
  createUtilityWindow(options: Record<string, unknown>): Promise<unknown>
  registerShortcut(accelerator: string, handler: () => void): ShortcutRegistration
  setLaunchAtLogin(enabled: boolean): Promise<void>
  resolvePayloadPath(relativePath: string): string
}

export interface MoirasiaModule {
  readonly manifest: ModuleManifestV1
  start(context: ModuleHostServices): Promise<ModuleSurface>
  activate(): Promise<void>
  deactivate(): Promise<void>
  canClose(): Promise<CloseDecision>
  stop(): Promise<void>
}

export type ModuleFactory = () => MoirasiaModule | Promise<MoirasiaModule>
