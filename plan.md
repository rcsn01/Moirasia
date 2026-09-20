# Implementation plan: the Controller's snapshot and command lifecycle

## Decision

Architecture-review candidate 1 ("Deepen the Controller's snapshot composition"), finalized. The plan is three coordinated moves, each landing one fact at its natural owner, plus one contract trim and the **Controller**'s first interface-level test suite:

1. **The Controller deepens in place** (`src/main/application-controller.ts`): commands on one application serialize through a per-application queue; `setLoginItem` unifies through the shared `#action` lifecycle (deleting its hand-rolled twin); the execFile contact with controlled apps (`invokeLoginControl`) moves into the `ApplicationAgent` port; the write-only `ApplicationStatus.busy` field is deleted from the contract.
2. **The native-process port decodes its own payloads**: `NativeHostClientLike`/`NativeHostClient` gain a typed `getSnapshot()` returning `NativeHostSnapshot | undefined`; the zod schema imports and parse/safeParse calls leave `src/main/index.ts` (`:213`) and `src/main/ipc.ts` (`:7, :58–62`).
3. **Initial-state defaults centralize**: the appearance seed table moves to the pure `packages/desktop-shell/src/index.ts` with a `defaultAppearanceSnapshot()` factory; `DEFAULT_SHELL_SETTINGS` moves to `src/shared/contracts.ts`; a new `emptyControllerSnapshot()` factory becomes the one owner of the renderer's pre-first-snapshot state, and the renderer's hand-written `EMPTY`/`DEFAULT_SETTINGS` twins delete (`src/renderer/shell/controller.ts:8–9`) — including the `bundleId: ''` divergence from the catalog.

Grilling sharpened the review card before this plan: the card's phrase "one implementation owns the snapshot fact end-to-end" overstated the scatter. The composition itself was never scattered — `snapshot()` (`application-controller.ts:29`) is one line over three already-deep facts (applications, `AppearanceRegistry`, Feature runtime), and the merge-on-refresh (`:33`) is the applications state machine and belongs inside the Controller. What is actually scattered is the **command lifecycle** (no serialization, a write-only and broken `busy` path, a duplicated `setLoginItem` body), the **native payload decode** (parse decisions at three consumer sites), the **initial-state defaults** (two hand-written renderer twins), and the **test surface** (zero interface tests for the module that coordinates every user-facing action). Inventing a "snapshot composer" module would have been a pass-through; deepening the owners deletes the duplication instead.

