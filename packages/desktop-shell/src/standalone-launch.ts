import { app, Menu, session } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { runLoginItemControl } from './login-item-control'

/**
 * Terminal state of a launch attempt. The promise resolves when the attempt
 * settles; the process keeps running after 'started' until the app quits.
 * Production callers `void` it at module scope; tests `await` it for
 * determinism. Every state is side-effect-complete: the exit or quit is
 * already dispatched when the promise resolves.
 */
export type StandaloneLaunchOutcome =
  | 'controlled'               // the login-item control protocol claimed the process; it self-exits
  | 'unsupported-platform'     // platform/arch guard failed; app.exit(1) already dispatched
  | 'single-instance-refused'  // lock lost; app.quit() already dispatched
  | 'started'                  // register() resolved
  | 'start-failed'             // register() rejected; failure hook ran; app.quit() dispatched
  | 'launch-failed'            // the control/launch chain itself rejected; app.exit(1) dispatched

export interface StandaloneLaunchOptions {
  /** Login-item control id, also names diagnostics ('amove', 'orbis', 'yn360', …). */
  readonly appId: string
  /** app.setName — applied synchronously at module scope. */
  readonly productName: string
  /** app.setAppUserModelId — applied synchronously; Windows identity. */
  readonly appUserModelId?: string
  /**
   * The whenReady body: create windows, register IPC, start helpers. Build the
   * FeatureContext inside — it runs after the userData override, so
   * getPath('userData') sees the overridden path. Also the place for product
   * extras (about panel, …).
   */
  readonly register: () => Promise<void> | void
  /**
   * Teardown. May be called before register() settles (quit during startup);
   * features already tolerate that. Awaited exactly once, before the final
   * quit. A rejecting dispose is logged and the quit still proceeds.
   */
  readonly dispose: () => Promise<void> | void
  /** Re-focus hook, wired to both 'activate' and 'second-instance'. Optional. */
  readonly activate?: () => void
  /** Allowed platforms; omitted = no guard. Checked after the control check. */
  readonly platforms?: readonly NodeJS.Platform[]
  /** Allowed architectures; omitted = no guard. */
  readonly archs?: readonly NodeJS.Architecture[]
  /** Env var that overrides app.setPath('userData') before the lock (e.g. 'BONDED_USER_DATA'). */
  readonly userDataEnv?: string
  /** CSP policy for the default session; the module reads ELECTRON_RENDERER_URL and wires the header. */
  readonly contentSecurityPolicy?: (rendererUrl: string | undefined) => string
  /** Application menu template; the module builds and installs it inside whenReady. */
  readonly menu?: () => MenuItemConstructorOptions[]
  /** Quit when the last window closes. Default true; pass a predicate for presence-aware policy. */
  readonly quitOnLastWindow?: boolean | (() => boolean)
  /** Additive failure UX after a register() rejection (dialogs). The module always logs. */
  readonly onRegisterError?: (error: unknown) => void | Promise<void>
}

/**
 * The standalone launch sequence, once: login-item control branch, platform
 * guard, userData override, single-instance lock, activation re-focus, quit
 * policy, ready-time registration (CSP, menu, register), and awaited teardown.
 *
 * Invariants:
 * - Call exactly once, at module scope, before `whenReady`.
 * - Identity (`setName`/`setAppUserModelId`) is applied synchronously — before
 *   any `await`.
 * - The control check precedes the platform guard and the lock, so a control
 *   command always answers the protocol, even on an unsupported platform or
 *   while the real app holds the lock.
 * - `register` runs inside `whenReady`, after the `userData` override.
 * - No listeners are ever registered in control mode.
 * - `dispose` is awaited at most once; a rejecting `dispose`/`onRegisterError`
 *   is logged and the quit still proceeds.
 * - The module owns every `app.quit()`/`app.exit(1)` decision; entries never
 *   call them.
 */
export async function runStandaloneLaunch(options: StandaloneLaunchOptions): Promise<StandaloneLaunchOutcome> {
  app.setName(options.productName)
  if (options.appUserModelId) app.setAppUserModelId(options.appUserModelId)
  try {
    if (await runLoginItemControl(options.appId)) return 'controlled'
    if (options.platforms && !options.platforms.includes(process.platform)) { app.exit(1); return 'unsupported-platform' }
    if (options.archs && !options.archs.includes(process.arch)) { app.exit(1); return 'unsupported-platform' }
    const userDataOverride = options.userDataEnv ? process.env[options.userDataEnv] : undefined
    if (userDataOverride) app.setPath('userData', userDataOverride)
    if (!app.requestSingleInstanceLock()) { app.quit(); return 'single-instance-refused' }
    app.on('second-instance', () => options.activate?.())
    app.on('activate', () => options.activate?.())
    app.on('window-all-closed', () => { if (resolveQuitPolicy(options.quitOnLastWindow)) app.quit() })
    let quitting = false
    let stopped = false
    app.on('before-quit', (event) => {
      if (stopped) return
      event.preventDefault()
      if (quitting) return
      quitting = true
      void runHook(options.dispose).finally(() => { stopped = true; app.quit() })
    })
    try {
      await app.whenReady()
      if (options.contentSecurityPolicy) installContentSecurityPolicy(options.contentSecurityPolicy(process.env.ELECTRON_RENDERER_URL))
      if (options.menu) Menu.setApplicationMenu(Menu.buildFromTemplate(options.menu()))
      await options.register()
      return 'started'
    } catch (error) {
      console.error(error)
      await runHook(() => options.onRegisterError?.(error))
      app.quit()
      return 'start-failed'
    }
  } catch (error) {
    console.error(error)
    app.exit(1)
    return 'launch-failed'
  }
}

function installContentSecurityPolicy(policy: string): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } }))
}

function resolveQuitPolicy(policy: StandaloneLaunchOptions['quitOnLastWindow']): boolean {
  if (policy === undefined) return true
  return typeof policy === 'function' ? policy() : policy
}

/** Run a product hook, logging a rejection (or throw) so the launch sequence continues. */
async function runHook(hook: () => Promise<void> | void): Promise<void> {
  try { await hook() } catch (error) { console.error(error) }
}