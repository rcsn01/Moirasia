import type { Appearance, AppearanceSnapshot, LoginItemControlResult } from '@moirasia/desktop-shell'

export const APPLICATION_IDS = ['amove', 'vox', 'exithibition'] as const
export type ApplicationId = (typeof APPLICATION_IDS)[number]
export type ControllerPage = 'apps' | 'settings'

export interface ApplicationStatus {
  readonly id: ApplicationId
  readonly label: string
  readonly bundleId: string
  readonly installed: boolean
  readonly running: boolean
  readonly path?: string
  readonly loginItem?: LoginItemControlResult
  readonly busy?: 'opening' | 'quitting' | 'login-item'
  readonly error?: string
}

export interface ControllerSnapshot {
  readonly applications: readonly ApplicationStatus[]
  readonly appearances: AppearanceSnapshot
}

export interface ShellSettings {
  readonly version: 2
  readonly launchAtLogin: boolean
  readonly pendingLoginItems: Readonly<Partial<Record<ApplicationId, true>>>
}

export interface ControllerApi {
  getSnapshot(): Promise<ControllerSnapshot>
  refresh(): Promise<ControllerSnapshot>
  getSettings(): Promise<ShellSettings>
  openApplication(id: ApplicationId): Promise<ControllerSnapshot>
  quitApplication(id: ApplicationId): Promise<ControllerSnapshot>
  setAppearance(product: ApplicationId | 'moirasia', appearance: Appearance): Promise<ControllerSnapshot>
  setAllAppearances(appearance: Appearance): Promise<ControllerSnapshot>
  setLaunchAtLogin(enabled: boolean): Promise<ShellSettings>
  setApplicationLoginItem(id: ApplicationId, enabled: boolean): Promise<ControllerSnapshot>
  openLoginItemsSettings(): Promise<void>
  onSnapshot(listener: (snapshot: ControllerSnapshot) => void): () => void
  onNavigate(listener: (page: ControllerPage) => void): () => void
}

export const IPC = {
  getSnapshot: 'controller:get-snapshot', refresh: 'controller:refresh', getSettings: 'controller:get-settings',
  openApplication: 'controller:open-application', quitApplication: 'controller:quit-application',
  setAppearance: 'controller:set-appearance', setAllAppearances: 'controller:set-all-appearances',
  setLaunchAtLogin: 'controller:set-launch-at-login', setApplicationLoginItem: 'controller:set-application-login-item',
  openLoginItemsSettings: 'controller:open-login-items-settings', snapshot: 'controller:snapshot', navigate: 'controller:navigate'
} as const

export function isApplicationId(value: unknown): value is ApplicationId { return typeof value === 'string' && APPLICATION_IDS.some((id) => id === value) }
export function isControllerPage(value: unknown): value is ControllerPage { return value === 'apps' || value === 'settings' }
