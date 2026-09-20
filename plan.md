# Implementation plan: the Enforcement policy module

## Decision

Architecture-review candidate 1 (Enforcement policy), finalized. One deep module owns the blocking-state transitions in Bonded: the startup reconciliation of a stale persisted blocking flag, applying selections to the PF firewall, failing open when the helper is unavailable, rolling back settings/firewall/learned addresses on failure, and keeping the firewall's target list in sync with newly learned addresses. Today those five transition shapes live inline in the Controller across nine sites with three different persist-or-swallow policies and two hand-rolled rollback layers. After this change there is one interface with one test surface, and enforcement bugs have locality.

Terminology follows `CONTEXT.md` and the codebase-design vocabulary: the new module is the **Enforcement policy module**; the Controller remains the wiring (mutation-queue ordering, snapshot publishing, monitor lifecycle) and the firewall adapter, settings-store, and Observed-IP blocker stay exactly where they are. No new seam is invented: the module is in-process, and its two real adapters at the firewall seam (the `FakeFirewallClient` that e2e selects via `BONDED_FAKE_FIREWALL=1` and that the new module tests will use, vs the real `FirewallClient` in prod) already exist on either side of it.

## Verified baseline

Repository root: `/Users/mac/Syncthing/Projects/Moirasia`, tip `c92f425 docs: plan the Application identity module`. Nested Bonded repo: `apps/integrated/Bonded`, branch `main`, tip `fa73046 fix: match bundle-keyed rules by bundle identity`. Both worktrees clean as of this plan apart from this file itself (`plan.md` is modified — it is this document, replacing the committed Application identity plan in place). The Application identity module (`src/main/application-identity.ts`) is freshly landed and deep; this plan does not re-litigate it and does not touch it. `plan.md` in the repository root held the completed Application identity plan and has been replaced in place by this file.

Vocabulary sources read: root `CONTEXT.md` (no "Enforcement" term exists yet — this plan adds one, see "CONTEXT.md update"); no ADR directory exists at root or under `apps/integrated/Bonded`; no ADR conflicts. `docs/architecture/standalone-applications.md` is untouched: this plan moves no launch/mode/lease decision. Native mode is unaffected: the native feature service (`native-feature.ts`) owns its own state in native mode, and `feature.ts` wires `BondedController` only for the embedded/local host — the Enforcement module is therefore local-mode only by construction.

Vitest baseline at `fa73046`: 90 passed / 1 skipped across 23 files (the skipped file is `tests/real-nettop.integration.test.ts`); playwright 2 passed / 2 packaged skipped.

## The scattered transitions (evidence)

| # | Site | Behavior |
|---|------|----------|
| 1 | `controller.ts:55–66` (`start`) | stale persisted blocking cleared and **required-persisted** (:58–61); firewall initialized, then an *active* firewall reconfigured to `(false, [])` (:63) |
| 2 | `controller.ts:127–138` (`uninstallFirewallHelper`) | sync canceled (:129), hard `configure(false, [])` (:130), disable + **required-persisted** save (:131–132), then helper uninstall |
| 3 | `controller.ts:147` (`setBlocking` → `commitSettings`) | cancel sync, configure **only if enforcement changed**, save, adopt; on failure: reconfigure previous targets, on second failure disable previous + **best-effort** save, restore settings, rethrow |
| 4 | `controller.ts:153–175` (`selectObservedApplication`) and `:176–196` (`removeApplicationRule`) | hand-rolled `exportState()`/`restore()` around the mutation plus `previousTargets` captured pre-mutation, feeding `commitSettings`; the catch restores the blocker **after** commitSettings has already restored settings + firewall |
| 5 | `controller.ts:252–258` (`acceptFirewallStatus`) | helper no longer active while `blockingEnabled` ⇒ disable + **best-effort** persist, then scheduleSnapshot |
| 6 | `controller.ts:230–250` (`commitSettings`), `:284–299` (`scheduleFirewallSync`/`cancelFirewallSync`), `:301–311` (`reconfigureAfterObservation`) | the debounced (150 ms) reconfigure to current blocker targets; on failure `configure(false, [])` swallowed, then **unconditional** disable + best-effort save |
| 7 | `controller.ts:212–228` (`stop`) | in-memory disable, `disconnect` (error surfaced last), best-effort save, `clearLearned` — disposal orchestration |