Design provenance (design-it-twice): two alternative module shapes were compared and rejected. A standalone `SnapshotComposer` module (pure compose/parse/defaults functions consumed by controller, index, ipc, and renderer) fails the deletion test as a shallow re-wrap — deleting it re-scatters nothing that isn't already one zod schema or one assembly line. Splitting the controller's state into an internal `controller-state.ts` behind a thin façade is the same pass-through shape. Serialization variants were likewise compared: a **global queue** was rejected (it couples independent applications — opening Amove would delay quitting Vox), and a **reject-on-busy guard** was rejected (every in-repo precedent queues — `ShellSettingsStore.#persist`, `ShellWindowLifecycle.#enqueue`, `AppearanceRegistry.#update`, the Feature runtime's per-feature `#enqueue` — and a double-click should not become an error). The chosen **per-application queue** copies the Feature runtime's per-feature `#enqueue` shape — `previous.catch(() => undefined).then(operation)`, fixed id domain, one precedent — minus that helper's settled-tail deletion, which the controller drops on purpose (four fixed ids; see the module notes below).

Terminology follows `CONTEXT.md` and the codebase-design vocabulary. No new external seam is invented: `NativeHostClientLike` (`src/shared/native-host-contracts.ts:158–165`) remains the outer port facing the native host process — the new `getSnapshot()` accessor concentrates payload decoding *inside* that existing port. `ApplicationAgent` (`application-controller.ts:16`) is already the local-substitutable port for AppKit/`--moirasia-control` contact (the controller takes it as an injectable constructor parameter with a production default); the login-item move extends that port rather than adding a second one. `ShellSettingsStore` and `AppearanceRegistry` are already deep and stay untouched.

## Verified baseline

Repository root: `/Users/mac/Syncthing/Projects/Moirasia`, tip `23e2d99 docs: sharpen the Feature runtime term`, worktree clean apart from this file (`plan.md` held the completed Feature mode plan, committed at `0f50d21`, and was deleted per instruction before this document was written — history preserves it). Nested Bonded repo untouched by this plan.

Baseline checks at `23e2d99`: root `pnpm test` → **271 passed / 35 files** (2026-09-21); root `pnpm typecheck` clean. No ADR directory exists at the root. `CONTEXT.md` terms read: **Controller**, **Feature runtime**, **Feature mode**, **Product bar / appearance** (the shared `AppearanceRegistry`), **Runtime lease**.

Every claim below was verified against source at `23e2d99`, not inherited from the review card. One card claim was corrected during verification: the card counted "native snapshot validated 3×" — in fact the *logic* is already single-owner (one zod schema, `nativeHostSnapshotSchema`); what is scattered is the *decode decision*: a validating `parse` that discards its result at `index.ts:213` and `safeParse`-plus-cache at `ipc.ts:58–62` (driven by the two native branches at `:25–31` and `:38–43`), with both consumers importing the schema and round-tripping `unknown`. The port accessor fixes that scatter without inventing a second implementation.

## Evidence (the scattered and missing pieces)

| # | Fact | Sites | Today's defect |
|---|------|-------|----------------|
| 1 | Command lifecycle | `#action` `application-controller.ts:68–75`; `setLoginItem` `:52–63` | `#busy` (`:21`) is set (`:55`, `:71`) and never checked as a guard — its only read (`:33`) copies it into the rebuilt status that no consumer reads — so concurrent open/quit/login-item commands on one application all proceed; `open`/`quit` each run `refresh()` in their `finally` (`:74`), so their rebuilds interleave last-writer-wins, while the login-item command's `finally` only emits (`:62`). `busy` is write-only: zero readers in `src/renderer`, `apps/`, `packages/`, or `tests/` (grep verified; the only other `busy` hits are unrelated standalone apps and `runtime-lease`'s own domain). Its write path is broken anyway: the emit after `#busy.set` clones `#applications`, which only gains `busy` during a `refresh()` rebuild — so `busy` reaches a snapshot solely when a concurrent refresh (e.g. the 2s polling timer, `shell-window.ts:95`) races the action. |
| 2 | Serialization precedent | `settings.ts:36` `#persist`; `shell-window.ts:74` `#enqueue`; `desktop-shell/src/main.ts:62` `#update`; `features/runtime.ts` per-feature `#enqueue` | The pattern exists four times; the Controller — the one coordinator whose queue is driven by user double-clicks — is the module without it. |
| 3 | setLoginItem twin | `setLoginItem` `:52–63` vs `#action` `:68–75` | A byte-level twin of the action lifecycle (guard → busy/error bookkeeping → operation → catch → finally) minus the refresh; two implementations of one lifecycle. |
| 4 | Login-item execFile | `invokeLoginControl` `:100–106`, called at `:57` and `:82` | execFile contact with controlled apps lives outside the `ApplicationAgent` (which already owns `snapshot`/`open`/`quit`/`openLoginItemsSettings` via `SwiftApplicationAgent` `:88–98`). Untestable as injected: controller tests would spawn real processes. |
| 5 | Native payload decode | `index.ts:213` (parse + discard); `ipc.ts:58–62` `cacheNativeSettings` (safeParse + `setCached`), called from the two native branches `:28–29` and `:40–41` | Both consumers import the schema and handle `unknown`; the decode decision is re-made at each site, and the port returns raw `unknown` for the read it already special-cases internally (`client.ts:72–73, :184`). |
| 6 | Initial-state defaults | renderer `controller.ts:8–9`; `settings.ts:5`; `desktop-shell/src/main.ts:10–11` | The renderer hand-writes the appearance seed table and `DEFAULT_SHELL_SETTINGS`, and writes `bundleId: ''` where the application catalog has a real bundle id — a divergent twin of two shared facts. |
| 7 | Test surface | `rg ApplicationController tests/` → no matches | Zero interface-level tests for the module that owns discovery, open, quit, login items, page tracking, and snapshot composition. `ipc.ts` is only ever mocked (`shell-window.test.ts:42`); `index.ts` is only pinned by source-string assertions (`platform-integration.test.ts:52–58`, which do not touch the lines this plan edits). |

