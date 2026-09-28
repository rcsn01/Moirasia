# Implementation plan: own host runtime selection in a Host ownership module

## Decision

Introduce `src/main/host-ownership.ts`, a `HostOwnership` module that owns which process hosts the suite — the policy layer that today sits inline in the composition root. The module owns:

- native-runtime detection and host-option assembly (native MoirasiaHost vs. local menu-host agent),
- construction of the `AppPresence` and the authenticated `NativeHostClient`,
- the fail-fast native bootstrap (abort and rethrow; no local fallback),
- the reconnect single-flight after disconnections,
- recording of host-initiated quits (`host.willQuit`) and exit-to-host,
- routing of native UI events (`ui.openShell`, `ui.toggleShelf`, `host.uiStateChanged`) to shell callbacks,
- quit coordination: unsubscribe native events, preserve the host for a recorded exit-to-host, request `host.quitSuite` otherwise, and run Electron teardown as the final callback before closing the client; the composition root appends `app.quit()` in the returned promise's continuation.

`src/main/index.ts` keeps pure composition wiring only: settings load and the legacy-appearance migration, appearance, login-item settings, menu, updater, feature runtime / controller / shell-window construction, `UiLifetime` and `UiCommandRouter` wiring, launch intents, memory diagnostics, and the `before-quit` sequence — which now delegates the native leg to `void ownership.coordinateQuit(teardown).then(() => app.quit())`.

This is a behavior-preserving refactor. Spawn arguments, request methods, event routing, log lines, and the quit sequence are reproduced verbatim. The module is deep: callers learn ~7 members and get ~130 lines of policy that today cannot be tested at all.

The previous `plan.md` (the shared `HostUiState` contract) shipped in `8c3eec9`; this plan replaces it.

## Design decisions

| Decision | Applied answer | Why |
|---|---|---|
| Scope | The module owns runtime selection, bootstrap, reconnect, native event routing, and quit coordination. Settings, appearance, menu, updater, intents, memory diagnostics, and the Electron teardown body stay in `index.ts`. | Every one of these policies is host-runtime ownership; the rest is composition wiring that has no other home. |
| Type name and location | `HostOwnership` in `src/main/host-ownership.ts`. | Follows house naming (`UiLifetime`, `ShellWindowLifecycle`); the term **Host ownership** is added to `CONTEXT.md` (applied alongside this plan). |
| Construction shape | Static `acquire(options): Promise<HostOwnership>` for detection + bootstrap, then `start()` for subscriptions. | All-or-nothing bootstrap: the composition root gets a fully selected ownership or an exception, never a half-selected one. `start()` runs after `UiLifetime` exists, so no native callback can fire before the composition root is ready — today's implicit ordering becomes a guarantee. |
| Local fallback | None. Native bootstrap failure aborts the spawned candidate, closes the client, and rethrows; the app quits (current `index.ts:81–85`). | Verbatim fail-fast. Silent degradation to local ownership would leave persistent state unowned. |
| Dependency seams | `OwnedPresence` interface (`AppPresence` satisfies it structurally) and the existing `NativeHostClientLike`; both are injected through optional factory options. Production omits the factories; tests provide fakes. | Two real adapters per seam (production + test) justify the seam; matches the house pattern (`FeatureRuntime` takes an injected `nativeClient` in its tests). `AppPresence` and `NativeHostClient` keep their interfaces and their own tests unchanged. |
| Detection policy | The module owns the `platform === 'darwin' && existsSync(...)` check and calls the `paths.ts` resolvers with an injected `resourcesPath`. `process.resourcesPath` and `process.platform` are read once in `index.ts` and passed in. | Keeps the policy behind the seam; `process.resourcesPath` is `undefined` under vitest, so injection is required for hermetic tests anyway. |
| Quit shape | `coordinateQuit(teardown: () => Promise<void>): Promise<void>`. The module unsubscribes native events, makes the preserve decision, disposes presence, fires `host.quitSuite` when required, awaits `teardown()` after the request settles, closes the client once teardown resolves, and then resolves; the caller appends `app.quit()` in a `.then()` continuation (`void ownership.coordinateQuit(teardown).then(() => app.quit())`). | Reproduces today's `finish()` sequencing exactly (`index.ts:196–203`): the `quitSuite` request settles before teardown starts, and the client closes before `app.quit()` is requested. Moving `app.quit()` out of the teardown body into the caller's continuation is the one structural change — it lets the module own the close ordering without importing Electron. |
| Dead `preserveNativeHost` call | Reproduced verbatim inside `coordinateQuit`. | Discovered while finalizing: `AppPresence.preserveNativeHost()` returns early when `usesNativeHost` is true, and its only call site (`index.ts:194`) requires `nativeSelected`, which implies the native candidate — so the call is a no-op in every reachable state. Deleting it is a behavior review question, not part of a behavior-preserving refactor. The method itself stays; it is tested directly for the local-agent case. |
| Native UI event routing | The module subscribes `ui.openShell`/`ui.toggleShelf`/`host.uiStateChanged` and invokes `options.openShell` / `options.toggleShelf` / `options.shelfVisible` directly. `index.ts` keeps `UiCommandRouter` for `second-instance` argv intents only — the launch intent (`:164–170`) never routes through it, today or after — and the module's `toggleShelf` option still routes `{ kind: 'toggle-shelf' }` through the router via the composition-root closure. | The router's `#disposed` guard never covered native events in a reachable state: today the native subscriptions are removed before `commandRouter.dispose()` runs, inside the same synchronous quit block, so no native event can observe the disposed router. After the extraction `ui.openShell` bypasses the router entirely, `ui.toggleShelf` keeps the guard through the closure, and the quit block stays synchronous. Routing one concept through one module is the point of the extraction. |
| `host.uiStateChanged` payload check | The inline payload check (`payload && typeof payload === 'object' && typeof payload.shelfVisible === 'boolean'`, `index.ts:149`) moves verbatim. | Typing the native event schemas (dead `NativeHostUiState`, the dropped `{page}` key) is the separate host UI-state contract candidate; do not mix scopes. |
| Tests | New `tests/host-ownership.test.ts` driving the module through its interface with fake presence/client factories and a mocked `node:fs`. No existing test changes. | The interface is the test surface. Nothing today tests `index.ts` behavior (only source-string matching), so there is nothing to replace. |
| Coverage | Add `src/main/host-ownership.ts` to `coverage.include` in `vitest.config.ts`. | The house list already names main-process modules with interface tests; `index.ts` was never listable. |
| ADR | None. | There is no `docs/adr/` directory and this change reverses no recorded decision. |

