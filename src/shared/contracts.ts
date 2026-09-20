import type { Appearance, AppearanceSnapshot, LoginItemControlResult } from '@moirasia/desktop-shell'
import { applicationCatalog, defaultAppearanceSnapshot, APPLICATION_IDS, isApplicationId, type ApplicationId } from '@moirasia/desktop-shell'
import { isFeatureId, type FeatureId } from '@moirasia/desktop-shell/feature'

export { APPLICATION_IDS, isApplicationId, type ApplicationId }
export type ControllerPage = 'general' | 'features' | FeatureId
export type AppPresenceMode = 'dock' | 'menu-bar'

export function isAppPresenceMode(value: unknown): value is AppPresenceMode { return value === 'dock' || value === 'menu-bar' }

export interface ApplicationStatus {
  readonly id: ApplicationId
  readonly label: string
  readonly bundleId: string
  readonly installed: boolean
  readonly running: boolean
  readonly path?: string
  readonly loginItem?: LoginItemControlResult
  readonly error?: string
}

export interface FeatureStatus {
  readonly id: FeatureId
  readonly installed: boolean
  /** Native runtime state. Legacy local runtimes expose the derived value. */
  readonly state?: 'stopped' | 'starting' | 'running' | 'error'
  /** Kept for standalone/development compatibility while the migration rolls out. */
  readonly loaded: boolean
  readonly restartPending: boolean
  readonly loadError?: string
}

export interface ControllerSnapshot {
  readonly applications: readonly ApplicationStatus[]
  readonly appearances: AppearanceSnapshot
  readonly features: readonly FeatureStatus[]
}

export interface ShellSettings {
  readonly version: 4
  readonly launchAtLogin: boolean
  readonly appPresence: AppPresenceMode
  readonly pendingLoginItems: Readonly<Partial<Record<ApplicationId, true>>>
  readonly features: Readonly<Partial<Record<ApplicationId, boolean>>>
}

export const DEFAULT_SHELL_SETTINGS: ShellSettings = { version: 4, launchAtLogin: false, appPresence: 'dock', pendingLoginItems: {}, features: {} }

/** The renderer's pre-first-snapshot state: catalog-seeded application rows under the default appearance snapshot. */
export function emptyControllerSnapshot(): ControllerSnapshot {
  return {
    applications: applicationCatalog.entries.map(({ id, label, bundleId }) => ({ id, label, bundleId, installed: false, running: false })),
    appearances: defaultAppearanceSnapshot(),
    features: []
  }
}

export interface ControllerApi {
  getSnapshot(): Promise<ControllerSnapshot>
  refresh(): Promise<ControllerSnapshot>
  getSettings(): Promise<ShellSettings>
  getPage(): Promise<ControllerPage>
  openApplication(id: ApplicationId): Promise<ControllerSnapshot>
  quitApplication(id: ApplicationId): Promise<ControllerSnapshot>
  setAppearance(product: ApplicationId | 'moirasia', appearance: Appearance): Promise<ControllerSnapshot>
  setAllAppearances(appearance: Appearance): Promise<ControllerSnapshot>
  setLaunchAtLogin(enabled: boolean): Promise<ShellSettings>
  setAppPresence(mode: AppPresenceMode): Promise<ShellSettings>
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
  getSnapshot: 'controller:get-snapshot', refresh: 'controller:refresh', getSettings: 'controller:get-settings', getPage: 'controller:get-page',
  openApplication: 'controller:open-application', quitApplication: 'controller:quit-application',
  installFeature: 'controller:install-feature', uninstallFeature: 'controller:uninstall-feature',
  openFeature: 'controller:open-feature', relaunch: 'controller:relaunch',
  setAppearance: 'controller:set-appearance', setAllAppearances: 'controller:set-all-appearances',
  setLaunchAtLogin: 'controller:set-launch-at-login', setAppPresence: 'controller:set-app-presence', setApplicationLoginItem: 'controller:set-application-login-item',
  openLoginItemsSettings: 'controller:open-login-items-settings', reportPage: 'controller:report-page', snapshot: 'controller:snapshot', navigate: 'controller:navigate'
} as const

export function isControllerPage(value: unknown): value is ControllerPage { return value === 'general' || value === 'features' || isFeatureId(value) }
