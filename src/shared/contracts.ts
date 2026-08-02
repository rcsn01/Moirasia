export const MODULE_IDS = ['amove', 'vox', 'exithibition'] as const
export type ModuleId = (typeof MODULE_IDS)[number]

export type ModuleState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'failed'

export interface ModuleStatus {
  readonly id: ModuleId
  readonly label: string
  readonly state: ModuleState
  readonly active: boolean
  readonly available: boolean
  readonly unavailableReason?: string
  readonly error?: string
}

export interface ModuleSnapshot {
  readonly modules: readonly ModuleStatus[]
  readonly activeModuleId: ModuleId | null
}

export type ShellPage = 'home' | 'settings'
export type ShellAppearance = 'system' | 'light' | 'dark'
export type ShellSelection = ShellPage | ModuleId

export interface ShellSettings {
  readonly version: 1
  readonly appearance: ShellAppearance
  readonly launchAtLogin: boolean
  readonly autoStart: Readonly<Record<ModuleId, boolean>>
  readonly restoreLastSelection: boolean
  readonly compactRail: boolean
  readonly priorSelection: ShellSelection
}

export type ShellSettingsPatch = Partial<Omit<ShellSettings, 'version' | 'autoStart'>> & {
  readonly autoStart?: Partial<Record<ModuleId, boolean>>
}

export const IPC = {
  getSnapshot: 'shell:get-snapshot',
  getSettings: 'shell:get-settings',
  updateSettings: 'shell:update-settings',
  startModule: 'shell:start-module',
  activateModule: 'shell:activate-module',
  stopModule: 'shell:stop-module',
  showPage: 'shell:show-page',
  setRailWidth: 'shell:set-rail-width',
  quit: 'shell:quit',
  snapshot: 'shell:snapshot',
  navigate: 'shell:navigate'
} as const

export interface ShellApi {
  getSnapshot(): Promise<ModuleSnapshot>
  getSettings(): Promise<ShellSettings>
  updateSettings(patch: ShellSettingsPatch): Promise<ShellSettings>
  startModule(id: ModuleId): Promise<ModuleSnapshot>
  activateModule(id: ModuleId): Promise<ModuleSnapshot>
  stopModule(id: ModuleId): Promise<ModuleSnapshot>
  showPage(page: ShellPage): Promise<ModuleSnapshot>
  setRailWidth(width: number): void
  quit(): void
  onSnapshot(listener: (snapshot: ModuleSnapshot) => void): () => void
  onNavigate(listener: (destination: ShellPage | ModuleId) => void): () => void
}

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === 'string' && MODULE_IDS.some((id) => id === value)
}

export function isShellPage(value: unknown): value is ShellPage {
  return value === 'home' || value === 'settings'
}

export function isRailWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 64 && value <= 320
}