## Current evidence and friction

- `src/main/index.ts` is among the most-changed files under `src/` in the last 30 days of history (11 commits; only `features/runtime.ts` changed more often, at 12), and the only test that touches it asserts on its source text (`tests/platform-integration.test.ts:62, 67–68`).
- `index.ts:42–58` detects the native runtime and assembles native and local host options inline.
- `index.ts:60–64, 66–94` holds five mutable lets (`shellWindow`, `openShell`, `presence`, `nativeClient`, `nativeSelected`) and the bootstrap: native candidate + client construction, `waitForNativeHost`, `connectNativeHost`, fail-fast catch with `abortNativeBootstrap` + `close`. The local branch constructs presence with the agent options.
- `index.ts:103` `preserveNativeMenuHost`, `:128` `nativeWillQuit`, `:129–137` the reconnect single-flight, `:138–151` the connection watcher, `host.willQuit` recording, and the three native UI subscriptions with inline payload validation — all as loose closures over the lets.
- `index.ts:183–207` the `before-quit` handler interleaves native unsubscription, the preserve decision, `presence.preserveNativeHost()`/`dispose()`, the `host.quitSuite` request, and a `finish()` chain that disposes Electron, closes the client, and only then calls `app.quit()`.
- `index.ts:216–226` `connectNativeHost` performs connect + bootstrap-snapshot validation with its own error logs.
- `AppPresence` (`src/main/app-presence.ts`) and `NativeHostClient` (`src/main/native-host/client.ts`) are already deep modules with interface tests (`tests/app-presence.test.ts`, `tests/native-host-client.test.ts`). The missing module is the policy layer above them — selection, lifetime, and quit — which is exactly what cannot be tested through `index.ts`.
- Deletion test: deleting `host-ownership.ts` would scatter all of the above back into the composition root, untestable. The complexity concentrates; the module earns its keep.

## Proposed module interface

