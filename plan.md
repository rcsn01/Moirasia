# Plan: Deepen the standalone launcher — `runStandaloneLaunch`

**Status:** Approved for implementation · **Date:** 2026-09-07
**Source:** Architecture review candidate 1 (`Strong`). Vocabulary: `CONTEXT.md` (domain) and the codebase-design glossary (module, interface, implementation, seam, adapter, leverage, locality).

---

## 1. Problem and evidence

The standalone launch sequence — login-item control branch, single-instance lock, ready-time registration, activation re-focus, quit policy, awaited teardown — is hand-copied in **five** entry files. The module is shallow in five places at once: every caller must know the whole sequence (large interface) for ~0 leverage. Deletion test: delete a shared module and the sequence reappears in five callers — a shared module earns its keep.

| | Amove | Exithibition | Bonded | Orbis | YN360 |
|---|---|---|---|---|---|
| `setName` timing | module scope | **inside whenReady** (drift) | module scope | module scope | module scope |
| `setAppUserModelId` | yes | **missing** (drift) | yes | yes | yes |
| Platform guard | darwin/win32/linux | none | darwin+arm64 | none | darwin+arm64 |
| Guard vs control check | **guard first** | n/a | control first | n/a | control first |
| Single-instance lock | after control check | after | after | after | **before control check** (latent hang) |
| `userData` env override | — | — | `BONDED_USER_DATA` | `ORBIS_USER_DATA` | — |
| `before-quit` | preventDefault, **awaits dispose**, re-entry flags | **`void feature.dispose()` — fire-and-forget, teardown can be dropped on quit** (bug) | preventDefault, awaits, flags | preventDefault, awaits, flags | preventDefault, awaits, flags |
| `activate` listener | inside control branch | inside | inside | **module scope — fires even in `--moirasia-control` mode** (bug) | inside |
| Register failure | console.error + quit | console.error + quit | dialogs (lease error → info dialog) | console.error + quit | error dialog + quit |
| `window-all-closed` | platform + feature policy (only copy) | always quit | always quit | always quit | always quit |

Files:

```
apps/integrated/Amove/src/main/index.ts
apps/integrated/Exithibition/src/main/index.ts
apps/integrated/Bonded/src/main/index.ts
apps/integrated/Orbis/src/main/index.ts
apps/standalone/YN360/src/main/index.ts
packages/desktop-shell/src/main.ts        (hosts runLoginItemControl today)
```

The YN360 lock-ordering bug, verified in source: the lock is requested **before** `runLoginItemControl` re-points `userData` to its isolated per-pid directory. A `--moirasia-control` process launched while the real app runs is refused the lock on the default `userData` path and calls `app.quit()` **without answering the control protocol** — the caller hangs waiting for the JSON response. The comment justifying the order ("a second launch can never race the first through the login-item control") protects against a race that control-first ordering also prevents; control-first is strictly safer.

---

## 2. Decisions (design tree, recommended answers adopted)

### Round 1 — shape of the deep module

