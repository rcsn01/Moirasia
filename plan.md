# Implementation plan: the Feature mode seam

## Decision

Architecture-review candidate 1 (the Feature runtime's host-mode split), finalized. The **Feature runtime** (`src/main/features/runtime.ts`, 379 lines) keeps its exact public interface and gains one internal seam: a **Feature mode** interface with exactly two adapters — `NativeFeatureMode` and `LocalFeatureMode` — selected once at construction. Today the mode is selected once (a `nativeClient` present or not) and then re-implemented as branches and native-only bodies at 22 `#nativeClient` sites across 14 members (grep `#nativeClient` — the field, the constructor, and 12 methods): every one of `statuses`, `isInstalled`, `isLoaded`, `syncAtLaunch` (two bodies), `setInstalled` (two bodies), `setActive`, `activate`, and the near-identical 15-line twins `openShelf`/`toggleShelf` re-decides who owns installed-truth, how a feature loads, and how status composes; `disposeAll` adds its native-only unsubscribe. After this change the runtime's methods are mode-agnostic one-liners over shared machinery (loaded instances, the per-feature serialization queue, load errors, active-feature tracking), and each adapter owns its mode's behavior in one place. Feature-host bugs gain locality; the third time a host-mode behavior changes, it changes in one adapter, not at one of the 22 `#nativeClient` sites.

Design provenance: three parallel interface designs were compared (design-it-twice). A "facts protocol" design (adapters push normalized facts; one reconciler owns instance lifecycle) and an event/session design were **rejected** because both restructure instance lifecycle and change observable behavior — `setInstalled` becomes eventual, local mode starts emitting status events it never emits today, and the 22 existing tests break by design. The chosen design moves each mode arm **verbatim** into its adapter, keeps `setInstalled` synchronous-to-persistence, and keeps the runtime as the single writer of shared state.

Terminology follows `CONTEXT.md` and the codebase-design vocabulary: the new module is the **Feature mode** module (new term, see "CONTEXT.md update"); the **Feature runtime** remains the one interface and the shared machinery. No new external seam is invented: `NativeHostClientLike` (`src/shared/native-host-contracts.ts`) is already the outer port at the native-process boundary (production adapter `NativeHostClient`, test fakes), and `ShellSettingsStore` is local-substitutable (real store on a tmpdir in tests). The mode seam is **internal** to the Feature runtime module: two real implementations (native and local are both shipped production paths, both exercised by tests), selected once, never re-tested per method.

## Verified baseline

Repository root: `/Users/mac/Syncthing/Projects/Moirasia`, tip `d91e15e docs: plan the Enforcement policy module`, worktree clean apart from this file (`plan.md` held the completed Enforcement plan and has been replaced in place by this document). Nested Bonded repo tip `a308988 refactor: own blocking enforcement in one module` — untouched by this plan.

Baseline checks at `d91e15e`: root `pnpm test` → **264 passed / 35 files** (2026-09-20, re-run during planning); root `pnpm typecheck` clean. No ADR directory exists at the root; no ADR conflicts. `CONTEXT.md` terms read: **Feature runtime**, **Feature host**, **Embedded feature**, **Feature surface host**, **Shell window lifecycle**, **Host mode** (suite|standalone — a different axis; this plan's "native mode"/"local mode" is the feature-execution axis already described inside the Feature host and Feature surface host terms).

Every claim below was verified against source at `d91e15e`, not inherited from the architecture-review card. Two card claims were corrected during verification: the card said index.ts/ipc.ts leak the mode fact — index.ts's 10 native-connection re-derivations (nine `nativeSelected && nativeClient`, plus the negated guard at `:128`) are about native **connection** state (shell quit/reconnect policy), a different fact the Feature runtime cannot own (see Out of scope).

## The scattered branches (evidence)

| # | Site | Lines | Mode-varying behavior |
|---|------|-------|----------------------|
| 1 | `statuses()` | `runtime.ts:63–78` | six mode ternaries: `nativeMode` (:66), installed source (:67), service-error gating (:68), state composition (:69–71), loadError precedence (:72), loaded semantics (:73–75); also emits the same fact under two keys, `error` and `loadError`, in the return expression (:76) |
| 2 | `isInstalled` / `isLoaded` | `:80`, `:82` | ternaries; native `isInstalled` falls back to settings when the snapshot has no entry |
| 3 | `syncAtLaunch()` | `:86–103` | two bodies: native = connect + double subscribe + refresh + **parallel** eager load of installed adapters (:87–97); local = **sequential** await loop (:100–102). The parallel/sequential difference is deliberate |
| 4 | `setInstalled()` | `:105–146` | two arms: native = retry detection (:110), `host.setFeatureInstalled`/`host.retryFeature` (:111), refresh, delete-then-dispose with swallow+log (:114–118), running-adapter reload (:119); local = inside `#enqueue` (:122): uninstall with **settings rollback on failed disposal** (:123–139, rollback+rethrow :133–136), install with rollback-to-uninstalled on failed load (:140–144) |
| 5 | `setActive()` | `:149–158` | mode-varying guard (:150: native checks installed only; local also checks instance-existence), shared active bookkeeping (:151–153), native-only extras: `host.setUiState` (:155) + lazy native-adapter load (:156) |
| 6 | `activate()` | `:160–169` | mode branch (:162): `#activateNative` vs local instance checks + `#host.activate` fallback |
| 7 | `openShelf()` / `toggleShelf()` | `:171–185`, `:187–202` | near-identical 15-line twins; each contains its own mode branch; differ only in which instance method they call and toggle's local `openShelf` fallback |
| 8 | `disposeAll()` | `:206–217` | native-only unsubscribe (:208–209); instance disposal is shared |
| 9 | native-only machinery | `#loadRunningNativeAdapters` :227–233, `#activateNative` :242–248, `#loadNative` :250–260, `#refreshNativeSnapshot` :262–269, `#handleNativeSnapshotChanged` :271–280, `#handleNativeConnection` :282–300, `#applyNativeHealth` :302–318, `#applyNativeSnapshot` :320–339, `#emitNativeStatus` :341 | ~110 lines of native machinery interleaved with the shared class |
| 10 | `#load` vs `#loadNative` | `:345–369`, `:250–260` | two load kernels differing only in the loader closure and whether load/register failures `console.error` (local logs; native silent) |

Also verified, deliberately **out**: `src/main/index.ts` (12 `nativeSelected` occurrences, ~10 re-derivations) — these gate native **connection** facts for shell policy (`canExitToNativeHost` :117, `preserveNativeMenuHost` :119/:188, `shouldStopNativeRuntime` :198, reconnect :135–141) — the Feature runtime cannot own connection lifecycle; `src/main/ipc.ts` `setLaunchAtLogin`/`setAppPresence` handlers (:22–45) split on `options.nativeClient` because **shell-settings ownership** differs by host mode (host owns settings in native mode, Electron caches) — a different module's seam (see Out of scope). `export type { FeatureLoader }` (`:379`) has zero importers. `FeatureStatus.error` (`src/shared/contracts.ts:28`) is a dual key of `loadError`: set only in native mode (`runtime.ts:76`), read by no renderer code (`features.tsx:34,39` read `loadError` only; no consumer anywhere in `src/` — the only pin is `feature-runtime.test.ts`, see the ledger; `contracts.ts:20` has a *different* `error?` on `ApplicationStatus` that stays), and FeatureStatus never crosses to the native host (it is the Electron→renderer contract only).

Divergence consequence today: the installed-truth fact is derived at every call site from two different sources with a settings fallback that only the native branch knows about; a status-composition bug must be fixed in `statuses()`, re-derived in `isInstalled`, and cross-checked against `isLoaded` — three copies of one concept.

## The deepened module

**New file:** `src/main/features/host-mode.ts` — the Feature mode interface, both adapters, the native event machinery, and the `LOADERS`/`NATIVE_LOADERS` tables (moved from `runtime.ts`; they are mode wiring).

```
export interface SharedFeatureState {
  instanceLoaded: boolean          // runtime: #instances.has(id)
  sessionLoaded: boolean           // runtime: #loadedThisSession.has(id)
  loadError: string | undefined    // runtime: #loadErrors.get(id)
}

/** The narrow callback surface the shared runtime machinery exposes to its mode adapters. */
export interface FeatureModeLinks {
  enqueue(id: FeatureId, operation: () => Promise<void> | void): Promise<void>  // the per-feature queue
  acquire(id: FeatureId): Promise<boolean>                                      // the unified load kernel
  instance(id: FeatureId): MoirasiaFeature | undefined
  removeInstance(id: FeatureId): void
  setInstanceActive(id: FeatureId, active: boolean): void
  loadError(id: FeatureId): string | undefined
  forgetLoadError(id: FeatureId): void
  activeId(): FeatureId | undefined
  setActive(id: FeatureId | undefined): void            // the public method; documented re-entrancy
  embeddedHost: EmbeddedFeatureHost | undefined
  onStatusesChanged(): void                            // native: fires wherever #emitNativeStatus fires today; the runtime wires it to the #statusListeners fan-out; local: never called
}

export interface FeatureMode {
  start(): Promise<void>                                                      // the two syncAtLaunch bodies, verbatim
  installed(id: FeatureId): boolean
  isLoaded(id: FeatureId, instanceLoaded: boolean): boolean
  describeFeature(id: FeatureId, shared: SharedFeatureState): FeatureStatus   // full per-feature composition
  setInstalled(id: FeatureId, installed: boolean): Promise<void>              // the two arms, verbatim
  resolveActive(id: FeatureId | undefined, instanceLoaded: boolean): FeatureId | undefined
  applyActive(id: FeatureId | undefined): void                                // native: setUiState + lazy load; local: no-op
  activate(id: FeatureId): void | Promise<void>                               // the two arms, verbatim
  shelf(action: 'open' | 'toggle'): Promise<void>                             // the collapsed twins' arms
  stop(): void                                                                // native: unsubscribe both; local: no-op
  loader(id: FeatureId): (() => Promise<{ feature: MoirasiaFeature }>) | undefined
  readonly logsAcquisitionErrors: boolean                                     // local: true; native: false
}
```

`NativeFeatureMode` owns: the `NativeHostClientLike`, `NATIVE_LOADERS` (via `options.nativeLoaders ?? NATIVE_LOADERS`), the `#nativeStatuses` map, service health (`#nativeServiceState`/`#nativeServiceError`), the snapshot/health subscriptions, `#nativeRecovery`, and `isInstalledFromSettings` fallback reads. `LocalFeatureMode` owns: the `ShellSettingsStore` installed-truth, `LOADERS` (via `options.loaders ?? LOADERS`), and the settings writes. The runtime keeps and owns: `#instances`, `#loadedThisSession`, `#loadErrors`, the `#enqueue` per-feature serialization queue, `#active`, `#setInstanceActive`, the unified `#acquire` kernel (loader closure from `mode.loader(id)`, `register(context)` with rollback dispose, `#loadErrors` recording, `console.error` gated on `mode.logsAcquisitionErrors`), and the `#featureIds` list (`Object.keys(options.loaders ?? LOADERS)` — exactly today's iteration domain), plus `#operations` (the queue's pending promises, awaited by `disposeAll`), `#statusListeners` (the fan-out behind `subscribe`, driven by `onStatusesChanged`), `#host`, and `#context`.

Interface invariants (these *are* the depth):

- **Arms move verbatim.** Each adapter method is the corresponding mode arm of today's branch, byte-for-byte — including enqueue placement (native `setInstalled` does *not* enqueue the host request; local wraps in `links.enqueue`), disposal-error policy (native deletes the instance first and swallows+logs; local rolls the settings write back and rethrows), and load ordering (`syncAtLaunch`'s parallel-vs-sequential difference).
- **Single writer.** Adapters never mutate runtime state except through `links`; the runtime is the only writer of `#instances`, `#loadErrors`, `#active`. Re-entrancy exists today (`activate → setActive → native extras`; adapter `activate` → `links.setActive` → `applyActive`) and is preserved, not introduced.
- **Status composition has one shape.** `statuses()` = `#featureIds.map((id) => mode.describeFeature(id, { instanceLoaded, sessionLoaded, loadError }))`. Each adapter composes from its own state plus the shared facts; the runtime never branches on mode.
- **`setActive` order is pinned:** resolveActive guard → assign `#active` → `host.setActive` → instance-callback loop → `applyActive` extras. Today's order (:150–157) preserved exactly.
- **Native payload validation moves, unchanged.** `#applyNativeSnapshot`'s acceptance rules (partial-payload tolerance, `expected` = loader keys, reject-on-unknown-entry, all-expected-present) move verbatim into `NativeFeatureMode`. Tightening to `completeNativeFeatureStatusSchema` is **out of scope**: the schema requires the full envelope (version/revision/settings) and all three features, while the runtime must keep accepting the looser legacy partial payloads the tests emit — tightening is a behavior change (see Out of scope).
- **Reconnection stays native-side.** `#handleNativeConnection`'s disconnect/reconnect/recovery guard (`#nativeRecovery`) moves wholesale; the adapter reports status changes through an `onStatusesChanged: () => void` callback the runtime wires to its listener fan-out. Local mode never calls it — preserving today's behavior where local status changes surface only via command-returned snapshots.

**Deletion test:** delete `host-mode.ts` and the 22 `#nativeClient` sites, the shelf twins, both two-body methods, and ~110 lines of native machinery reappear inside `FeatureRuntime`, with the installed-truth concept re-derived at every site. Complexity concentrates — the seam earns its keep. Conversely the adapters are not pass-throughs: each hides a real body (native ≈ 150 lines with event machinery; local ≈ 70 with rollback semantics).

**Seam placement:** the seam sits between the runtime's shared machinery (what every mode needs: instances, serialization, error bookkeeping, active tracking) and the two executions of "who owns installed-truth and how features load and report". Two real adapters justify it — native mode (Feature host owns persistent state) and local mode (Electron owns everything) are both shipped production paths selected at startup by `index.ts`. The outer `NativeHostClientLike` port keeps its own adapters (production client, test fakes); the mode seam does not duplicate it.

## Behavior-preservation ledger (checked, not assumed)

- **`syncAtLaunch` parallelism**: native eager-loads with `Promise.all` across features (:93–97), local awaits sequentially (:100–102). The adapters keep their own `start()` bodies; the shared loop is *not* extracted across modes.
- **Disposal error policies differ by mode and stay different**: local uninstall re-enables the setting and rethrows on disposal failure (:133–136 — the retryable-uninstall behavior pinned by `tests/feature-runtime.test.ts` 'keeps a failed disposal installed'); native deletes the instance first and swallows+logs (:114–118). Each adapter keeps its own.
- **`setActive` re-entrancy**: `#activateNative` calls `setActive(id)` (:246), which in native mode issues `host.setUiState` and lazy-loads; adapter `activate` → `links.setActive` → `applyActive` preserves this exactly.
- **`isInstalled` settings fallback in native mode** (`:80`): when the snapshot has no entry, settings decide. The native adapter receives the settings store for this fallback.
- **`#loadedThisSession`** is written by the unified `#acquire` for both modes (today both kernels write it, `:259` and `:366`) and read only by local `describeFeature` (loaded semantics, :73). Native `loaded` derives from instance presence + service state (:73–74), ignoring the session set.
- **Feature-id domain** stays `Object.keys(options.loaders ?? LOADERS)` — today's `statuses`/`hasInstalledFeatures`/`syncAtLaunch`/`#loadRunningNativeAdapters` all iterate it; adapters receive the list.
- **`FeatureStatus.error` trim** is the one intentional contract change: `error` is dropped from `FeatureStatus` (`contracts.ts:28`, not the `error?` on `ApplicationStatus` at `:20`, which stays) and from native `describeFeature`. Renderer reads `loadError` only; no test outside `feature-runtime.test.ts` pins `error` (verified: `shell-renderer.test.tsx:91` pins `loadError`; `contracts.test.ts` pins catalogs only). The 'overlays service health' test's `error: 'service exited'` assertion becomes `loadError: 'service exited'`, and its closing `.not.toHaveProperty('error')` becomes `.not.toHaveProperty('loadError')`.
- **`setInstalled` completion semantics stay synchronous-to-persistence**: local uninstall disposes the instance before resolving; local install loads before resolving. No eventual-facts reconciliation.
- **`relaunch()`** stays `app.relaunch(); app.exit(0)` (`:204`) — no mode involvement; no `restartHost` verb is invented.
- **`narrow()`** stays runtime-side: the public `setInstalled`/`activate` still take `ApplicationId` and narrow (`:106`, `:161`).

## Migration of call sites

| Runtime member | Becomes |
|---|---|
| `statuses()` :63–78 | `#featureIds.map((id) => this.#mode.describeFeature(id, …))` — one line |
| `isInstalled` :80 / `isLoaded` :82 | `this.#mode.installed(id)` / `this.#mode.isLoaded(id, this.#instances.has(id))` |
| `hasInstalledFeatures()` :81 | `#featureIds.some((id) => this.#mode.installed(id))` |
| `syncAtLaunch()` :86–103 | `await this.#mode.start()` — the two bodies move into the adapters |
| `setInstalled()` :105–146 | `return this.#mode.setInstalled(narrow(id), installed)` |
| `setActive()` :149–158 | resolveActive → assign → `host.setActive` → instance loop → `applyActive` (five shared lines, zero mode conditionals) |
| `activate()` :160–169 | `return this.#mode.activate(narrow(id))` |
| `openShelf()` :171–185 / `toggleShelf()` :187–202 | both become `#shelf('open' \| 'toggle')` → `#enqueue('amove', () => this.#mode.shelf(action))` — the twins delete |
| `disposeAll()` :206–217 | `this.#mode.stop()` replaces :208–209; the rest unchanged |
| `#load` :345–369 + `#loadNative` :250–260 | one unified `#acquire(id)` (loader closure from `mode.loader(id)`, logging gated on `mode.logsAcquisitionErrors`) |
| `#loadRunningNativeAdapters` :227–233 and `#refreshNativeSnapshot`/`#handle*`/`#applyNative*`/`#emitNativeStatus` :262–341 | move whole into `NativeFeatureMode` |
| `#activateNative` :242–248 | moves into `NativeFeatureMode.activate` |
| constructor :50–61 | same signature; constructor body builds `links` and picks the adapter: `options.nativeClient ? new NativeFeatureMode(…) : new LocalFeatureMode(…)` |
| `export type { FeatureLoader }` :379 | deleted (zero importers); the type moves to `host-mode.ts` |

`index.ts`, `application-controller.ts`, `ipc.ts`, `ui-command-router.ts`: untouched. The public interface, the constructor signature, and every caller survive unchanged.

## Tests

**Survive unchanged:** all 22 tests in `tests/feature-runtime.test.ts` — they construct through the unchanged constructor signature and assert public behavior; the fake `NativeHostClientLike` and tmpdir `ShellSettingsStore` injections land on the adapters exactly as they landed on the branches. Two assertions in one existing test ('overlays service health') update for the `error`-key trim.

**New gap tests (same file, through the public interface — the adapters are internal seams and are not tested past the interface):**

1. Native connection events: fake client with `subscribeConnection` — disconnect ⇒ `statuses()` show `state: 'error'` with the connection error; reconnected ⇒ recovery refresh restores snapshot state.
2. Native retry: uninstall-then-reinstall over a failed state requests `host.retryFeature`, not `host.setFeatureInstalled`.
3. Native active reporting: `activate`/`setActive` issue `host.setUiState` with the page id; clearing sends `'general'`.
4. Native uninstall-while-active clears the active feature.
5. Local shelf fallbacks: a feature without `openShelf` falls back to `activate`; `toggleShelf` falls back to `openShelf` before `activate`.
6. Local activate fallback: loaded feature without `activate` delegates to `EmbeddedFeatureHost.activate`; unloaded feature throws the 'not loaded' error.
7. `disposeAll` unsubscribes the native subscriptions exactly once and is idempotent.
8. Local uninstall rollback: extend the existing 'keeps a failed disposal installed' test with its statuses assertion (installed flips back to `true`) — an assertion addition, not a new test.

Expected total: **271 passed** (264 + 7 new; the `error`-trim updates assertions of one existing test in place).

## CONTEXT.md update

Sharpen the **Feature runtime** term and add a **Feature mode** term under Terms:

> **Feature mode** — native mode or local mode; the two executions of the Feature runtime. A `NativeFeatureMode` adapter owns the authenticated native client, snapshot and health ingestion, and host-mediated install; a `LocalFeatureMode` adapter owns installed-truth in the Shell settings store and local loaders. Selected exactly once at Feature runtime construction; the adapters own every mode-varying behavior behind the runtime's unchanged interface.

> **Feature runtime** — `src/main/features/runtime.ts`; selects one **Feature mode** adapter at construction and owns the shared machinery: loaded instances, the per-feature serialization queue, load errors, and active-feature tracking. It presents one mode-agnostic interface; mode facts are never re-derived per method. It never loads a local controller after native mode is selected — the selection is structural, not a branch.

## Execution steps (root repo)

1. **Create `src/main/features/host-mode.ts`** with the interface, both adapters, the moved native machinery, and the loader tables — arms verbatim, `FeatureModeLinks` wired in `FeatureRuntime`'s constructor body. No callers changed yet. Verify: `pnpm typecheck`.
2. **Rewire `runtime.ts`** per the migration table; delete the 22 `#nativeClient` sites, the twins, both load kernels (→ `#acquire`), and the native machinery; trim `export type { FeatureLoader }`; trim `FeatureStatus.error` from `contracts.ts` and update the two pinned assertions ('overlays service health'). Verify: `pnpm typecheck` + `pnpm exec vitest run tests/feature-runtime.test.ts`.
3. **Add the seven gap tests** (plus the assertion extension from item 8). Verify: `pnpm exec vitest run tests/feature-runtime.test.ts` (expect 29 passed in the file: 22 surviving + 7 new).
4. **Full check:** `pnpm typecheck`, `pnpm test` (expect **271 passed / 35 files**), `pnpm build:app`. `rg -n "#nativeClient|#nativeStatuses|#refreshNativeSnapshot|#applyNative|#handleNative|#loadRunningNativeAdapters|#loadNative|FeatureLoader" src/main/features/runtime.ts src/shared/contracts.ts` → the moved names live only in `host-mode.ts`: runtime.ts is clean for every `#native*` pattern, with `FeatureLoader` remaining only as the type import in the unchanged constructor options (the `:379` re-export is deleted); `contracts.ts` is clean.
5. **Update `CONTEXT.md`** with the two terms. Verify: `git status` clean after commits.

Commit messages: `refactor: own the feature host mode in one module` (steps 1–3 fold into it — the intermediate state adds no review value for a behavior-preserving move), then `docs: sharpen the Feature runtime term`.

## Out of scope

- `index.ts`'s native connection policy (reconnect, `willQuit`, `quitSuite`, menu-host preservation) — it owns a different fact (connection state, not feature mode); reshaping it is a separate candidate.
- `ipc.ts`'s shell-settings split (`setLaunchAtLogin`/`setAppPresence`) — shell-settings ownership across host modes is its own seam; giving the Feature runtime those methods would widen its interface with a responsibility it does not own.
- Tightening `#applyNativeSnapshot` to the zod schemas (`completeNativeFeatureStatusSchema` requires the full envelope and all three features; the runtime must keep accepting looser legacy partial payloads). The parser moves verbatim; tightening is a behavior change to decide separately.
- `feature-catalog`/`feature-resources`/`EmbeddedFeatureHost`/`suite-context` — already deep or out of the seam's path.
- Renderer code and `FeatureStatus`'s remaining shape (`features.tsx` reads `installed`, `loaded`, `restartPending`, and `loadError`; it never reads `state` — `state` is emitted only in native mode and pinned by the `feature-runtime.test.ts` status assertions, so trimming it would be a second behavior change).
- Architecture-review candidates 2–7 (Snapshot composer, command contract, single-flight queue, Bonded renderer view-model, the small deletions) — separate deepenings; the mode seam is not their surface.