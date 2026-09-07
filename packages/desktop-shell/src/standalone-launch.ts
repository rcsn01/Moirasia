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
  /** Login-item control id when controlProtocol is 'moirasia'; otherwise names diagnostics. */
  readonly appId: string
  /** Disable the Moirasia command protocol for standalone-only applications. Defaults to 'moirasia'. */
  readonly controlProtocol?: 'moirasia' | 'none'
  /** app.setName — applied synchronously at module scope. */
  readonly productName: string
  /** app.setAppUserModelId — applied synchronously; Windows identity. */
  readonly appUserModelId?: string
  /**
   * The whenReady body: create windows, register IPC, and start helpers. It
   * runs after the userData override, so getPath('userData') sees the
   * overridden path. Product-specific setup also belongs here.
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
 * The standalone launch sequence, once: optional login-item control branch,
 * platform guard, userData override, single-instance lock, activation re-focus,
 * quit policy, ready-time registration (CSP, menu, register), and awaited teardown.
 *
 * Invariants:
 * - Call exactly once, at module scope, before `whenReady`.
 * - Identity (`setName`/`setAppUserModelId`) is applied synchronously — before
 *   any `await`.
 * - When enabled, the control check precedes the platform guard and the lock,
 *   so a command always answers even on an unsupported platform or while the
 *   real app holds the lock.
 * - `register` runs inside `whenReady`, after the `userData` override.
 * - No listeners are ever registered in control mode.
 * - `dispose` is awaited at most once and never races an in-flight `register`;
 *   a rejecting `dispose`/`onRegisterError` is logged and the quit still proceeds.
 * - The module owns every `app.quit()`/`app.exit(1)` decision; entries never
 *   call them.
 */
export async function runStandaloneLaunch(options: StandaloneLaunchOptions): Promise<StandaloneLaunchOutcome> {
  app.setName(options.productName)
  if (options.appUserModelId) app.setAppUserModelId(options.appUserModelId)
  try {
    if (options.controlProtocol !== 'none' && await runLoginItemControl(options.appId)) return 'controlled'
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
    let registration: Promise<void> | undefined
    let registrationSettled = false
    app.on('before-quit', (event) => {
      if (stopped) return
      event.preventDefault()
      if (quitting) return
      quitting = true
      const teardown = registrationSettled
        ? runHook(options.dispose)
        : (registration ?? Promise.resolve()).catch(() => undefined).then(() => runHook(options.dispose))
      void teardown.finally(() => { stopped = true; app.quit() })
    })
    try {
      await app.whenReady()
      if (options.contentSecurityPolicy) installContentSecurityPolicy(options.contentSecurityPolicy(process.env.ELECTRON_RENDERER_URL))
      if (options.menu) Menu.setApplicationMenu(Menu.buildFromTemplate(options.menu()))
      // Publish the promise before register starts so before-quit cannot run
      // disposal against a half-created feature.
      registration = Promise.resolve().then(() => options.register())
      try { await registration } finally { registrationSettled = true }
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