Also related: `controller.ts:105–117` (`setMonitoring`) and `:198–210` (`restartMonitor`) persist settings without touching enforcement — deliberately **not** routed through the transaction today (no `cancelFirewallSync`, no configure); routing them through `apply` would change behavior (a pending sync would be canceled) for no benefit. `tests/controller.test.ts` has 2 tests (startup stale-clear + snapshot metadata); no unit test exercises `commitSettings`, `acceptFirewallStatus`, the selection rollback, or the sync debounce. e2e (with `BONDED_FAKE_FIREWALL=1`) reaches the happy-path dances — selection, blocking toggle, the debounced sync, shutdown disable — but the fake firewall never rejects, so no automated test exercises any failure path; the rollback dances are covered by the new module tests only.

Divergence consequence today: the "disable and persist" fact exists in six sites with two persistence strengths (required at :60 and :132; best-effort at :243–244 rollback-internal, :255–256, :307–309, and stop's :219/:222) — this plan consolidates four of them (:60, :243–244, :255–256, :307–309) and deliberately keeps the uninstall teardown and stop's disposal; the rollback ordering exists in three sites (commitSettings internal, two selection catches). A bug in any one copy stays invisible until a firewall failure, and the fix must be re-derived at each site.

## The deepened module

**New file:** `apps/integrated/Bonded/src/main/enforcement.ts`

```
Interface (all exports; no Electron, no fs, no clock of its own — timers via the runtime):
  interface EnforcementOptions {
    firewall: FirewallClientLike
    store: { save(settings: BondedSettings): Promise<void> }        // structural: the real SettingsStore fits
    blocker: ObservedIpBlocker
    getSettings: () => BondedSettings                               // the Controller keeps owning the settings object
    setSettings: (next: BondedSettings) => void                     // adopt-after-commit hook
    enqueue: <T>(operation: () => Promise<T>) => Promise<T>         // the Controller's mutation queue
  }
  class Enforcement {
    constructor(options: EnforcementOptions)
    reconcile(): Promise<void>
    apply(next: BondedSettings, mutateBlocker?: (blocker: ObservedIpBlocker) => void): Promise<void>
    failOpen(): Promise<void>
    scheduleSync(): void
    cancelSync(): void
    dispose(): void
  }
```

Interface invariants (these *are* the depth; all hidden from callers):

- `apply` is a transaction. It captures the settings clone, the blocker's `exportState()`, and `blocker.targets()` **before** running `mutateBlocker`; it then cancels the pending sync, configures the firewall only when enforcement changed (`previous.blockingEnabled || next.blockingEnabled` — exact call `configure(next.blockingEnabled, next.blockingEnabled ? blocker.targets() : [])`, targets from the post-mutation blocker), saves, and adopts the new settings **last**. On any failure — blocker mutation, configure, or save — the blocker state, the previous firewall configuration (captured targets, not post-mutation ones), and the previous settings are restored in that order, and the original error is rethrown. A blocker-mutation failure rolls back before anything is configured or persisted. The firewall restore and its fail-open fallback run **only when the forward path configured the firewall** (enforcement changed), with the exact call `configure(previous.blockingEnabled, previous.blockingEnabled ? capturedTargets : [])` — a save-only failure with unchanged enforcement restores the blocker and settings and issues **no** firewall call, as today's catch does (`:239` gate).
- If the firewall rollback itself fails, the transaction fails open: blocking is disabled in settings and persisted **best-effort** before the error rethrows. This is today's nested catch in `commitSettings`, unchanged. In all three fail-open shapes — this nested catch, `failOpen()`, and the sync kernel — the disabled settings end up adopted **regardless of the save outcome** (today `:243–244`, `:254–256`, `:307–309` all leave the disabled settings in `this.settings` whether or not the save succeeded). Adopting only after a successful save would leave `blockingEnabled` true in memory while the helper is unreachable, and blocking would resume the next time the status listener saw `active` — a behavior change.
- `failOpen` is the status-driven shape: it acts only when `firewall.status().state !== 'active'` and blocking is enabled. The sync-failure path uses the **unconditional** internal kernel `disablePersistBestEffort()` instead — today's `reconfigureAfterObservation` catch disables regardless of the reported status, and a `configure` that throws before updating its status must still fail open. Merging these two gates would be a behavior change; the plan pins them apart.
- `reconcile` = startup reconciliation: clear a stale persisted `blockingEnabled` and **required-persist** the save (errors propagate, as today), then `firewall.initialize()`, then configure an *active* firewall to `(false, [])` — that configure's errors also propagate (today's `:63` is an uncaught `await`; a failure fails `start()` and the feature registration). Calling it replaces the two start-up dances; the Controller keeps load/monitor/publish.
- `scheduleSync` debounces (150 ms, as today) a reconfigure to the blocker's current targets through the injected `enqueue`; on failure it configures `(false, [])` swallowed and then runs the unconditional disable kernel (adopt the disabled settings, then persist best-effort and swallow — today's `reconfigureAfterObservation` catch). `cancelSync` is idempotent; `dispose()` = `cancelSync` + stop scheduling for the module's lifetime. The timer is a real `setTimeout`; tests use fake timers.
- No I/O beyond the injected collaborators, no snapshot scheduling, no Electron.