```ts
// src/main/host-ownership.ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AppPresence, type NativeMenuBarHostOptions } from './app-presence'
import { applicationAgentPath, moirasiaFeatureServicePath, moirasiaHostPath, moirasiaHostSocketPath, moirasiaNativeFeaturePaths } from './paths'
import { NativeHostClient } from './native-host/client'
import type { NativeHostClientLike } from '../shared/native-host-contracts'
import type { AppPresenceMode, ControllerPage } from '../shared/contracts'

/** The presence operations ownership relies on; `AppPresence` satisfies this structurally. */
export interface OwnedPresence {
  readonly mode: AppPresenceMode
  apply(mode: AppPresenceMode): void
  waitForNativeHost(timeoutMs?: number): Promise<boolean>
  restartNativeHost(timeoutMs?: number): Promise<boolean>
  preserveNativeHost(): void
  abortNativeBootstrap(): void
  dispose(): void
}

export type PresenceFactory = (options: { menuBarIconPath: string; open(): void; nativeHost?: NativeMenuBarHostOptions }) => OwnedPresence
export type NativeClientFactory = (options: { socketPath: string; tokenPath: string }) => NativeHostClientLike

export interface HostOwnershipOptions {
  readonly userData: string
  readonly menuBarIconPath: string
  readonly applicationPath: string
  readonly resourcesPath: string
  readonly platform: string
  readonly initialPresence: AppPresenceMode
  readonly openShell(page?: ControllerPage): void | Promise<void>
  readonly toggleShelf(): void | Promise<void>
  readonly shelfVisible(visible: boolean): void
  readonly onAvailabilityChanged(): void
  readonly createPresence?: PresenceFactory
  readonly createClient?: NativeClientFactory
}

export class HostOwnership {
  static async acquire(options: HostOwnershipOptions): Promise<HostOwnership>
  start(): void
  get presence(): OwnedPresence
  get nativeClient(): NativeHostClientLike | undefined
  canExitToNativeHost(): boolean
  exitToHost(): void
  coordinateQuit(teardown: () => Promise<void>): Promise<void>
}
```

The module owns only host runtime policy. It does **not** own: presence and menu-host spawning (AppPresence), the socket protocol (`NativeHostClient`), settings storage (`ShellSettingsStore`), shell-window or IPC wiring, the feature runtime, or the Electron teardown body — which arrives as the `coordinateQuit` callback. `NativeMenuBarHostOptions` must be exported from `app-presence.ts` (it is currently module-private and the factory signature needs it).

## Required behavior and invariants

