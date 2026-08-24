import type { Appearance, AppearanceSnapshot, LoginItemControlResult } from '@moirasia/desktop-shell'
import type { FeatureId } from '@moirasia/desktop-shell/feature'

export const APPLICATION_IDS = ['amove', 'vox', 'exithibition', 'bonded', 'orbis'] as const
export type ApplicationId = (typeof APPLICATION_IDS)[number]
export type ControllerPage = 'apps' | FeatureId | 'settings'

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

export interface FeatureStatus {
  readonly id: FeatureId
  readonly installed: boolean
  readonly loaded: boolean         // register() has run in this session
  readonly restartPending: boolean // was loaded, now uninstalled; relaunch fully unloads
}

export interface ControllerSnapshot {
  readonly applications: readonly ApplicationStatus[]
  readonly appearances: AppearanceSnapshot
  readonly features: readonly FeatureStatus[]
}

export interface ShellSettings {
  readonly version: 3
  readonly launchAtLogin: boolean
  readonly pendingLoginItems: Readonly<Partial<Record<ApplicationId, true>>>
  readonly features: Readonly<Partial<Record<ApplicationId, boolean>>>
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
  installFeature(id: ApplicationId): Promise<ControllerSnapshot>
  uninstallFeature(id: ApplicationId): Promise<ControllerSnapshot>
  openFeature(id: ApplicationId): Promise<void>
  reportPage(page: ControllerPage): Promise<void>
  relaunchApp(): Promise<void>
  openLoginItemsSettings(): Promise<void>
  onSnapshot(listener: (snapshot: ControllerSnapshot) => void): () => void
  onNavigate(listener: (page: ControllerPage) => void): () => void
}

export const IPC = {
  getSnapshot: 'controller:get-snapshot', refresh: 'controller:refresh', getSettings: 'controller:get-settings',
  openApplication: 'controller:open-application', quitApplication: 'controller:quit-application',
  installFeature: 'controller:install-feature', uninstallFeature: 'controller:uninstall-feature',
  openFeature: 'controller:open-feature', relaunch: 'controller:relaunch',
  setAppearance: 'controller:set-appearance', setAllAppearances: 'controller:set-all-appearances',
  setLaunchAtLogin: 'controller:set-launch-at-login', setApplicationLoginItem: 'controller:set-application-login-item',
  openLoginItemsSettings: 'controller:open-login-items-settings', reportPage: 'controller:report-page', snapshot: 'controller:snapshot', navigate: 'controller:navigate'
} as const

export function isApplicationId(value: unknown): value is ApplicationId { return typeof value === 'string' && APPLICATION_IDS.some((id) => id === value) }
export function isControllerPage(value: unknown): value is ControllerPage { return value === 'apps' || value === 'settings' || (typeof value === 'string' && ['amove', 'exithibition', 'orbis'].includes(value)) }