**Deletion test:** delete this module and the seven sites above reappear in the Controller, plus two rollback owners (commit-internal and selection-catch) whose ordering contract lives only in a comment. Complexity concentrates — it earns its keep.

**Seam placement:** the seam sits between the Controller's *decisions* (when to block, when to reselect) and the *transitions* (how blocking state lands on the firewall, disk, and blocker). The firewall seam is real — two adapters already exist (real helper client in prod, `FakeFirewallClient` in e2e and the new module tests). The store and blocker are in-process collaborators, injected, not seam-justified on their own.

**What deliberately stays out:** helper install/uninstall (`controller.ts:119–138` — the uninstall site keeps its own dance: single site, uninstall-specific ordering, required persistence, and the firewalled-`state === 'active'` condition that `apply` would not reproduce); `stop()`'s disposal orchestration (`:212–228` — error-surfacing ordering is shutdown-specific); `setMonitoring`/`restartMonitor` saves (routing them through `apply` would cancel a pending sync — a behavior change with no payoff); the mutation queue itself (injected); snapshot publishing; sample ingest (architecture-review candidate 3); the native adapter; `firewall-client.ts` itself (its status/retry semantics are already owned there).

## Behavior-preservation ledger (checked, not assumed)

- **fail-open gating**: `reconfigureAfterObservation`'s catch disables unconditionally; `acceptFirewallStatus` gates on `state !== 'active'`. Verified distinct: a `configure` throw can occur before the client updates its status (e.g. socket connect failure), leaving a stale `'active'` status — a merged gate would skip the disable. The plan keeps an internal unconditional kernel for the sync-failure path and the gated `failOpen()` for the status listener.
- **setMonitoring/restartMonitor** are *not* migrated: `apply` would cancel a pending sync they do not cancel today. Plain saves stay plain.
- **uninstall** is *not* migrated: its save is required (not best-effort) and its configure is gated on `settings.blockingEnabled || firewall.status().state === 'active'` — conditions `apply` does not express. Only its `cancelFirewallSync()` becomes `cancelSync()`.
- **pre-commit blocker mutations**: `ObservedIpBlocker.addRule` is throw-clean before mutating (the `MAX_APPLICATION_RULES` throw precedes `rules.set`). `addApplicationIfMissing`'s own MAX throw cannot in fact fire after a successful `addRule` today — settings and blocker rule counts move in lockstep (both deduped from the same parse-validated list, both capped at 256, mutated only in pairs), so a successful `addRule` implies `settings.applicationRules.length < 256`. The boundary must not lean on that invariant: the reachable rollback case is the configure/save failure, which must restore **pre-mutation** blocker state (learned addresses and targets), and the transaction can only guarantee that if it captures state before the mutation runs. Therefore the controller passes the blocker mutation **as the callback**, and `addApplicationIfMissing` runs inside the same closure, preserving today's rollback boundary exactly.
- **blocker restore is idempotent**: `exportState()`/`restore()` round-trips rules, addresses, and `limitReached`; double-restore (commit-internal + none remaining) is safe — the controller's two `restore()` calls are deleted, not duplicated.
- **firewall targets on rollback** must be the pre-mutation targets (rolling back to post-mutation targets would leave newly learned addresses blocked while the settings say unselected). Captured inside the transaction at entry — the caller-visible `previousTargets` parameter disappears.
- **rollback restore order inside `apply` is blocker → firewall → settings**, whereas today's interleaving is firewall → settings inside `commitSettings` with the blocker restored in the caller's catch. Deliberate and observationally equivalent: the blocker restore is synchronous and emits nothing, the rollback configure uses the captured pre-mutation targets rather than the live blocker, and queued operations (status events, the sync timer) cannot run mid-transaction — the only mid-transaction observer is a snapshot from the snapshot timer during the rollback await, which would transiently see pre-mutation targets where today it sees post-mutation ones. End states are identical.
- **adoption order**: `setSettings(next)` runs after a successful save (today: `this.settings = next` inside the try) — unchanged.
- **no behavior change elsewhere**: `getSnapshot`, snapshot scheduling, and `setBlocking`'s precondition errors (rules empty / no traffic / helper missing) stay byte-identical.