1. **Detection:** native runtime is available iff `platform === 'darwin' && existsSync(moirasiaHostPath(resourcesPath)) && existsSync(moirasiaFeatureServicePath(resourcesPath))`. Native options are `{ executable: moirasiaHostPath(...), featureServicePath, applicationPath, userData, iconPath: menuBarIconPath, pidPath: join(userData, 'menu-host.pid'), bondedHelperPath, shoutDriverPath }` with feature paths from `moirasiaNativeFeaturePaths(resourcesPath)`. Local options on darwin are `{ executable: applicationAgentPath(resourcesPath), applicationPath, pidPath: join(userData, 'menu-host.pid') }`; non-darwin passes no `nativeHost` at all.
2. **Fail-fast bootstrap, no fallback:** the native candidate is constructed with `open: () => { void Promise.resolve(options.openShell()).catch(console.error) }` and the client with `{ socketPath: moirasiaHostSocketPath(userData), tokenPath: join(userData, 'runtime', 'client.token') }`. Bootstrap order is `presence.apply(initialPresence)` → `waitForNativeHost()` → `client.connect()` → `client.getSnapshot()`; a missing snapshot logs `'MoirasiaHost returned an invalid snapshot.'`; connect errors log `'Could not connect to MoirasiaHost'`. Any failure runs `presence.abortNativeBootstrap()` + `client.close()`, logs `'Native Moirasia bootstrap failed; local ownership was not selected.'`, and rethrows. No second (local) presence is ever constructed.
3. **Local branch:** presence is constructed with the local options (or none off-darwin), `apply(initialPresence)` runs, and `nativeClient` stays `undefined`. There is no catch on this branch — a local `apply` failure propagates out of `acquire` and quits the app through the composition root's `whenReady` catch, exactly as today's unguarded `index.ts:93`.
4. **Accessors:** `presence` exposes the constructed presence; `nativeClient` is defined only in native mode; `canExitToNativeHost()` is `nativeSelected && client?.isConnected() === true`; `exitToHost()` records the preservation intent with that same condition evaluated at call time.
5. **Subscriptions start only at `start()`**, registered exactly once, only in native mode: the connection watcher calls `onAvailabilityChanged()` on every event and triggers `#reconnect()` on `'disconnected'`; `host.willQuit` sets the internal flag; `ui.openShell` calls `options.openShell()`; `ui.toggleShelf` calls `options.toggleShelf()`; `host.uiStateChanged` calls `options.shelfVisible(visible)` only when the payload passes today's inline check verbatim — `payload && typeof payload === 'object' && typeof payload.shelfVisible === 'boolean'` (`index.ts:149`) — so a null or non-object payload is ignored and a non-boolean `shelfVisible` never reaches the callback.
6. **Reconnect single-flight (verbatim):** no-op when not native, when no client, when the host initiated quit, or when a reconnect is already in flight; otherwise `await presence.restartNativeHost()` then `await client.connect()`. A thrown error at either step logs `'Could not reconnect to MoirasiaHost'`; a `false` restart returns silently and does not connect.
7. **Quit coordination sequence (verbatim):** unsubscribe all native subscriptions → if the exit-to-host intent is recorded and the client is connected, `presence.preserveNativeHost()` (a documented no-op in native mode, see the design table) → `presence.dispose()` → if `nativeSelected && client?.isConnected() && !exitRecorded && !willQuit`, fire `client.request('host.quitSuite')` and run `teardown()` in its `.finally()` (errors log `'Could not coordinate native suite quit'`); otherwise run `teardown()` immediately. `teardown()` is awaited, then `client?.close()` runs, then the returned promise resolves and the caller's `app.quit()` continuation fires — the exact order of today's `finish()` (`index.ts:196–203`), where the close precedes `app.quit()`. A rejected `teardown` skips the close and the quit, exactly as a throw inside today's `finish()` does. The client is never closed before teardown completes, and `app.quit()` never runs before the client is closed.
8. **No new policy:** no settings reads, no appearance, no menu, no intents inside the module; no protocol, `AppPresence`, `NativeHostClient`, or `paths.ts` behavior changes.

## Migration map (`index.ts` → `HostOwnership`)

| Today in `index.ts` | Moves to | Notes |
|---|---|---|
| `:42` `nativeRuntimeAvailable` | `acquire` (private) | verbatim, with injected `platform`/`resourcesPath` |
| `:43–58` `nativeFeaturePaths`, `nativeHostOptions`, `localHostOptions` | `acquire` (private) | derived from injected options |
| `:67–75` native `AppPresence` candidate + `NativeHostClient` | `acquire`, via factories | factories default to the real classes |
| `:76–86` bootstrap + fail-fast catch | `acquire` | exact logs and error text |
| `:87–94` local `AppPresence` branch | `acquire` | exact options |
| `:118–125` `UiLifetime` wiring | stays, reading accessors | `mode: () => ownership.presence.mode`; `canExitToNativeHost: () => ownership.canExitToNativeHost()`; `onFinalWindowGone: () => { ownership.exitToHost(); app.quit() }` |
| `:126` `UiCommandRouter` | stays | used by `second-instance` argv intents; the module's `toggleShelf` option still routes `{ kind: 'toggle-shelf' }` through it (the launch intent at `:164–170` never uses the router) |
| `:128` `nativeWillQuit` | private field | |
| `:130–137` `reconnectNativeHost` | private `#reconnect` | verbatim single-flight |
| `:138–143` connection subscription | `start()` | callback now `onAvailabilityChanged` |
| `:144` `host.willQuit` subscription | `start()` | |
| `:145–151` `stopNativeUi` subscriptions | `start()` | inline shelf check moves verbatim |
| `:103`, `:122` `preserveNativeMenuHost` flag | `exitToHost()` | declared at `:103`, recorded at `:122` inside `onFinalWindowGone` |
| `:190–195` native unsubscribes, preserve, `presence.dispose()` | `coordinateQuit` | `stopNavigation()` and `commandRouter.dispose()` stay in `index.ts` |
| `:196–206` `finish()` + `host.quitSuite` | `coordinateQuit(teardown)` | teardown = `shellWindow.dispose` → `controller.close` → `features.disposeAll` → `host.dispose`; `client.close()` runs inside `coordinateQuit` after teardown, and `app.quit()` runs in the caller's `.then()` continuation |
| `:216–226` `connectNativeHost` | private helper in `host-ownership.ts` | exact logs |
| `:39`, `:210–214` `setLoginItemSettings` | stays in `index.ts` | the `ipc.ts` duplicate is the IPC channel-table candidate's scope |
| `:32–38`, `:228–237` settings/legacy appearance | stays in `index.ts` | composition wiring |
| `:41` `menuBarIconPath` | computed in `index.ts`, passed to `acquire` | packaging-dependent path; the module feeds it to the presence options and the native host's `iconPath` |