## The deepened module

### 1. The Controller: per-application serialization, one action lifecycle

```ts
// application-controller.ts — changed members only; all other members untouched
#queues = new Map<ApplicationId, Promise<ControllerSnapshot>>()   // bounded: APPLICATION_IDS is a fixed 4-id domain

async #action(id: ApplicationId, operation: (record: AgentRecord) => Promise<void>): Promise<ControllerSnapshot> {
  const current = this.#applications.find((item) => item.id === id)
  if (!current?.installed) throw new Error(`${applicationCatalog.get(id).label} is not installed.`)
  const run = (this.#queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(async (): Promise<ControllerSnapshot> => {
    this.#errors.delete(id); this.#emit()
    const status = this.#applications.find((item) => item.id === id)
    if (!status?.installed) throw new Error(`${applicationCatalog.get(id).label} is not installed.`)
    const record = { id, installed: status.installed, running: status.running, ...(status.path ? { path: status.path } : {}) }
    try { await operation(record) }
    catch (error) { this.#errors.set(id, message(error)); throw error }
    finally { await this.refresh() }
    return this.snapshot()
  })
  this.#queues.set(id, run)
  return run
}

async setLoginItem(id: ApplicationId, enabled: boolean): Promise<ControllerSnapshot> {
  const status = this.#applications.find((item) => item.id === id)
  if (!status?.installed || !status.path) throw new Error(`${applicationCatalog.get(id).label} is not installed.`)
  return this.#action(id, async (record) => {
    if (!record.path) throw new Error(`${applicationCatalog.get(id).label} is not installed.`)
    const result = await this.agent.setLoginItem(record.path, id, enabled)
    this.#applications = this.#applications.map((item) => item.id === id ? { ...item, loginItem: result } : item)
    if (result.status === 'enabled' || result.status === 'disabled') await this.settings.clearPending(id)
  })
}
```

- `open` (`:36`) and `quit` (`:49`) drop their `'opening'`/`'quitting'` literals and call `#action(id, operation)`.
- `#retryPending` (`:77–83`) calls `this.agent.setLoginItem(status.path, id, true)` instead of `invokeLoginControl`.
- The queue tail is never deleted (four fixed ids); a rejected tail is insulated by the `.catch(() => undefined)` of the next enqueue. `close()` does not drain queues — today's code has no draining either; in-flight actions settle as orphaned promises exactly as they do today.
- `refresh()` itself is deliberately **not** queued: it is a full rebuild from a fresh agent snapshot, so interleaved refreshes are last-writer-wins on equivalent data, and serializing it would hold the shell's 2s polling refresh behind a slow agent call for no correctness gain. `#retryPending`'s possible double-invocation across concurrent refreshes is pre-existing, idempotent (`login-item:set:on` twice to the same target state), and best-effort by design (`:82` swallow comment) — unchanged.

### 2. The ApplicationAgent owns login-item control

```ts
// application-controller.ts
export interface ApplicationAgent {
  snapshot(): Promise<readonly AgentRecord[]>
  open(record: AgentRecord): Promise<void>
  quit(record: AgentRecord): Promise<boolean>
  setLoginItem(bundlePath: string, id: ApplicationId, enabled: boolean): Promise<LoginItemControlResult>
  openLoginItemsSettings(): Promise<void>
}
```