## Migration of call sites

1. **`start()`** (`:55–66`) — replace `:58–61` and `:62–63` with `await this.enforcement.reconcile()` (the module owns `firewall.initialize()`; the Controller keeps load, blocker load, monitor start, publish).
2. **`setBlocking()`** (`:139–152`) — preconditions stay; the body becomes `await this.enforcement.apply(next)`; publish/return unchanged.
3. **`selectObservedApplication()`** (`:153–175`) — delete `previousBlocker`/`previousTargets`/try/catch; become `await this.enforcement.apply(next, (blocker) => { blocker.addRule(rule, this.history.addresses(applicationId)); if (!existing) addApplicationIfMissing(next, rule) })`.
4. **`removeApplicationRule()`** (`:176–196`) — same shape; the splice `next.applicationRules.splice(index, 1)` stays before the call: `apply(next, (blocker) => { blocker.removeRule(applicationRuleId); if (next.blockingEnabled && blocker.targets().length === 0) next.blockingEnabled = false })`.
5. **`acceptFirewallStatus()`** (`:252–258`) — body becomes `await this.enforcement.failOpen(); this.scheduleSnapshot()`.
6. **`acceptSample()`** (`:275`) — `this.scheduleFirewallSync()` becomes `this.enforcement.scheduleSync()`; **`scheduleFirewallSync`/`cancelFirewallSync`/`reconfigureAfterObservation`/`commitSettings` deleted** (`:230–250`, `:284–311`); the `firewallSyncTimer` field deleted.
7. **`stop()`** (`:212–228`) — `cancelFirewallSync()` at `:216` becomes `this.enforcement.dispose()`; everything else unchanged (deliberate).
8. **`uninstallFirewallHelper()`** (`:127–138`) — only `cancelFirewallSync()` at `:129` becomes `cancelSync()`; the rest stays (deliberate, see ledger).
9. **Constructor** — one new field `private readonly enforcement: Enforcement`, **assigned in the constructor body** after `this.firewall` and `this.store` exist (a field initializer would run before both): `this.enforcement = new Enforcement({ firewall: this.firewall, store: this.store, blocker: this.observedIpBlocker, getSettings: () => this.settings, setSettings: (next) => { this.settings = next }, enqueue: (operation) => this.queueSettingsMutation(operation) })`.

`setMonitoring`/`restartMonitor` keep their plain saves. The Controller loses ~60 lines and keeps every decision.

## Tests (new module = new test file)

**New:** `apps/integrated/Bonded/tests/enforcement.test.ts`, through the module's interface only — a firewall double — `FakeFirewallClient` from `@main/firewall-client` for happy paths (it cannot reject `configure` on demand), plus a scripted double for the failure-path tests, a stub `{ save }` store whose save can be made to reject, a **real** `ObservedIpBlocker` (pure, in-memory), accessor closures over a local settings variable, and an `enqueue` that just runs the operation (plus a serializing variant to prove ordering):

- `apply` happy path: configure called with post-mutation targets when enforcement changes; save called; settings adopted via `setSettings`.
- `apply` skips configure when enforcement is unchanged (false → false) and still saves.
- `apply` rollback: first `configure` rejects ⇒ reconfigure with captured pre-mutation targets; settings restored; blocker restored (the selection-flow regression pin); error rethrown.
- `apply` with unchanged enforcement (false → false) and a rejecting save ⇒ no configure call at all (forward or rollback), blocker state and settings restored, error rethrown.
- `apply` fail-open: rollback `configure` also rejects ⇒ blocking disabled, **adopted even though the save rejects**, best-effort persisted; original error still rethrown.
- `apply` with `mutateBlocker` throwing ⇒ blocker restored, no configure, no save, no settings adoption, error rethrown.
- `failOpen`: status inactive + enabled ⇒ disabled, adopted even when the save rejects, best-effort saved; status active ⇒ untouched; save rejection swallowed.
- `reconcile`: stale persisted `blockingEnabled` cleared and required-persisted; `initialize` awaited; active firewall ⇒ `configure(false, [])` with errors propagating; otherwise untouched.
- `scheduleSync`/`cancelSync`/`dispose` (vitest fake timers): fires once after 150 ms through `enqueue`; failure path configures `(false, [])` swallowed then adopts the disabled settings and persists best-effort (unconditional, even if the status is stale, even if the save rejects); guards on disabled/enqueued-twice; `cancelSync`/`dispose` prevent the pending fire.