After the extraction `index.ts` contains no `existsSync`, no native client construction, no reconnect logic, no native event subscriptions, and no `host.quitSuite` request (237 → roughly 150 lines).

## Implementation sequence

### 1. Export the presence options type

In `src/main/app-presence.ts`, change `interface NativeMenuBarHostOptions` to `export interface NativeMenuBarHostOptions`. No behavior change.

### 2. Add the module and its tests in one focused change

Create `src/main/host-ownership.ts` with the interface above and the invariants 1–8, reproducing every behavior verbatim from `index.ts:42–58, 66–94, 128–151, 183–207, 216–226`. Internal state: `#options`, `#presence`, `#client`, `#nativeSelected`, `#willQuit`, `#exitRecorded`, `#reconnecting`, `#started`, `#unsubscribers: Array<() => void>`.

Create `tests/host-ownership.test.ts` (matrix below). Mock `electron` minimally (the `app-presence` import chain requires it, mirroring `tests/app-presence.test.ts`) and mock `node:fs`'s `existsSync` for detection; fake presence/client factories record call order into a shared array and offer programmable `waitForNativeHost`/`restartNativeHost`/`connect`/`getSnapshot`/`request` (with a deferred `host.quitSuite` promise).

Run `pnpm vitest run tests/host-ownership.test.ts`. Then `pnpm typecheck`.

### 3. Rewire the composition root

In `src/main/index.ts`:

- Delete the detection/options block (`:42–58`), the `presence`/`nativeClient`/`nativeSelected` lets and the native/local bootstrap branches (`:62–64, 66–94`), the reconnect/subscription closures (`:128–151`), and `connectNativeHost` (`:216–226`).
- Acquire after settings/appearance wiring, passing closures over the later-assigned `openShell`/`uiLifetime`/`commandRouter` lets (closures are only invoked after `start()`):

  ```ts
  const ownership = await HostOwnership.acquire({
    userData: app.getPath('userData'),
    menuBarIconPath,
    applicationPath: resolve(process.execPath, '../../..'),
    resourcesPath: process.resourcesPath,
    platform: process.platform,
    initialPresence: settings.get().appPresence,
    openShell: (page) => openShell(page),
    toggleShelf: () => commandRouter.route({ kind: 'toggle-shelf' }),
    shelfVisible: (visible) => uiLifetime.shelfVisible(visible),
    onAvailabilityChanged: () => uiLifetime.nativeHostAvailabilityChanged()
  })
  ```