`invokeLoginControl` (`:100–106`) moves verbatim into `SwiftApplicationAgent` as the `setLoginItem` body: same `join(bundlePath, 'Contents', 'MacOS', executableName)`, same `--moirasia-control=login-item:set:on|off`, same `maxBuffer`, same last-line JSON parse, same `protocolVersion === 1 && appId === id` validation, same 5s timeout. The module-level function and its import of `join` move with it. `LoginItemControlResult` is already imported. Nothing else in the repository imports `invokeLoginControl` (verified).

### 3. The native-process port decodes its payloads

```ts
// native-host-contracts.ts — the Like gains one required member
export interface NativeHostClientLike {
  connect(): Promise<void>
  close(): void
  request<T = unknown>(method: NativeHostMethod | string, params?: Record<string, unknown>): Promise<T>
  getSnapshot(): Promise<NativeHostSnapshot | undefined>   // typed decode; undefined = malformed payload; transport errors still throw
  subscribe(event: string, listener: (payload: unknown, revision: number) => void): () => void
  subscribeConnection?(listener: (event: NativeHostConnectionEvent) => void): () => void
  isConnected(): boolean
}

// client.ts — the production adapter
async getSnapshot(): Promise<NativeHostSnapshot | undefined> {
  const result = await this.request('host.getSnapshot')
  return isNativeHostSnapshot(result) ? result : undefined
}
```

`isNativeHostSnapshot` (`native-host-contracts.ts:199`) is the existing type guard over the existing schema — no new contract, just a home for the decode at the port. The client's internal `host.getSnapshot` bookkeeping (`client.ts:72–73` read-only marking, `:184` `#awaitingFullSnapshot`/`#revision` side effects) is preserved because the accessor wraps the same `request` call. Consumers:

- `index.ts:210–219` `connectNativeHost` — `const snapshot = await client.getSnapshot(); if (!snapshot) { console.error('MoirasiaHost returned an invalid snapshot.'); return false }` inside the existing try/catch. Same semantics: malformed payload ⇒ connect fails; transport error ⇒ logged connect failure. The `nativeHostSnapshotSchema` import (`index.ts:13`) deletes.
- `ipc.ts` native branches (`:25–31`, `:38–43`) — `const snapshot = await options.nativeClient.getSnapshot(); if (snapshot) options.settings.setCached(snapshot.settings); return options.settings.get()`. The `cacheNativeSettings` helper (`:58–62`) and the schema import (`:7`) delete. Semantics preserved exactly: malformed payload ⇒ last good cache kept and the handler still succeeds; transport error ⇒ handler still rejects.

A third snapshot reader exists and deliberately stays raw: the Feature runtime's native adapter (`src/main/features/host-mode.ts:179`) calls `request<unknown>('host.getSnapshot')`, and its `#applySnapshot` (`:235`) accepts looser legacy partial payloads on purpose — routing it through the strict accessor would be the acceptance-tightening the Feature mode plan ruled out (see Out of scope). It imports no zod schema and is untouched by this plan.

### 4. Initial-state defaults: one owner per fact

```ts
// packages/desktop-shell/src/index.ts — pure, renderer-safe (the entry already imports only './feature-catalog')
export const DEFAULT_PRODUCT_APPEARANCES: Record<ProductId, Appearance> = { moirasia: 'system', amove: 'system', vox: 'system', exithibition: 'dark', bonded: 'system', shout: 'system', orbis: 'system', yn360: 'system' }
export function defaultAppearanceSnapshot(): AppearanceSnapshot { return { version: 1, revision: 0, values: { ...DEFAULT_PRODUCT_APPEARANCES } } }

// src/shared/contracts.ts
export const DEFAULT_SHELL_SETTINGS: ShellSettings = { version: 4, launchAtLogin: false, appPresence: 'dock', pendingLoginItems: {}, features: {} }
export function emptyControllerSnapshot(): ControllerSnapshot {
  return {
    applications: applicationCatalog.entries.map(({ id, label, bundleId }) => ({ id, label, bundleId, installed: false, running: false })),
    appearances: defaultAppearanceSnapshot(),
    features: []
  }
}
```