**Q1 Where does the module live?**
➡️ `packages/desktop-shell/src/standalone-launch.ts`, re-exported through the existing `'./main'` export. All five apps already depend on the package (`link:../../../packages/desktop-shell`, except YN360's `file:../../../packages/desktop-shell` — same local-workspace resolution); no dependency changes.

**Q2 What does it return?**
➡️ `Promise<StandaloneLaunchOutcome>` — resolves when the launch attempt settles (`'started'`, `'start-failed'`, or a terminal pre-launch state); production callers `void` it at module scope, tests `await` it for determinism. The process keeps running after `'started'` until the app quits.

**Q3 How does the module call the product?**
➡️ Three function fields: `register`, `dispose`, `activate`. `register` is a closure that builds its own `FeatureContext` inside (e.g. `() => feature.register(standaloneContext())`) — laziness is natural, no type parameters, no separate context field, YN360-style controllers fit with a three-line closure. The `MoirasiaFeature` contract stays untouched.

**Q4 Canonical ordering of guard / control / lock?**
➡️ Control check **first**, then platform/arch guard, then `userData` override, then single-instance lock. Kills the YN360 control hang; the protocol always answers, even on an unsupported platform (Amove's guard-before-control is superseded — strictly more robust). No listeners are registered in control mode — kills the Orbis bug structurally.

**Q5 Identity facts required?**
➡️ `productName` required (module scope, fixes Exithibition's deferred `setName`); `appUserModelId` optional (Exithibition gains `com.local.Exithibition`). `appId: string`, not `ProductId` — future adopters (LiteMaptica…) are not product ids.

### Round 2 — variation, as data

**Q6 Menus and CSP?** ➡️ App-owned data: `menu?: () => MenuItemConstructorOptions[]` (module installs via `Menu.buildFromTemplate`/`setApplicationMenu`) and `contentSecurityPolicy?: (rendererUrl) => string` (module reads `ELECTRON_RENDERER_URL`, wires `session.defaultSession.webRequest.onHeadersReceived`). Apps keep their policy strings and templates; the module owns only the wiring.

**Q7 Quit policy?** ➡️ `quitOnLastWindow?: boolean | (() => boolean)`, default `true`. Four of five apps are the data value `true`; Amove passes its platform+presence predicate as a closure. The module holds no quit-policy opinion.

**Q8 Register-failure UX?** ➡️ The module always `console.error`s, then awaits `onRegisterError?` (Bonded/YN360 pass their dialog closures, Bonded special-cases `BondedRuntimeInUseError`), then `app.quit()`. A throwing hook is logged; quit still proceeds.

**Q9 YN360's about panel?** ➡️ No `aboutPanel` field (one app, zero hidden behavior — hatch discipline: named fields only for variations shared by ≥2 apps). It folds into YN360's `register` closure, which is the app's whenReady body.

**Q10 Generic escape hatches (`wire`, `configure`)?** ➡️ Rejected. `register` is the extension point for ready-time product extras; unforeseen events stay in the entry or justify a named field once a pattern appears in ≥3 apps.

### Round 3 — testing and rollout

**Q11 Test seam?** ➡️ Mock category: the module imports `app`/`Menu`/`session` directly; tests cross the module's interface with a `vi.mock('electron')` double plus `vi.mock` of the sibling `login-item-control` module. One new root test file; the interface is the test surface. Per-app unit tests of app-owned facts (CSP helper, ipc authorization) survive unchanged.

**Q12 File split?** ➡️ Extract `runLoginItemControl` to `packages/desktop-shell/src/login-item-control.ts`; `main.ts` re-exports it (specifier `'@moirasia/desktop-shell/main'` unchanged) and also re-exports the launcher. Avoids a circular import (`standalone-launch` → `main` → `standalone-launch`).

**Q13 Migration order?** ➡️ Exithibition first (simplest, fixes the worst drift) → Orbis → Bonded → Amove → YN360 (optional final step, fixes the latent control hang). One commit per step; each app migrates independently; the module is additive until its callers adopt it.

**Q14 Docs?** ➡️ `CONTEXT.md` term **Standalone launcher** added (done). `docs/architecture/standalone-applications.md` paragraph about thin entries rewritten in the final step (see §7 step 10).

---

## 3. Design-it-twice comparison (three sub-agent designs)

| | A — minimize | B — maximise flexibility | C — optimise common caller |
|---|---|---|---|
| Shape | one function, 13-field spec, `void` | generic `TApp`/`TContext`, `Promise<LaunchOutcome>`, `wire` registrar + `configure` hooks | one function, 4 required fields + 6 optional hatches, `void` |
| Ordering | lock **before** control (wrong — rests on the isolated-userData assumption, which is falsified by YN360's source: the re-point happens inside `runLoginItemControl`, after the lock check) | control first, guard, userData, lock — correct, with the sharpest deadlock analysis | control first — correct |
| Depth | high, but `aboutPanel` field for one app | depth eroded by two type params + dumping-ground hatches (acknowledged) | highest for the common caller; trivial 5-line default |
| Verdict | basis for the lean field set | adopted the outcome union | **basis of the winner** |

**Chosen: hybrid, C-dominant.** C's shape and ordering, B's `Promise<Outcome>` for deterministic tests, A's lean three-field lifecycle (no `context` field, no type params). Rejected: A's ordering, B's `wire`/`configure` hatches and generics, a hypothetical `aboutPanel` field.

---

## 4. The interface

New file `packages/desktop-shell/src/standalone-launch.ts`:

```ts
import { app, Menu, session } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { runLoginItemControl } from './login-item-control'

/** Terminal state of a launch attempt. The promise resolves when the attempt settles;
 *  the process keeps running after 'started' until the app quits. Production callers void it. */
export type StandaloneLaunchOutcome =
  | 'controlled'                // the login-item control protocol claimed the process; it self-exits
  | 'unsupported-platform'      // platform/arch guard failed; app.exit(1) already dispatched
  | 'single-instance-refused'   // lock lost; app.quit() already dispatched
  | 'started'                   // register() resolved
  | 'start-failed'              // register() rejected; failure hook ran; app.quit() dispatched
  | 'launch-failed'             // the control/launch chain itself rejected; app.exit(1) dispatched

export interface StandaloneLaunchOptions {
  /** Login-item control id, also names diagnostics ('amove', 'orbis', 'yn360', …). */
  readonly appId: string
  /** app.setName — applied synchronously at module scope. */
  readonly productName: string
  /** app.setAppUserModelId — applied synchronously; Windows identity. */
  readonly appUserModelId?: string
  /** The whenReady body. Build the FeatureContext inside: it runs after the userData
   *  override, so getPath('userData') sees the overridden path. Also the place for
   *  product extras (about panel, …). */
  readonly register: () => Promise<void> | void
  /** Teardown. May be called before register() settles (quit during startup); features
   *  already tolerate that. Awaited exactly once, before the final quit. */
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
  /** Quit when the last window closes. Default true; Amove passes a predicate. */
  readonly quitOnLastWindow?: boolean | (() => boolean)
  /** Additive failure UX after a register() rejection (dialogs). The module always logs. */
  readonly onRegisterError?: (error: unknown) => void | Promise<void>
}

export function runStandaloneLaunch(options: StandaloneLaunchOptions): Promise<StandaloneLaunchOutcome>
```

`packages/desktop-shell/src/main.ts` gains:

```ts
export { runStandaloneLaunch } from './standalone-launch'
export type { StandaloneLaunchOptions, StandaloneLaunchOutcome } from './standalone-launch'
```

## 5. Canonical sequence, invariants, error modes

The implementation — the whole point is that this exists **once**:

```
runStandaloneLaunch(options):
  1  app.setName(options.productName)
  2  if (options.appUserModelId) app.setAppUserModelId(options.appUserModelId)
  3  try:
  4    controlled = await runLoginItemControl(options.appId)
  5    if controlled: return 'controlled'              # zero listeners registered — Orbis bug dead
  6    if (options.platforms && !platforms.includes(process.platform)): app.exit(1); return 'unsupported-platform'
  7    if (options.archs && !archs.includes(process.arch)):            app.exit(1); return 'unsupported-platform'
  8    if (options.userDataEnv && env[options.userDataEnv]) app.setPath('userData', env[options.userDataEnv])
  9    if (!app.requestSingleInstanceLock()): app.quit(); return 'single-instance-refused'
 10    app.on('second-instance', () => options.activate?.())
 11    app.on('activate',         () => options.activate?.())
 12    app.on('window-all-closed', () => { quit = resolveQuitPolicy(); if (quit) app.quit() })
 13    quitting = false; stopped = false
 14    app.on('before-quit', (event) => {
 15      if (stopped) return                            # second pass-through quits
 16      event.preventDefault()
 17      if (quitting) return
 18      quitting = true
 19      void Promise.resolve(options.dispose()).catch(log).finally(() => { stopped = true; app.quit() })
 20    })
 21    try:
 22      await app.whenReady()
 23      if (options.contentSecurityPolicy) installCsp(options.contentSecurityPolicy(process.env.ELECTRON_RENDERER_URL))
 24      if (options.menu) Menu.setApplicationMenu(Menu.buildFromTemplate(options.menu()))
 25      await options.register()
 26      return 'started'
 27    catch (error):
 28      console.error(error)
 29      await Promise.resolve(options.onRegisterError?.(error)).catch(log)   # failure UX is additive
 30      app.quit()
 31      return 'start-failed'
 32  catch (error):                                    # the control/launch chain itself failed
 33    console.error(error)
 34    app.exit(1)
 35    return 'launch-failed'

installCsp(policy):
  session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } }))

resolveQuitPolicy(): undefined → true; boolean → itself; function → call it
```

**Invariants (the interface, beyond the types):**

- Call exactly once, at module scope, before `whenReady`.
- Identity (`setName`/`setAppUserModelId`) is applied synchronously — before any `await`.
- `register` runs inside `whenReady`, **after** the `userData` override — build the `FeatureContext` inside the closure.
- No listeners are ever registered in control mode.
- `dispose` is awaited at most once; a rejecting `dispose`/`onRegisterError` is logged and the quit still proceeds.
- The module owns every `app.quit()`/`app.exit(1)` decision; entries never call them.

**Error modes:** the six `StandaloneLaunchOutcome` states — each is side-effect-complete (exit/quit already dispatched).

## 6. What the implementation hides vs. what stays app-owned

**Hidden behind the seam (locality):** the canonical ordering and its rationale; the control-mode gate; the `before-quit` preventDefault/re-entry/await protocol (the subtlest logic, previously five divergent copies including one bug); CSP wiring mechanics; menu installation; lock arbitration and `second-instance` wiring; the `ELECTRON_RENDERER_URL` read; error routing and exit-code conventions.

**App-owned, passed as data (honest leaks):** menu templates (Orbis's call `feature.addLocation()`); CSP policy strings; identity strings; failure-dialog copy (Bonded's lease special case); Amove's quit predicate; YN360's about-panel one-liner inside its `register`.

## 7. Implementation steps

Each step is one commit. Verify after every step.

### Step 1 — extract `login-item-control.ts` (no behavior change)

- Move `runLoginItemControl` from `packages/desktop-shell/src/main.ts` to new `packages/desktop-shell/src/login-item-control.ts` (imports: `app` from `electron`; `join`/`tmpdir`; `writeSync`/`rm`; the `LoginItemControlResult` type stays in `index.ts`, import it).
- `main.ts`: `export { runLoginItemControl } from './login-item-control'` — the `'@moirasia/desktop-shell/main'` specifier keeps working for all five entries.
- Verify: `pnpm typecheck && pnpm test` (root).

### Step 2 — add `standalone-launch.ts` (no callers yet)

- New file with the interface from §4 and the implementation from §5, doc comments carrying the invariants.
- `main.ts` re-exports it (see §4).
- Verify: `pnpm typecheck && pnpm test`.

### Step 3 — the test surface

New `tests/standalone-launch.test.ts` (root suite; `vitest.config.ts` coverage already includes `packages/desktop-shell/src/**/*.ts`):

- Double: `vi.hoisted` electron double — an `EventEmitter`-based `app` with spy methods `setName`, `setAppUserModelId`, `setPath`, `requestSingleInstanceLock` (toggleable), `whenReady` (returns a controllable deferred), `quit`, `exit`; `Menu.buildFromTemplate`/`setApplicationMenu` spies; `session.defaultSession.webRequest.onHeadersReceived` spy. `vi.mock('electron', ...)`.
- `vi.mock` the sibling `../packages/desktop-shell/src/login-item-control` module to resolve `true`/`false`/reject on demand. (Its own control-branch behavior is a separate module with its own interface; each seam is tested at its interface.)
- Drive everything through `runStandaloneLaunch` + `await outcome` + emitting events on the double; assert observable outcomes, never internals.

Test matrix:

| # | Scenario | Asserts |
|---|---|---|
| 1 | Happy path | identity sync before anything (`invocationCallOrder`); whenReady → CSP wired with the `ELECTRON_RENDERER_URL` policy value → menu installed → `register` once; `'started'` |
| 2 | Control mode | `runLoginItemControl` → true: `'controlled'`; **zero** `app.on` registrations; `register` never called; `setName` was called |
| 3 | Platform guard | platform outside list → `exit(1)`, `'unsupported-platform'`, lock never requested; arch variant ditto |
| 4 | Lock refused | `quit()`, `'single-instance-refused'`, no listeners |
| 5 | Register rejects | `console.error`; `onRegisterError` awaited before `quit`; `'start-failed'`; hook itself rejecting → still logs and quits |
| 6 | before-quit protocol | `preventDefault` once; `dispose` awaited before final `quit`; second `before-quit` passes through; throwing `dispose` logged, quit proceeds |
| 7 | Quit policy | default → quit on `window-all-closed`; boolean `false` → no quit; Amove-shaped predicate → honored |
| 8 | userData override | env set → `setPath('userData', value)` **before** the lock; `register`'s closure observes it; env unset → no `setPath` |
| 9 | Control chain rejects | `console.error` + `exit(1)`, `'launch-failed'` |
| 10 | No activate hook | `second-instance`/`activate` tolerated |
| 11 | Optional wiring | no `contentSecurityPolicy` → no header wiring; no `menu` → `setApplicationMenu` never called |

- Verify: `pnpm test` — all green.

### Step 4 — migrate Exithibition (fixes the worst drift)

New `apps/integrated/Exithibition/src/main/index.ts` in full:

```ts
import { runStandaloneLaunch } from '@moirasia/desktop-shell/main'
import { feature } from './feature'
import { standaloneContext } from './standalone'

void runStandaloneLaunch({
  appId: 'exithibition',
  productName: 'Exithibition',
  appUserModelId: 'com.local.Exithibition',
  register: () => feature.register(standaloneContext()),
  activate: () => feature.activate(),
  dispose: () => feature.dispose()
})
```

Gained by this step alone: teardown awaited on quit (the bug), `setName` at module scope, Windows identity set, activation wired inside the control branch.
Verify: `pnpm -C apps/integrated/Exithibition typecheck && pnpm -C apps/integrated/Exithibition test` and root `pnpm typecheck && pnpm test`.

### Step 5 — migrate Orbis

New `apps/integrated/Orbis/src/main/index.ts`:

```ts
import type { MenuItemConstructorOptions } from 'electron'
import { runStandaloneLaunch } from '@moirasia/desktop-shell/main'
import { feature } from './feature'
import { standaloneContext } from './standalone'

void runStandaloneLaunch({
  appId: 'orbis',
  productName: 'Orbis',
  appUserModelId: 'com.opense.Orbis',
  userDataEnv: 'ORBIS_USER_DATA',
  contentSecurityPolicy: orbisContentSecurityPolicy,
  menu: orbisMenu,
  register: () => feature.register(standaloneContext()),
  activate: () => feature.activate(),
  dispose: () => feature.dispose()
})

function orbisContentSecurityPolicy(rendererUrl: string | undefined): string {
  // same string as today's installContentSecurityPolicy
}

function orbisMenu(): MenuItemConstructorOptions[] {
  // same template as today's installApplicationMenu (File → Choose Folder… / Rescan call feature)
}
```

Delete `installContentSecurityPolicy`/`installApplicationMenu`/the module-scope listener block; the `activate`-in-control-mode bug dies.
Verify: `pnpm -C apps/integrated/Orbis typecheck && pnpm -C apps/integrated/Orbis test` + root gates.

### Step 6 — migrate Bonded

New `apps/integrated/Bonded/src/main/index.ts`:

```ts
import { dialog } from 'electron'
import { runStandaloneLaunch } from '@moirasia/desktop-shell/main'
import { feature } from './feature'
import { BondedRuntimeInUseError } from './runtime-lease'
import { standaloneContext } from './standalone'

void runStandaloneLaunch({
  appId: 'bonded',
  productName: 'Bonded',
  appUserModelId: 'com.opense.Bonded',
  platforms: ['darwin'],
  archs: ['arm64'],
  userDataEnv: 'BONDED_USER_DATA',
  contentSecurityPolicy: bondedContentSecurityPolicy,
  menu: bondedMenu,
  register: () => feature.register(standaloneContext()),
  activate: () => feature.activate(),
  dispose: () => feature.dispose(),
  onRegisterError: async (error) => {
    if (error instanceof BondedRuntimeInUseError) {
      await dialog.showMessageBox({ type: 'info', title: 'Bonded is already running', message: error.message, detail: 'Close the other host before opening standalone Bonded.' })
      return
    }
    await dialog.showMessageBox({ type: 'error', title: 'Bonded could not start', message: error instanceof Error ? error.message : 'An unknown startup error occurred.' })
  }
})

function bondedContentSecurityPolicy(rendererUrl: string | undefined): string {
  // same policy string as today (scriptPolicy dev/packaged split)
}

function bondedMenu(): MenuItemConstructorOptions[] {
  // same template as today
}
```

The dialogs now run after the module's own `console.error` (additive UX, matching today's visible behavior).
Verify: `pnpm -C apps/integrated/Bonded typecheck && pnpm -C apps/integrated/Bonded test` + `pnpm -C apps/integrated/Bonded build:renderer` + root gates.

### Step 7 — migrate Amove

New `apps/integrated/Amove/src/main/index.ts`:

```ts
import type { MenuItemConstructorOptions } from 'electron'
import { runStandaloneLaunch } from '@moirasia/desktop-shell/main'
import { feature } from './feature'
import { standaloneContext } from './standalone'
import { contentSecurityPolicy } from './content-security-policy'

void runStandaloneLaunch({
  appId: 'amove',
  productName: 'Amove',
  appUserModelId: 'com.opense.Amove',
  platforms: ['darwin', 'win32', 'linux'],
  contentSecurityPolicy,
  menu: amoveMenu,
  register: () => feature.register(standaloneContext()),
  activate: () => feature.activate(),
  dispose: () => feature.dispose(),
  quitOnLastWindow: () => process.platform !== 'darwin' && feature.shouldQuitWhenWindowAllClosed()
})

function amoveMenu(): MenuItemConstructorOptions[] {
  // same platform-conditional template as today's installStandaloneMenu
}
```

`content-security-policy.ts` and its test are untouched. Behavior change: the platform guard now runs after the control check — a control command on an unsupported platform answers the protocol (more robust, unreachable in practice).
Verify: `pnpm -C apps/integrated/Amove typecheck && pnpm -C apps/integrated/Amove test` + root gates.

### Step 8 — migrate YN360 (fixes the latent control hang)

New `apps/standalone/YN360/src/main/index.ts`:

```ts
import { app, dialog } from 'electron'
import { runStandaloneLaunch } from '@moirasia/desktop-shell/main'
import { Yn360Controller } from './controller'
import { standaloneContext } from './standalone'

const controller = new Yn360Controller()
void runStandaloneLaunch({
  appId: 'yn360',
  productName: 'YN360 Controller',
  appUserModelId: 'com.yn360.controller',
  platforms: ['darwin'],
  archs: ['arm64'],
  contentSecurityPolicy: yn360ContentSecurityPolicy,
  menu: yn360Menu,
  register: () => {
    app.setAboutPanelOptions({ applicationName: 'YN360 Controller', applicationVersion: app.getVersion(), copyright: 'Copyright 2026 YN360 Controller contributors' })
    return controller.start(standaloneContext())
  },
  activate: () => controller.activate(),
  dispose: () => controller.dispose(),
  onRegisterError: async (error) => {
    await dialog.showMessageBox({ type: 'error', title: 'YN360 Controller could not start', message: error instanceof Error ? error.message : 'An unknown startup error occurred.' })
  }
})

function yn360ContentSecurityPolicy(rendererUrl: string | undefined): string {
  // same policy string as today
}

function yn360Menu(): MenuItemConstructorOptions[] {
  // same template as today
}
```

The lock moves after the control check: control commands while the app runs now answer instead of hanging.
Verify: `pnpm -C apps/standalone/YN360 typecheck && pnpm -C apps/standalone/YN360 test` + root gates.

### Step 9 — architecture doc

Update the paragraph in `docs/architecture/standalone-applications.md` that says the standalone entries "stay thin and keep only identity and platform scoping: `app.setName`, the bundle id, the single-instance lock, login-item control, host-specific menus, and quitting when all windows close" to:

> The standalone launcher (`runStandaloneLaunch`, `@moirasia/desktop-shell/main`) owns the standalone launch sequence: the login-item control branch, the single-instance lock, ready-time registration, activation re-focus, quit policy, and awaited teardown. Entry files keep only app facts — identity, platform scope, the `userData` override env, the menu template, the CSP policy, failure-dialog copy, and Amove's quit predicate. The control check precedes the platform guard and the lock, so a control command always answers. Product behavior still lives in each app repository; the suite host is untouched.

### Step 10 — final gates

```
pnpm typecheck && pnpm test
pnpm -C apps/integrated/Amove typecheck && pnpm -C apps/integrated/Amove test
pnpm -C apps/integrated/Exithibition typecheck && pnpm -C apps/integrated/Exithibition test
pnpm -C apps/integrated/Bonded typecheck && pnpm -C apps/integrated/Bonded test
pnpm -C apps/integrated/Orbis typecheck && pnpm -C apps/integrated/Orbis test
pnpm -C apps/standalone/YN360 typecheck && pnpm -C apps/standalone/YN360 test
```

Then the repo's full gate `pnpm ui:verify` (baseline it before starting; pre-existing unrelated failures don't block this change).

### Manual smoke checklist (per migrated app)

- `pnpm -C apps/integrated/<App> dev`: app launches; Dock/menu product name correct.
- Second launch focuses the first instance (`second-instance`).
- Quit fully tears down: process exits promptly, no orphaned native helpers (Exithibition especially).
- Login-item toggle from the Moirasia General page answers the protocol (family apps).
- `ORBIS_USER_DATA` / `BONDED_USER_DATA` override honored (data lands in the override dir).
- CSP header present in devtools (network panel) in dev; locked down when packaged (`package:dir`).
- Amove: `presenceMode: 'taskbar'` on darwin keeps the app running with all windows closed.
- YN360: `--moirasia-control=login-item:get` while the app is running **answers** (the fixed hang).

## 8. Behavior-change ledger (intended)

| App | Change | Why |
|---|---|---|
| Exithibition | `before-quit` awaits `dispose()`; `setName` at module scope; `setAppUserModelId('com.local.Exithibition')`; activation inside control branch | teardown-on-quit bug + drift |
| Orbis | `activate`/`window-all-closed`/`before-quit` no longer fire in control mode | drift bug |
| YN360 | lock after control check | control hang |
| Amove | platform guard after control check | protocol always answers; unreachable in practice |
| Bonded, YN360 | failure dialogs run after the module's own `console.error` | additive UX, same visible behavior |
| All | control-chain rejection → `console.error` + `exit(1)` (Amove, Exithibition lacked it — unhandled rejection today; Bonded, Orbis, YN360 already had it) | one error funnel |

## 9. Risks and mitigations

1. **`vi.mock` double fidelity** (it fakes event semantics, not real Electron): mitigated by the manual smoke checklist + per-app Playwright e2e suites.
2. **Exithibition's deferred `setName` might have been deliberate**: module-scope is Electron-standard; smoke-verify the Dock name; if ever needed, add a named field only when a second app needs it.
3. **Bundler cycles after the split**: `login-item-control.ts` imports nothing from `main.ts`; `standalone-launch.ts` imports only from it — verified acyclic by typecheck + each app's `build:app`.
4. **Quit during startup** (dispose before register settles): parity with today — features already tolerate (`controller?.dispose()`); documented as an invariant.
5. **Rollback**: every step is an independent commit; each app can revert independently; the module is additive until adopted.

## 10. Out of scope

- Vox (Bun workflow, tray/overlay/lease lifecycle — different shape).
- LiteMaptica, Mini-NSW, Semiquaver (not audited; the launcher is available to them when they want it).
- Review candidates 2–6 (durable JSON store, artifact join, legacy field deletion, appearance defaults, authorize helper).
- The suite host, the `MoirasiaFeature` contract, `runLoginItemControl` behavior itself.

## 11. Success criteria

- Five entry files are data specs; the `runStandaloneLaunch` call itself is ≈10–20 lines in every case, and the launch sequence exists exactly once. Total file length still varies with how much app-owned template code stays inline: Exithibition ~12 lines and Amove ~25 (its CSP already lives in a separate file), but Orbis, Bonded, and YN360 keep non-trivial CSP-string and menu-template functions in the entry file (carried over verbatim) and land around 40–45 lines — still well down from today's 57/47/51, just not uniformly ≤30.
- The drift bugs are dead: Exithibition teardown-on-quit, Orbis control-mode activation, YN360 control hang.
- The §3 test matrix is green through the module's interface; root and per-app typecheck/test/build green.
- Deletion test holds: removing the module would scatter the sequence back across five callers.
- Adding the next family app requires only a spec object — leverage: one interface, five adapters, N future apps.