- `FeatureRuntime` and `ShellWindowLifecycle` receive `nativeClient: ownership.nativeClient` (undefined in local mode, preserving both modules' mode selection).
- `presenceMode: () => ownership.presence.mode` and `applyAppPresence: (mode) => ownership.presence.apply(mode)` feed the shell window.
- Call `ownership.start()` where the subscriptions are registered today (after `commandRouter` construction).
- Replace the native leg of `before-quit` with `void ownership.coordinateQuit(async () => { await shellWindow.dispose(); controller.close(); await features.disposeAll(); host.dispose() }).then(() => app.quit())`, keeping `shuttingDown`, `preventDefault`, the `nativeTheme` listener removal, `disposeMemoryDiagnostics()`, `stopNavigation()`, and `commandRouter.dispose()` in place. (The relative order of `commandRouter.dispose()` and native unsubscription flips; they share no state, and the quit block stays synchronous, so no native event can fire in between.)

### 4. Keep the domain docs current

The **Host ownership** term is already applied to `CONTEXT.md` alongside this plan. The entry was checked against this plan's interface: it names the fail-fast bootstrap, the reconnect single-flight, host-initiated-quit and exit-to-host recording, native UI event routing, quit coordination with Electron teardown as the final callback, and the composition root's acquire/start/native-client wiring — all matching `acquire`/`start`/`presence`/`nativeClient`/`coordinateQuit` as specified here. It does not pin the client-close ordering, so the close-before-`app.quit()` sequence requires no entry change. Do not add new terms or an ADR.

### 5. Coverage hook

Add `'src/main/host-ownership.ts'` to `coverage.include` in `vitest.config.ts`.

### 6. Verify

1. `pnpm vitest run tests/host-ownership.test.ts` — the new suite.
2. `pnpm typecheck`.
3. `pnpm test` — the full suite, unchanged: `app-presence`, `native-host-client`, `feature-runtime`, `shell-window`, `ui-command-router`, `platform-integration` all pass without edits.
4. Manual smoke via `pnpm dev` (main-process flows CI cannot reach):
   - the native path boots, connects, and the shell opens;
   - killing the `MoirasiaHost` process triggers one reconnect attempt with the existing log line, and the shelf visibility event still routes after reconnect;
   - menu-bar mode with the native host: closing the last window exits to the host, which keeps running, while the Electron process quits (exit-to-host preserve);
   - dock mode: quitting stops the native runtime — the host process exits (stop-runtime path);
   - a host-initiated quit (`host.willQuit`): the app records it, tears down, and quits without issuing `host.quitSuite`;
   - a machine without staged native binaries launches in local mode, and quitting there runs no native request (local quit path).

## Test matrix for `tests/host-ownership.test.ts`

All cases drive `HostOwnership.acquire` and its methods; none inspect internal state. A shared call-order array backs the ordering assertions.

1. **Native selection:** darwin + binaries present → factory receives the native host options (executable, featureServicePath, userData, `menu-host.pid`, feature paths, applicationPath, iconPath); call order `apply(initialPresence)` → `waitForNativeHost` → `connect` → `getSnapshot`; `isNative` is observable via `nativeClient` defined and `canExitToNativeHost()` true.
2. **Bootstrap failure:** `waitForNativeHost` false → `acquire` rejects with `'MoirasiaHost.app did not become ready.'`, `abortNativeBootstrap` and `client.close` were called, and the presence factory ran exactly once (no local fallback).
3. **Connect failure:** `connect` rejects → same fail-fast path.
4. **Invalid bootstrap snapshot:** `getSnapshot` resolves `undefined` → same rejection and cleanup.
5. **Local darwin:** binaries absent → factory receives the agent options (`executable: applicationAgentPath(resourcesPath)`, applicationPath, pidPath); `nativeClient` undefined; `canExitToNativeHost()` false.
6. **Non-darwin:** factory receives no `nativeHost` key.
7. **Disconnect → reconnect:** after `start()`, a `'disconnected'` connection event calls `onAvailabilityChanged` once and runs `restartNativeHost` then `connect`; two events before the restart resolves coalesce to a single restart (single-flight); a failed restart does not connect.
8. **Reconnected event:** calls `onAvailabilityChanged`, no restart.
9. **`host.willQuit`:** after the event, a disconnect does not restart.
10. **UI events:** `ui.openShell` → `openShell` callback; `ui.toggleShelf` → `toggleShelf` callback; `host.uiStateChanged` with boolean `shelfVisible` → `shelfVisible(visible)`; with a non-boolean value → no call.
11. **Exit-to-host quit:** `exitToHost()` then `coordinateQuit(teardown)` → order is `preserveNativeHost` → `dispose` → `teardown` → `client.close`, with no `host.quitSuite` request; `exitToHost()` while disconnected records nothing (stop path applies).
12. **Stop-runtime quit:** connected, no exit recorded → `host.quitSuite` is requested; `teardown` does not run until the request's promise settles (use a deferred), then `teardown` runs, the client closes after it, and the returned `coordinateQuit` promise resolves only after the close (the composition root's `app.quit()` hangs off that resolution); a rejected request still runs teardown.
13. **Quit after `host.willQuit`:** no `host.quitSuite`; teardown runs; client closes.
14. **Local quit:** no request, no client to close; `presence.dispose` called; teardown runs.
15. **`start()` is single-registration:** calling `start()` twice subscribes each listener once.