- `desktop-shell/src/main.ts` imports `DEFAULT_PRODUCT_APPEARANCES` and `defaultAppearanceSnapshot` from `./index`; the local `DEFAULTS` (`:10`) and `EMPTY` (`:11`) delete; `#snapshot` initializes from `defaultAppearanceSnapshot()` (`:22`); the two table spreads at `:34` and `:185` use `DEFAULT_PRODUCT_APPEARANCES`. `defaultProductAppearance` (`:14`) keeps its signature and all callers (it now reads the moved table) — `feature-surface-host.ts` and its mocked tests are untouched.
- `settings.ts` imports `DEFAULT_SHELL_SETTINGS` from `../shared/contracts` (three internal uses: `:8`, `:47`, and the export); `tests/shell-settings.test.ts` updates its import to `../src/shared/contracts`. One owner, no re-export.
- `src/renderer/shell/controller.ts` deletes both twins (`:8–9`): `useState(emptyControllerSnapshot)` (React calls the function per mount as a lazy initializer — a fresh object each time; today's module-level `EMPTY` constant is one shared object that nothing ever mutates, so the observable behavior is unchanged) and `useState(DEFAULT_SHELL_SETTINGS)`. Preload and main-process bundles are unaffected: `desktop-shell/index.ts` is pure data (no Electron, React, or filesystem imports), so the new value imports are renderer- and sandbox-safe.

### 5. Contract trim: `ApplicationStatus.busy` deletes

`busy` (`contracts.ts:19`) leaves `ApplicationStatus`, and all seven controller sites leave with it — the `#busy` map (`:21`), the merge arm in `refresh()` (`:33`), both write sites (`:55`, `:71`), both deletes (`:62`, `:74`), and `#action`'s parameter (`:68`). Verified safe: no renderer, app, package, or test reader anywhere (grep verified); `ApplicationStatus` never crosses to the native host (it is the Electron→renderer contract only); `ControllerApi` is unaffected. The `'opening' | 'quitting' | 'login-item'` union dies with it. Serialization replaces it: the interface no longer exposes a concurrency fact it cannot truthfully maintain, and if the shell ever wants a spinner, the serialized queue is the truthful foundation to re-add it on.

## Behavior-preservation ledger (checked, not assumed)

- **Verbatim moves:** `invokeLoginControl` into the agent (byte-for-byte, including the protocol-version and `appId` validation); the native snapshot acceptance rules (the client's existing `request('host.getSnapshot')` path is wrapped, not re-implemented); the appearance seed table's exact values; `DEFAULT_SHELL_SETTINGS`' exact shape.
- **Preserved semantics at the port:** `index.ts`'s gate treats malformed payload as connect failure (with a log; the log text changes from the zod error dump to a fixed message — the one wording change this plan makes) and transport errors as logged connect failure. `ipc.ts` keeps the last good settings cache on a malformed payload and still rejects on transport errors. `setCached` is only ever called with schema-valid settings, exactly as today.
- **Serialization is the plan's one deliberate concurrency change:** commands on the same application now run one at a time in call order. The turn begins inside the queue chain's `.catch`/`.then`, so even an empty-queue turn starts a couple of microtask jobs after the call, where today's `#action` prologue (`busy` set, error-clear, emit) runs synchronously at call time — the caller cannot tell the difference, because the returned promise settles with the same final snapshot after the same operation and refresh. For a queued command, two further consequences, both deliberate: (a) the installed guard re-evaluates at turn start against the refreshed state (fresher than today's call-time-only check); (b) the record passed to the operation is built from the post-previous-command state. Cross-application independence is preserved (per-id queues, not one global chain).
- **`setLoginItem` through `#action`** harmonizes three behaviors, all listed: it gains the start-of-turn error-clear (today it deletes `#errors` only on success — retrying a failed login item now clears the stale error like `open`/`quit` already do); its `finally` gains the refresh (today it only emits — one extra `agent.snapshot()` per login-item change, an operation the shell's 2s polling already performs routinely, and the returned snapshot becomes fresher); and the path-vanished-while-queued case — unreachable today, since the call-time guard and the `invokeLoginControl` call share one synchronous block — now records the label's `not installed` error on the status, uniform with other operation failures (an application that becomes fully uninstalled while queued instead rejects through the turn-start guard, which — like today's call-time guard — throws without recording an error). The login-item result itself survives the finally-refresh via the existing `prior.loginItem` merge arm (`:33`).
- **`busy` deletion is observable only in its absence**: no consumer reads it; the emit-after-set path never contained it in practice (only a racing refresh could surface it, transiently, to a non-reader).
- **Renderer initial state**: identical shape, except the pre-first-snapshot rows now carry the catalog's real `bundleId` instead of `''` (a divergence fix, visible only before the first snapshot arrives, behind the `loading` gate at `app.tsx:46`).
- **Untouched behavior:** `refresh()`'s rebuild order (rebuild → `#retryPending` → `#emit` → return clone, `:31–35`); the feature-status subscription wiring (`:26`); `restorablePage`/`rememberPage`/`reportPage`/`suspendRenderer`; `installFeature`/`uninstallFeature`/`setAppearance`/`setAllAppearances` (their delegates own their own queues); `close()`; `snapshot()`'s clone; the polling/focus refresh call sites in `shell-window.ts` (`:95`, `:107`); `index.ts`'s bootstrap, connection supervision, and teardown ordering; `appSetLoginItem` (`ipc.ts:64–70`) and `setLoginItemSettings` (`index.ts:204–208`) remain the twins they are today (see Out of scope).

## Migration of call sites

| Site | Becomes |
|---|---|
| `#busy` `:21`, the `busy` merge arm `:33`, `#action`'s `busy` param/write/delete `:68`/`:71`/`:74`, `setLoginItem`'s `:55`/`:62` | deleted; `#action(id, operation)` + `#queues` |
| `setLoginItem` body `:52–63` | the unified body above (guard → `#action`) |
| `#retryPending` `:82` | `this.agent.setLoginItem(status.path, id, true)` |
| `invokeLoginControl` `:100–106` | moves into `SwiftApplicationAgent.setLoginItem`; `ApplicationAgent` interface (`:16`) gains the member |
| `index.ts:213` schema parse | `client.getSnapshot()` typed call; `index.ts:13` import deletes |
| `ipc.ts:7` schema import, `:58–62` `cacheNativeSettings`, `:28–29`/`:40–41` call sites | `nativeClient.getSnapshot()` + inline `setCached`; helper deletes |
| `NativeHostClientLike` `:158–165` | + `getSnapshot()` required member; `NativeHostClient` implements it (`client.ts`) |
| `desktop-shell/src/main.ts:10–11, :14, :22, :34, :185` | table + factory imported from `./index`; local `DEFAULTS`/`EMPTY` delete |
| `settings.ts:5` | import from `../shared/contracts`; local export deletes |
| `contracts.ts` | + `DEFAULT_SHELL_SETTINGS`, `emptyControllerSnapshot()`; − `busy?:` (`:19`); + value imports `applicationCatalog`, `defaultAppearanceSnapshot` |
| renderer `controller.ts:8–9` | `useState(emptyControllerSnapshot)` + `DEFAULT_SHELL_SETTINGS` import; twins delete |

`shell-window.ts`, `ui-command-router.ts`, `paths.ts`, `app-presence.ts`, the Feature runtime, and every preload/`ControllerApi` signature: untouched.

## Tests

**Existing suites:** all 271 tests survive. One mechanical update: the fake client in `tests/feature-runtime.test.ts` (the `NativeHostClientLike` literal at `:332`) gains `getSnapshot: async () => snapshot as NativeHostSnapshot | undefined` — the fake's `snapshot` parameter is `unknown` (its fixtures are deliberately looser than the schema), so the raw value needs the cast; the member is never invoked — the runtime reads via `request` — it only satisfies the interface. `NativeHostSnapshot` joins the file's existing type import from `../src/shared/native-host-contracts`. `tests/shell-settings.test.ts` re-points its `DEFAULT_SHELL_SETTINGS` import at `../src/shared/contracts`. No test pins `busy`, `invokeLoginControl`, `cacheNativeSettings`, or the renderer twins (all verified by grep).

**New file `tests/application-controller.test.ts`** — the Controller's first interface suite. Injections: a scripted `ApplicationAgent` fake (log of calls plus manually-resolved deferred promises for the serialization tests), a real `ShellSettingsStore` on a tmpdir (`await load()` first, as `shell-settings.test.ts` does), a real `AppearanceRegistry` on a tmpdir constructed **without** `load()` (defaults, no watcher), and a structural `FeatureRuntime` fake cast `as unknown as FeatureRuntime` (the controller touches only `subscribe`/`statuses`/`setActive`/`activate`/`setInstalled`/`relaunch`). Twelve tests, through the public interface only:

1. `refresh()` rebuilds statuses from agent records under catalog facts (label, bundleId, installed, running, path) and preserves a prior `loginItem`.
2. `snapshot()` hands out an isolated clone: mutating a returned snapshot does not affect the next one.
3. `open()` sends the agent the current record and returns the refreshed snapshot.
4. A failing `open()` records the error on the status and rethrows; the next successful command clears it.
5. `open()` on a not-installed application throws the label message without touching the agent or recording an error.
6. Commands on the same application serialize: a `quit` issued while an `open` is pending starts only after the open settles, and both resolve with correct final state.
7. Commands on different applications run concurrently (no global serialization): a pending `open` on Amove does not delay a `quit` on Vox.
8. `setLoginItem()` routes through the queue, stores the control result on the status, and clears the settings' pending flag on `enabled`/`disabled` results.
9. A failing `setLoginItem()` records the error and keeps the pending item.
10. `refresh()` retries pending login items through the agent (`login-item:set:on`) and clears the pending flag on an `enabled` result.
11. A failing retry keeps the pending item and stays silent (the `:82` swallow).
12. Feature-status changes fan out to controller subscribers with a fresh snapshot, and `restorablePage()` returns `'general'` when a feature page is not installed-and-loaded but passes non-feature pages through.

**`tests/native-host-client.test.ts`** gains two tests against the real client over its existing scripted-socket harness (`SNAPSHOT` fixture, `:42`):

13. `getSnapshot()` resolves the typed snapshot (settings and feature entries present).
14. `getSnapshot()` resolves `undefined` when the host returns a malformed snapshot payload.

Expected total: **285 passed / 36 files** (271 + 12 controller + 2 client).

## CONTEXT.md update

Sharpen the **Controller** term under Terms:

> **Controller** — `src/main/application-controller.ts`; the Moirasia main-process side that discovers, opens, focuses, and quits Amove, Vox, Bonded, and Shout through the AppKit agent and the `--moirasia-control` protocol. It owns the applications fact — agent records merged with catalog facts, login-item results, and per-application error capture — and serializes commands per application, so concurrent open, quit, and login-item requests on one application land in order. It composes the ControllerSnapshot from the applications fact, the `AppearanceRegistry`, and the Feature runtime; the renderer's initial state is the shared `emptyControllerSnapshot()` default.

## Execution steps (root repo)

1. **Port accessor + defaults.** Add `getSnapshot()` to `NativeHostClientLike` and `NativeHostClient`; rewire `index.ts:210–219` and `ipc.ts:22–50`; delete `cacheNativeSettings` and both schema imports. Move the appearance table + factory to `desktop-shell/src/index.ts`; rewire `main.ts`; move `DEFAULT_SHELL_SETTINGS` to `contracts.ts` with `emptyControllerSnapshot()`; rewire `settings.ts`, the `shell-settings.test.ts` import, and the renderer twins. Update the `feature-runtime.test.ts` fake. Add the two client tests. Verify: `pnpm typecheck` + `pnpm exec vitest run tests/native-host-client.test.ts tests/feature-runtime.test.ts tests/shell-settings.test.ts tests/shell-renderer.test.tsx` (the last drives the renderer hook whose constants moved).
2. **Controller deepening.** Extend `ApplicationAgent` with `setLoginItem` and move `invokeLoginControl` into `SwiftApplicationAgent`; rewire `#retryPending`; add `#queues`; rewrite `#action`; unify `setLoginItem`; delete `busy` from `contracts.ts:19` and all seven controller sites (`:21`, `:33`, `:55`, `:62`, `:68`, `:71`, `:74`). Verify: `pnpm typecheck`.
3. **Gap tests.** Add `tests/application-controller.test.ts` with the twelve tests. Verify: `pnpm exec vitest run tests/application-controller.test.ts` (12 passed).
4. **Full check.** `pnpm typecheck`; `pnpm test` (expect **285 passed / 36 files**); `pnpm build:app`. Grep gates: `rg -n "busy" src/main/application-controller.ts src/shared/contracts.ts src/renderer src/preload` → no matches; `rg -n "invokeLoginControl" src` → no matches; `rg -n "nativeHostSnapshotSchema" src/main` → no matches (the schema stays owned by `src/shared/native-host-contracts.ts` and its test); `rg -n "DEFAULT_SETTINGS|bundleId: ''" src/renderer` → no matches; `rg -n "DEFAULT_SHELL_SETTINGS" src` → only `contracts.ts` (definition), `settings.ts` (import), and the renderer's `controller.ts` (import).
5. **Update `CONTEXT.md`** with the sharpened Controller term.

Commit messages: `refactor: own the Controller's snapshot and command lifecycle` (steps 1–3 fold into it — the intermediate states add no review value), then `docs: sharpen the Controller term`.

## Out of scope

- **index.ts's native connection supervision** (bootstrap fallback, reconnect policy, `willQuit`, menu-host preservation, teardown ordering, ~10 `nativeSelected && nativeClient` re-derivations) — architecture-review candidate 2, the highest-churn seam; it owns connection state, not the snapshot fact, and deserves its own design pass. Its login-item writer twin (`setLoginItemSettings` `index.ts:204–208` vs `appSetLoginItem` `ipc.ts:64–70`) travels with it; this plan deliberately leaves both bodies alone.
- **ipc.ts's shell-settings ownership split** (the two native branches dividing on `options.nativeClient`) — the Feature mode plan (`0f50d21`) recorded this as its own seam ("shell-settings ownership across host modes"), and that recorded exclusion stands: this plan de-duplicates the *payload decode* beneath the handlers and does not move settings ownership or touch the handler split. Caching native settings at bootstrap (today `index.ts` validates and discards) would be a behavior change in the settings-ownership seam — a separate decision.
- **A renderer busy/in-flight UI** (disabled buttons, spinners) — no such requirement exists; the queue is the foundation, not the feature.
- **Generalizing the single-flight pattern** into a shared cross-module helper — the four existing queues (`settings`, `shell-window`, `AppearanceRegistry`, Feature runtime) each have module-specific semantics; an abstraction now would be speculative.
- **Tightening `isNativeHostSnapshot`'s acceptance** (the looser legacy-payload tolerance the Feature mode plan already ruled on) — the accessor moves the decode, it does not tighten it; `host-mode.ts`'s snapshot read (`:179`) stays on raw `request` for the same reason.
- The dead symbols from the small-deletions candidate (`nativeHostClientId`, `NativeHostClient.onConnectionState`, `UiLifetime.reset`) — unrelated to the snapshot fact; separate batch.
- Bonded candidates (observation ingest, blocking-lifecycle completion), the command contract, and the Bonded renderer view-model — separate deepenings; this plan's surface is the Controller and its two ports only.