**Updated:** `tests/controller.test.ts` — the two existing tests keep passing untouched (they exercise the Controller's interface through a firewall double, unchanged). Add one regression: with blocking enabled on the selected fixture application (its address learned from the fixture sample, `setBlocking(true)` succeeding), a `removeApplicationRule()` whose firewall `configure` rejects must leave the rule, its learned address, and `blockingEnabled: true` intact in the settings file and the snapshot — the transaction rolled the removal back. Constraint to know up front: the fixture resolver resolves every sample to `/usr/bin/curl`, so a controller test can only ever see one application; a *selection* whose `configure` fails while blocking is enabled is therefore reachable only as a re-selection of the already-selected application, whose blocker rollback is observationally a no-op — the removal flow is the reachable one with an observable rollback delta (proves the wiring, not the policy — the policy is pinned in the enforcement tests). The double must reject only the removal's `configure(false, [])` and let the rollback `configure(true, …)` succeed, or the transaction fails open and the assertions change.

**Test surface statement:** transition policy is tested only through the Enforcement module's interface; the Controller tests keep lifecycle wiring plus the one wiring-level rollback regression above. No test reaches past the interface under test.

## CONTEXT.md update

Add to root `CONTEXT.md` under Terms:

> **Enforcement** — `apps/integrated/Bonded/src/main/enforcement.ts`; owns the blocking-state transitions: the startup reconciliation, applying selections to the PF firewall, failing open when the helper is unavailable, and rolling back settings, firewall configuration, and learned addresses on failure. The controller decides when transitions happen; Enforcement owns how they land.

## Execution steps (nested repo `apps/integrated/Bonded` unless noted; steps 1–2 share one commit — see Commit messages)

1. **Add the module + tests, no consumers moved.** `enforcement.ts` + `enforcement.test.ts` green. Verify: `pnpm -C apps/integrated/Bonded exec vitest run tests/enforcement.test.ts`.
2. **Migrate the Controller** per the table; delete the five dance shapes; add the controller-level rollback regression. Verify: `tsc --noEmit -p tsconfig.json` + focused `vitest run tests/controller.test.ts tests/enforcement.test.ts`.
3. **Full nested check:** `pnpm -C apps/integrated/Bonded typecheck`, full `vitest run` (expect ≥ 100 passed / 1 skipped — +10 enforcement tests, +1 controller regression over the 90 baseline), `build:renderer`, full `playwright test` (2 passed, 2 packaged skipped).
4. **Update root `CONTEXT.md`** with the Enforcement term. Verify: root `pnpm typecheck`, root `pnpm test` (expect 264 passed).
5. **Status check:** both repos clean after commits; no leftover `commitSettings`/`reconfigureAfterObservation`/`scheduleFirewallSync`/`cancelFirewallSync`/`firewallSyncTimer` references (`rg` clean; `acceptFirewallStatus` survives by design as the two-line status-listener shim delegating to `failOpen`, so it is deliberately not in this list; `failOpen`-shaped comment swallows live only in the module).

Commit messages: `refactor: own blocking enforcement in one module` (steps 1–2 fold into it: the intermediate state adds no review value for a behavior-preserving move), then root `docs: add Enforcement term`.

## Out of scope

- Architecture-review candidates 2–5 (Snapshot composer, Sample ingest, command contract, single-flight queue) — separate deepenings; the Enforcement module is not their seam.
- Helper install/uninstall lifecycle and `stop()`'s disposal sequence — single-site orchestration with deliberate error-surfacing order; moving them adds interface without removing duplication.
- The native feature adapter (`native-feature.ts`) — native mode owns its own state; untouched.
- `firewall-client.ts` — its status/retry/socket semantics stay; only the *policy* around it deepens.
- Renderer code — the snapshot contract is untouched.