## Test ownership and tests that should survive

- **New `tests/host-ownership.test.ts`:** the matrix above — the host runtime policy finally has a test surface at its interface.
- **`tests/app-presence.test.ts`:** unchanged. `AppPresence`'s interface is untouched; the export of `NativeMenuBarHostOptions` is type-only.
- **`tests/native-host-client.test.ts`:** unchanged. The client's construction options are identical.
- **`tests/feature-runtime.test.ts`, `tests/shell-window.test.ts`, `tests/platform-integration.test.ts`:** unchanged. The client shape they consume is unchanged, and `app.setName`/dock-icon wiring stays in `index.ts` so the source-text assertions still hold.
- **Replace, don't layer:** no test covers `index.ts` behavior today, so nothing is deleted; the source-string platform test remains (improving it belongs to the IPC candidate, not this one).

## Risks and mitigations

- **Quit-sequence regression (highest risk).** Two orderings are load-bearing: the `quitSuite` request settles before teardown starts (the host terminates the desktop app during `quitSuite`, so an early close would abort the request), and the client closes before `app.quit()` is requested (today's `finish()`, `index.ts:196–203`). `coordinateQuit` reproduces both with the same `.catch().finally()` chain and the close-then-resolve tail; cases 11–14 assert exact call order, including teardown-not-until-settle via a deferred. Verify the four manual quit paths in step 6.4.
- **Callbacks firing before the composition root is ready.** All native subscriptions move behind `start()`, which `index.ts` calls at the exact point the subscriptions are registered today. Closures passed to `acquire` may reference not-yet-assigned lets exactly as today's `open` closure does.
- **Factory drift.** The production defaults are the real `AppPresence` and `NativeHostClient`; fakes exist only in tests, and both real classes keep their own suites. The module must not grow presence/protocol logic that tests then bypass.
- **Detection hermeticity.** `resourcesPath` and `platform` are injected; `node:fs`'s `existsSync` is mocked, mirroring the existing `app-presence` test. `moirasiaHostSocketPath(userData)` stays real (pure).
- **Reconnect races.** The single-flight promise is reproduced verbatim; case 7 pins coalescing.
- **Behavior drift by accident.** The refactor is behavior-preserving by construction: every moved block is verbatim, and the log lines, error text, and request methods are listed in invariants 2–7. Any observed difference in manual smoke is a bug to fix before landing.
- **Scope creep.** The typed native event schema (dead `NativeHostUiState`, dropped `{page}` key), the IPC channel table, the login-item duplicate, and the Feature mode seam are explicitly out of scope; the inline `shelfVisible` check moves but is not "fixed."

## Out of scope

- Typing native event payloads or removing the dead `NativeHostUiState` type and the dropped `{page}` key (host UI-state contract candidate).
- The Controller IPC channel table and the `setLoginItemSettings`/`appSetLoginItem` duplicate (IPC candidate).
- The Feature mode seam (`FeatureModeLinks`) and any `host-mode.ts`/`runtime.ts` change.
- Any change to `AppPresence`, `NativeHostClient`, `paths.ts`, `ShellSettingsStore`, the Swift runtime, the wire protocol, packaging, or the standalone applications.
- Making `UiLifetime`, `UiCommandRouter`, or `EmbeddedFeatureHost` deeper; adding new host features (e.g., local menu-host preservation on exit).
- Adding an ADR.

## Completion criteria

- `src/main/index.ts` contains no native-runtime detection, host-option assembly, client construction, reconnect logic, native event subscription, or `host.quitSuite` request, and shrinks by roughly 90 lines with zero behavior change.
- `HostOwnership` owns all of the above behind `acquire` / `start` / `presence` / `nativeClient` / `canExitToNativeHost` / `exitToHost` / `coordinateQuit`, reproduced verbatim from the old inline code, including every log line and error message and both quit orderings (`quitSuite` settles before teardown; the client closes before `app.quit()`).
- `tests/host-ownership.test.ts` passes and covers the full matrix; every existing suite passes unchanged; `pnpm typecheck` passes.
- `vitest.config.ts` coverage includes the new module; `CONTEXT.md`'s **Host ownership** entry matches the shipped interface.
- The four manual quit paths (exit-to-host preserve, dock stop-runtime, host-initiated quit, local quit) behave exactly as before.