# Implementation plan: deepen the embedded feature lifecycle

## Decision

Implement architecture-review candidate 1 for the four adapters that repeat the same outer surface lifecycle:

- Bonded local: `apps/integrated/Bonded/src/main/feature.ts`
- Bonded native: `apps/integrated/Bonded/src/main/native-feature.ts`
- Shout local: `apps/integrated/Shout/src/main/feature.ts`
- Shout native: `apps/integrated/Shout/src/main/native-feature.ts`

Add one deep module at `packages/desktop-shell/src/feature-lifecycle.ts`. Its interface remains the existing `MoirasiaFeature` contract. A small registration adapter supplies product-owned setup and cleanup to the module. The implementation owns the common outer lifecycle:

1. exact context and host-mode validation before side effects;
2. one registration in flight at a time, preserving the existing Bonded/Shout local guard;
3. feature-surface acquisition and local readiness;
4. reverse-order rollback after partial registration;
5. activation only after a successful registration;
6. exhaustive, reverse-order, idempotent disposal;
7. a fresh registration after disposal.

Do not add cross-operation scheduling inside this module. Local Feature runtime operations use `FeatureRuntime.#enqueue`, `disposeAll()` waits for queued operations, and `runStandaloneLaunch` waits for registration before disposal. Native uninstall can overlap an acquisition before the runtime publishes an instance, but then it has no feature object to dispose; a scheduler inside that unpublished object cannot fix the runtime race. No current caller invokes `dispose()` on the same feature object while its `register()` is pending. Handling that case, `register()` during disposal, or shared concurrent-disposal promises here would solve call patterns no current consumer can produce. The existing adapters do not consistently support those races.

Product adapters continue to own product facts: controllers, command validation, native snapshot decoders, IPC channel lists, Runtime lease names and errors, updater repositories, and Bonded's renderer-process exclusion. The shared module does not learn Bonded or Shout command semantics.

One supporting correction is required at the cleanup boundary. The lifecycle can continue after an owned IPC disposer throws, but both local `registerIpc` functions currently stop inside that disposer if snapshot unsubscribe throws, and their registration catch omits snapshot unsubscribe if updater setup fails. `registerGitHubUpdaterIpc` also leaves its handlers installed if `updater.subscribe` throws. Harden these existing registrars in place; do not pull their channel-level resources into the lifecycle module.

Amove stays out of this refactor. Its local `AppController` owns the Feature surface and its native adapter owns an Electron shelf, UI-state reporting, and two-renderer IPC. Pulling those differences into the first version would enlarge the interface before a second matching adapter proves the need. This keeps the change aligned with the review card, whose before diagram identified the four Bonded/Shout modules rather than all six feature adapters.

## Grilling decisions

The user pre-approved the recommended answer to every clarification question. The settled design tree is:

| Decision | Recommended answer used by this plan | Reason |
|---|---|---|
| Scope | Bonded and Shout, local and native | These four adapters contain the demonstrated duplication. |
| Amove | Exclude | Shelf and custom controller ownership would force speculative hooks. |
| Seam | Keep `MoirasiaFeature` between Feature runtime and product adapters | It is already the real seam. Adding another lifecycle port would duplicate it. |
| Shared ownership | Registration state, Feature surface, local readiness, rollback, activation, disposal | These outer lifecycle facts repeat and currently drift. Native adapters are suite-only, so their surface `ready()` is a no-op. |
| Product ownership | Controllers, Runtime leases, updater repository facts, IPC channels, decoders, validation | These facts vary by product and stay local. |
| Cleanup model | Register cleanup functions with one owned LIFO scope | One primitive hides rollback and disposal without a callback bag. |
| Concurrency | Preserve single-flight `register()`; do not schedule unlike operations | Bonded/Shout local already suppress duplicate in-flight registration. Production callers serialize registration and disposal, so a second scheduler here would duplicate their responsibility. |
| Error policy at registration | Preserve the original registration error after best-effort rollback | Native adapters already do this. Local cleanup can currently replace the startup error if an earlier synchronous cleanup throws, so this is a deliberate correction. |
| Error policy at disposal | Attempt every cleanup, then throw the first cleanup error | Matches the strongest existing adapters and prevents a failed cleanup from leaking later resources. |
| Cleanup retry | Do not retry an already-attempted cleanup on a second `dispose()` | Existing adapters clear references before cleanup, and both controllers mark themselves disposed before operations that can reject. The runtime may call `dispose()` again after an uninstall failure, but the concrete adapters already make that call a no-op; the retry is for completing the uninstall state transition, not replaying teardown side effects. |
| Cleanup order | Reverse acquisition order, with the Feature surface acquired first and therefore disposed last | A single rule works for startup rollback and normal disposal. Product resources stop before their renderer disappears. |
| Readiness | The shared module calls `surface.ready()` after product registration | The local adapters already call it at this point. Native adapters do not call it today, but accept only suite contexts, whose handle implements `ready()` as a no-op. |
| Activation | The shared module delegates to `surface.activate()` only while registered | Bonded and Shout do not need product-specific activation. |
| Updater | Keep `#updater` in each local product adapter | Update checking is a product action, not a lifecycle fact. |
| Public contract | Do not change `MoirasiaFeature` | Feature runtime and loaders remain untouched. |
| Documentation | Add an Embedded feature lifecycle term to `CONTEXT.md` | The new deep module needs a domain name future reviews can recognize. |

## Design-it-twice result

Four shapes were compared.

### Chosen: minimal lifecycle factory

A factory returns a `MoirasiaFeature`. Its one product seam is `mount`, and `mount` receives one ownership primitive, `own(cleanup)`. Runtime callers learn nothing new, while product adapters share duplicate-registration suppression, rollback, readiness, activation, and disposal. It does not duplicate the callers' registration-versus-disposal scheduling.

### Rejected: public typestate

A `prepare → bind → ready → running` interface made valid phases explicit but exposed internal sequencing to every adapter. It would replace repeated implementation with a larger interface and a compatibility module around `MoirasiaFeature`. The extra types do not add leverage for four fixed adapters.

### Rejected: declarative feature description

A large declaration covering local/native plans, Runtime leases, updater feeds, controller construction, IPC wiring, and custom actions made common declarations short. It also pulled product facts into `desktop-shell` and needed escape hooks for Amove. The result would be a shallow module whose interface nearly described each implementation.

### Rejected: a second lifecycle port

`MoirasiaFeature` already sits at the Feature runtime seam. Adding `FeatureLifecyclePort` and `FeatureSession` would create two names for the same transition and force Feature runtime changes. One adapter would only wrap the other, so the added seam fails the deletion test.

### Deletion test

Deleting the chosen module would restore surface ownership, rollback blocks, activation, and disposal loops in all four product adapters, plus single-flight fields in the two local adapters. Complexity would spread back to four callers. The module therefore earns its depth without becoming another operation scheduler.

## Verified baseline

Repository root: `/Users/mac/Syncthing/Projects/Moirasia`

Current tip: `c55f749 feat: share GitHub release checks through desktop-shell`

Worktree before this plan:

- `plan.md` was tracked and contained the completed Controller plan. It was deleted first as requested; Git history preserves it.
- `architecture-review-20260922-171414.html` is untracked and intentionally remains in the repository because the user requested local report output.
- No other root worktree changes were present.
- No root ADR directory exists.

Relevant domain terms read from `CONTEXT.md`: Embedded feature, Feature host, Feature mode, Feature runtime, Feature surface host, Runtime lease, and App updater.

Targeted baseline checks:

- `pnpm -C apps/integrated/Bonded exec vitest run tests/feature.test.ts tests/native-feature.test.ts` passed: 2 files, 6 tests.
- `pnpm -C apps/integrated/Shout exec vitest run tests/native-feature.test.ts` has a pre-existing failure at `apps/integrated/Shout/tests/native-feature.test.ts:113`: the malformed-response assertion expects `/shout\.getSnapshot/`, but the received error message is empty. Two other tests pass.
- The attempted root targeted run for `tests/native-feature-adapter.test.ts` and `tests/feature-surface-host.test.ts` was blocked by the execution guard, not by a test result.

The Shout failure is outside this lifecycle refactor. Do not change native payload error wording in this work merely to make that baseline green. Re-run it during implementation and report whether it persists; this change must introduce no additional failure.

## Current architecture and friction

### Existing shared modules

- `packages/desktop-shell/src/feature.ts:102-119` defines `MoirasiaFeature`. Feature runtime calls this interface.
- `packages/desktop-shell/src/feature-surface-host.ts:19-90` validates resources, returns the suite renderer or creates the standalone window, loads it in `ready()`, activates it, and disposes it.
- `packages/desktop-shell/src/native-feature-adapter.ts:32-84` owns native request/event decoding.
- `packages/desktop-shell/src/native-feature-adapter.ts:101-151` owns renderer authorization, IPC handler registration, snapshot forwarding, registrar rollback, and handler disposal.
- `packages/desktop-shell/src/app-updater-electron.ts:19-44` registers the three updater IPC handlers and updater-state subscription. Its setup/disposal cleanup needs the focused hardening described below. Grep finds five consumers: Bonded, Shout, and Amove IPC; Orbis `application.ts`; and YN360 `controller.ts`. Its signature and channel behavior remain unchanged for all five.
- `apps/integrated/Bonded/src/main/ipc.ts` and `apps/integrated/Shout/src/main/ipc.ts` each own their product command handlers, snapshot subscription, and optional updater registrar. Their cleanup boundaries remain product-owned but need to become exhaustive before the lifecycle treats each disposer as one owned entry.

These modules remain. The new module composes them; it does not absorb their implementation.

### Four repeated adapters

| Adapter | Registration today | Rollback today | Disposal today | Friction |
|---|---|---|---|---|
| Bonded local | guard → surface → lease → controller → IPC → start → renderer subscription → ready → publish fields | renderer subscription → IPC → controller stop → lease → surface | renderer subscription → IPC → controller stop → surface → lease | Full lifecycle implemented in the product class; registration has a single-flight field. |
| Shout local | guard → surface → lease → controller → IPC → start → ready → publish fields | IPC → controller stop → lease → surface | IPC → controller stop → surface → lease | Near-copy of Bonded, but no renderer subscription and no test file. |
| Bonded native | context check → surface → native IPC registrar → publish fields | registrar's internal rollback, then surface | IPC disposer → surface | Repeats native Shout state and cleanup loop; only checks `#surface` after acquisition begins. It does not call `surface.ready()`. |
| Shout native | context check → surface → native IPC registrar → publish fields | registrar's internal rollback, then surface | IPC disposer → surface | Near byte-level twin of Bonded native. It does not call `surface.ready()`. |

The local normal-disposal order differs from rollback: Runtime lease release comes after the surface normally but before the surface during rollback. The new module deliberately standardizes both paths on reverse acquisition order. The Feature surface is acquired first, so it is disposed last.

### Tests and gaps

- `apps/integrated/Bonded/tests/feature.test.ts` has three tests. They cover suite registration and activation, immediate renderer-process exclusion, a double `dispose()` idempotency check, standalone loading/activation/disposal, and a Runtime lease acquisition failure. They do not exercise failure after IPC registration, cleanup errors, cleanup order, or failure during `ready()`.
- There is no `apps/integrated/Shout/tests/feature.test.ts`.
- `apps/integrated/Bonded/tests/native-feature.test.ts` and `apps/integrated/Shout/tests/native-feature.test.ts` cover command mapping, validation, renderer replacement, event decoding, and basic disposal. They do not own generic lifecycle ordering.
- `tests/native-feature-adapter.test.ts` already covers partial IPC-handler rollback, subscription failure, sender authorization, forwarding, and exhaustive registrar disposal. Keep those tests at that module's interface.
- `apps/integrated/Bonded/tests/ipc.test.ts` and `apps/integrated/Shout/tests/ipc.test.ts` each have two tests: normal authorization/snapshot/disposal and partial command-handler registration rollback. Neither covers controller-subscription cleanup when updater setup fails nor exhaustive disposal after one nested cleanup throws.
- No test covers `registerGitHubUpdaterIpc` registration rollback when `updater.subscribe` throws or exhaustive/idempotent disposal when unsubscribe or handler removal throws.
- `tests/feature-surface-host.test.ts` already covers suite and standalone surface behavior. Keep those tests at that module's interface.
- No test currently describes single-flight registration, LIFO cleanup, readiness rollback, or re-registration after disposal through one shared lifecycle interface. The runtime tests cover local caller-level registration/uninstall serialization and reinstall with fakes; `runStandaloneLaunch` also waits for registration before disposal. No production path calls `register()` and `dispose()` concurrently on the same feature object.

## The deep module

### New file and export

Create:

- `packages/desktop-shell/src/feature-lifecycle.ts`
- `tests/feature-lifecycle.test.ts`

Add this package export to `packages/desktop-shell/package.json`:

```json
"./feature-lifecycle": "./src/feature-lifecycle.ts"
```

Do not re-export the module from `@moirasia/desktop-shell/main` or the package root. The dedicated subpath keeps Electron main-process lifecycle code out of renderer-safe imports.

### Interface

Use this exact public shape:

```ts
import type { FeatureContext, FeatureHostMode, FeatureId, MoirasiaFeature } from './feature'
import type { FeatureSurfaceHandle } from './feature-surface-host'

export type FeatureCleanup = () => void | Promise<void>

export interface FeatureMountContext {
  readonly context: FeatureContext
  readonly surface: FeatureSurfaceHandle
  own(cleanup: FeatureCleanup): void
}

export interface FeatureLifecycleOptions {
  readonly id: FeatureId
  readonly modes: readonly FeatureHostMode[]
  mount(input: FeatureMountContext): void | Promise<void>
}

export function createFeatureLifecycle(options: FeatureLifecycleOptions): MoirasiaFeature
```

The factory interface is intentionally small:

- `id` identifies and validates the feature.
- `modes` distinguishes local adapters, which accept `suite` and `standalone`, from native adapters, which accept only `suite`.
- `mount` is the sole product adapter at the seam.
- `own` is the sole cleanup-registration primitive.
- Callers still receive `MoirasiaFeature`, so Feature runtime sees no new interface.

Do not add separate callbacks for validation, surface acquisition, readiness, activation, rollback, or disposal. Those are implementation facts of the deep module. Do not add hooks for Amove shelf actions.

### Required invariants

#### Context validation

Before acquiring a Feature surface or invoking `mount`:

1. require `context.id === options.id`;
2. require `context.productId === options.id`;
3. require `context.mode` to appear in `options.modes`.

Use a stable error naming the feature and accepted modes. The shared module cannot call it "local" or "native" because that product-specific distinction is represented only by the supplied mode list. Keep the existing product-level meaning:

- local Bonded/Shout accept suite and standalone contexts;
- native Bonded/Shout reject standalone contexts.

Validation happens even if the feature is already registered. This makes a wrong context a caller error instead of a silent no-op.

#### Registration

1. If a registration is complete, a valid repeated `register()` is a no-op.
2. If registration is in flight, concurrent valid calls reuse it and do not call `acquireFeatureSurface` or `mount` twice. Preserve side-effect single-flight behavior; exact JavaScript `Promise` object identity is not part of the contract and the current `async` local methods do not preserve it.
3. Acquire the Feature surface first.
4. Immediately register `() => surface.dispose()` with the cleanup scope. Use a closure rather than passing an unbound method. Because cleanup is LIFO, the surface is released last.
5. Call `mount({ context, surface, own })`.
6. After `mount` resolves, close the ownership scope so a retained `own` callback cannot register late cleanup.
7. Await `surface.ready()`.
8. Publish the registration as active only after readiness succeeds.
9. Clear the in-flight registration promise in `finally`, allowing retry after failure.

A private closure with idle, registering, and registered state is sufficient. Do not expose phases through the interface, add a disposing phase, or queue registration behind disposal. Current callers do not invoke unlike operations concurrently on one feature object.

#### Ownership scope

- Each call to `own(cleanup)` records one cleanup entry in acquisition order. Invoking `own` twice, even with the same function, intentionally records two acquisitions.
- Reject a non-function cleanup with `TypeError`.
- Throw if `own` is called after `mount` has settled. A late registration would otherwise escape both rollback and disposal.
- Cleanup runs in reverse registration order.
- Product adapters must register cleanup immediately after each resource is acquired, before the next fallible operation.

#### Registration failure

If surface acquisition, `mount`, or `surface.ready()` fails:

1. mark the registration inactive;
2. run every acquired cleanup in reverse order;
3. continue cleanup after individual cleanup failures;
4. preserve and rethrow the original registration error;
5. clear all cleanup references so a later `dispose()` is a no-op;
6. allow a later `register()` to retry from idle.

Secondary rollback errors must not replace the startup error. This corrects the local adapters and preserves the native behavior. Do not introduce a new public error type in this refactor.

#### Opaque cleanup boundary

The lifecycle owns cleanup entries, not the internals of each entry. It must attempt later entries when one callback throws, but it cannot recover resources that a failing acquisition never exposed through `own`. Before relying on `registerIpc` as one owned entry:

- update `registerGitHubUpdaterIpc` so any handler-registration or `updater.subscribe` failure removes every handler already installed and preserves the original setup error even if removal throws; make its returned disposer idempotent and exhaustive, preserving the first cleanup error;
- update both local product `registerIpc` functions so registration failure best-effort runs the controller snapshot unsubscribe, updater disposer, and every registered handler removal while preserving the original registration error;
- make both returned local IPC disposers idempotent and exhaustive with first-error precedence.

Keep command tables, authorization, snapshot forwarding, and updater channel facts unchanged. Use small file-local cleanup loops; do not create another shared cleanup abstraction.

#### Activation

- While registered, `activate()` calls `surface.activate()`.
- Before readiness, after failed registration, during/after disposal, or before any registration, `activate()` is a no-op.
- Product adapters do not supply an activation callback.

#### Disposal

1. Mark the registration inactive and detach the committed cleanup stack before invoking cleanup. This makes activation stop immediately and makes concurrent or later `dispose()` calls no-ops rather than repeating side effects.
2. Run every detached cleanup in reverse order, awaiting each one even if an earlier cleanup fails.
3. Throw the first cleanup error in cleanup invocation order after all cleanup functions have been attempted.
4. A later `dispose()` is a no-op, including when the first disposal threw. This matches the concrete adapters: they detach state before cleanup, and controller `stop()` marks the controller disposed before operations that may reject. `LocalFeatureMode` can call `dispose()` again after reverting a failed uninstall, but that second call already performs no product cleanup today.
5. After disposal has settled, a later `register()` starts a new Feature surface and cleanup scope.

Do not add behavior for `dispose()` during registration or `register()` during disposal. Current runtime and standalone call paths do not invoke those pairs on one feature object. The module should not silently invent semantics that its public contract and current adapters never promised.

### Why this interface remains deep

The interface gives each product one mounting entry point and one ownership primitive. Behind it sit duplicate-registration suppression, surface ownership, readiness, rollback, activation, disposal ordering, exhaustive cleanup, error precedence, and re-registration. Adding a matching product requires learning two lifecycle concepts rather than copying those mechanics. Cross-operation scheduling stays with the runtime and standalone launcher, where it already exists.

## Product migrations

### 1. Bonded local adapter

File: `apps/integrated/Bonded/src/main/feature.ts`

Keep `BondedFeature` as an exported class because tests instantiate it and standalone code uses the singleton export. Replace its lifecycle fields with:

- `#updater: AppUpdater | undefined` for the committed product-owned menu action;
- `#pendingUpdater: AppUpdater | undefined` while `mount` is running;
- `#lifecycle: MoirasiaFeature`, created in the constructor with `createFeatureLifecycle`.

The pending field preserves a current subtlety: the standalone menu exists before registration settles, but `checkForUpdates()` cannot call an updater until the feature is ready. Do not assign `#updater` from inside `mount`.

Delete these fields after migration:

- `#controller`
- `#surface`
- `#disposeIpc`
- `#disposeRenderer`
- `#lease`
- `#registration`

Configure the shared module with:

```ts
id: 'bonded',
modes: ['suite', 'standalone']
```

The Bonded `mount` adapter performs only product work:

1. create the standalone updater when `context.mode === 'standalone'`; assign it to `#pendingUpdater`;
2. register an owned cleanup that clears `#pendingUpdater` only if it still refers to that registration's updater;
3. acquire the Bonded Runtime lease with the existing app-data path and host argument, then immediately own `() => lease.release()`;
4. construct `BondedController` from `context.paths` exactly as today;
5. immediately own `() => controller.stop()`;
6. call `registerIpc({ renderer: surface.renderer, controller, updater })` and immediately own its disposer. Passing the updater is required because this registration also owns the standalone updater IPC channels;
7. await `controller.start()`;
8. subscribe to `surface.renderer`; when a renderer exists, call `controller.excludeProcess(current.getOSProcessId())`;
9. immediately own the renderer unsubscribe function;
10. return. The shared module calls `surface.ready()`.

After `#lifecycle.register(ctx)` resolves, `BondedFeature.register` promotes a non-undefined `#pendingUpdater` to `#updater` and clears the pending field. If a concurrent valid wrapper call resumes afterward, it sees no pending updater and must not overwrite the committed field. Registration failure cleanup clears the pending field. This preserves the current rule that menu update checks are unavailable during startup.

`BondedFeature.dispose()` must synchronously clear both updater fields before calling `#lifecycle.dispose()`. The current adapter clears `#updater` before any asynchronous controller or lease cleanup, preventing a menu action from starting an update check during teardown.

The lifecycle cleanup stack then runs:

1. renderer unsubscribe;
2. IPC disposal, including updater IPC;
3. controller stop;
4. Runtime lease release;
5. Feature surface disposal.

Delegate public lifecycle methods:

- `register(ctx)` awaits `#lifecycle.register(ctx)`, then promotes a pending updater as described above;
- `activate()` calls `#lifecycle.activate?.()`;
- `dispose()` clears `#updater` and `#pendingUpdater` synchronously, then calls `#lifecycle.dispose()`.

Keep `checkForUpdates()` product-owned and behavior-compatible:

1. call `activate()`;
2. call `#updater?.check()` without awaiting it.

Keep `export const feature = new BondedFeature()` unchanged.

### 2. Shout local adapter

File: `apps/integrated/Shout/src/main/feature.ts`

Mirror the Bonded migration, preserving Shout product facts. Keep the exported `ShoutFeature` class and singleton. Retain `#updater`, `#pendingUpdater`, and `#lifecycle` as state. Promote the pending updater only after shared registration and readiness succeed, with the same conditional pending cleanup and concurrent-wrapper safeguard as Bonded. Clear both updater fields synchronously at the start of public `dispose()`.

Configure:

```ts
id: 'shout',
modes: ['suite', 'standalone']
```

The Shout `mount` adapter:

1. creates the standalone updater and records it as pending, with owned conditional cleanup of the pending field;
2. acquires the Shout Runtime lease with the unchanged app-data path and host argument, then owns `() => lease.release()`;
3. constructs `ShoutController` with `dataDirectory`, `helperExecutable`, and `driverSourceDirectory` exactly as today;
4. owns `() => controller.stop()`;
5. calls `registerIpc({ renderer: surface.renderer, controller, updater })` and owns its disposer, preserving standalone updater IPC;
6. awaits `controller.start()`;
7. returns for shared `surface.ready()`.

After the public wrapper clears updater fields synchronously, expected lifecycle cleanup order is:

1. IPC disposal, including updater IPC;
2. controller stop;
3. Runtime lease release;
4. Feature surface disposal.

Delegate `activate`; wrap `register` to promote `#pendingUpdater` after success and wrap `dispose` to clear updater fields before delegation. Keep `checkForUpdates()` product-owned. Delete `#controller`, `#surface`, `#disposeIpc`, `#lease`, and `#registration`.

### 3. Bonded native adapter

File: `apps/integrated/Bonded/src/main/native-feature.ts`

Keep `NativeBondedController`. It is a useful product adapter over `NativeFeaturePort<BondedSnapshot>` and owns Bonded command names and response decoding.

Delete `NativeBondedFeature`. Change `createNativeFeature(transport)` to construct the controller and return a shared lifecycle feature:

```ts
const controller = new NativeBondedController(transport)
return {
  feature: createFeatureLifecycle({
    id: 'bonded',
    modes: ['suite'],
    mount({ surface, own }) {
      const disposeIpc = registerNativeFeatureIpc({
        renderer: surface.renderer,
        authorizationError: 'Unauthorized Bonded IPC sender',
        snapshotChannel: IPC.snapshot,
        commands: [/* existing command list, unchanged */],
        subscribeSnapshot: (listener) => controller.subscribeSnapshot(listener)
      })
      own(disposeIpc)
    }
  })
}
```

Keep all eight command channels, wire method names, parameter mappings, validator predicates, validation messages, authorization text, and decoder use semantically unchanged. Deleting the feature class necessarily changes `this.#controller` references to the closed-over `controller`, so a byte-for-byte command-table requirement would be impossible. Do not move Bonded opaque-id validation into the shared module.

The shared module now owns context validation, surface acquisition, activation, registrar disposal, and surface disposal. It also calls `ready()`, an observable call added to this adapter but a behavioral no-op because native mode accepts only suite contexts.

### 4. Shout native adapter

File: `apps/integrated/Shout/src/main/native-feature.ts`

Keep `NativeShoutController` and `parseSource`. Delete `NativeShoutFeature`. Return `createFeatureLifecycle` configured with `id: 'shout'`, `modes: ['suite']`, and a `mount` adapter that registers the existing native IPC command table and owns its disposer.

Keep all seven command channels and wire mappings, gain validation, source validation, device-uid validation, snapshot decoding, error strings, and authorization text semantically unchanged. As with Bonded, only the controller receiver changes from a class field to the closed-over controller. The added `ready()` call is a suite-handle no-op.

## Package and domain documentation

### Package export

Update `packages/desktop-shell/package.json` with the dedicated `./feature-lifecycle` subpath. No dependency changes are required.

### CONTEXT.md

Add this term next to Embedded feature and Feature surface host:

> **Embedded feature lifecycle** — `packages/desktop-shell/src/feature-lifecycle.ts`; owns single-flight registration, Feature surface readiness, activation, reverse-order rollback, and exhaustive disposal for the repeated Bonded and Shout local/native adapters. Product adapters retain controllers, Runtime leases, updater facts, native decoding, commands, and validation. Amove retains its custom local and native lifecycle because its shelf and two-renderer behavior do not yet share this seam.

This records both the ownership and the deliberate Amove exclusion so future architecture reviews do not re-suggest a generic shelf hook without new evidence.

## Test plan

### New shared interface tests

Add `tests/feature-lifecycle.test.ts`. Mock `acquireFeatureSurface` so these tests stay at the lifecycle interface and do not exercise Electron. Use a fake surface that records `ready`, `activate`, and `dispose` calls. Use one deferred mount promise to test duplicate-registration suppression; do not add register/dispose race tests.

Test through the returned `MoirasiaFeature` only:

1. **Validates identity before side effects.** Wrong `id`, wrong `productId`, and disallowed mode reject without acquiring a surface or mounting.
2. **Registers once.** A valid registration acquires one surface, calls `mount` once, then calls `ready`; a second completed registration is a no-op.
3. **Suppresses duplicate in-flight registration.** Two calls made before `mount` resolves produce one surface and one mount. Do not assert exact promise-object identity.
4. **Activates only after readiness.** `activate()` is a no-op before and during registration, calls the surface after success, and stops calling it after disposal begins.
5. **Rolls back a mount failure in LIFO order.** Register three owned cleanups, throw from `mount`, verify order 3 → 2 → 1 → surface, and verify the original mount error wins over a cleanup error.
6. **Rolls back a readiness failure.** Let `mount` succeed and `ready()` fail; verify every product cleanup and the surface run once.
7. **Attempts every disposal cleanup.** Make multiple sync and async cleanups throw, verify all are awaited in reverse order and the first error in that order is thrown.
8. **Disposes idempotently.** A second disposal performs no work, including after the first disposal threw.
9. **Contains surface-acquisition failure.** Reject acquisition, verify `mount` is not called, then retry with a fresh surface.
10. **Allows retry after failed registration.** First mount fails; second registration gets a fresh surface and succeeds.
11. **Allows registration after settled disposal.** Register, await disposal, and register again; verify two surfaces and two independent cleanup scopes.
12. **Rejects invalid and late ownership.** Reject a non-function cleanup; separately retain `own`, let `mount` resolve, then call it and expect a `TypeError` without altering the committed cleanup stack.

These tests replace the need to test lifecycle internals independently in every product. They are the main test surface for the new module.

### IPC cleanup-boundary tests

Add `tests/app-updater-electron.test.ts` for the Electron updater registrar. Cover partial handler registration, `updater.subscribe` failure after all three handlers exist, exhaustive disposal when unsubscribe and handler removal throw, first-error precedence, and idempotency.

Expand both product IPC suites:

- `apps/integrated/Bonded/tests/ipc.test.ts`
- `apps/integrated/Shout/tests/ipc.test.ts`

For each registrar, force updater setup to fail after the controller snapshot subscription succeeds. Assert snapshot unsubscribe and every product/updater handler cleanup are attempted and the updater setup error is preserved. Also force the returned snapshot unsubscribe and one handler removal to throw; assert all remaining updater and product handlers are still attempted, the first error is thrown, and a second dispose does no work. Keep these tests at the registrar interfaces rather than reproducing them in feature tests.

### Bonded local tests

Update `apps/integrated/Bonded/tests/feature.test.ts`:

- Preserve the three existing behavioral tests.
- Keep assertions that suite mode creates no window, standalone mode uses the catalog window, and activation reaches the surface.
- Pin Bonded's ordering subtlety: the renderer subscription runs after `controller.start()` but before `surface.ready()`, and its immediate emission excludes PID 321. It does not "follow readiness"; the current source subscribes first.
- Make `controller.start()` reject after IPC registration. Assert IPC disposal, controller stop, Runtime lease release, and surface disposal each happen once and in reverse-acquisition order.
- Add a disposal-error test in which controller stop rejects but Runtime lease and surface cleanup still run; assert the controller error is returned and order remains reverse acquisition.
- Verify `checkForUpdates()` does not call the pending updater while registration is blocked, then does after readiness succeeds. Block controller cleanup during `dispose()` and verify updater checks become unavailable synchronously, before cleanup settles.
- Rely on the shared interface test for duplicate in-flight registration; the product adapter adds no work before entering the shared module.

Update mocks only as required by the new import. Do not mock away `createFeatureLifecycle`; the product test should exercise its integration with Bonded's mount adapter.

### New Shout local tests

Create `apps/integrated/Shout/tests/feature.test.ts`, matching the useful Bonded cases without copying generic lifecycle permutations:

1. suite registration constructs one controller with the current helper, driver, and data paths; starts it; and creates no standalone window;
2. standalone registration loads the catalog-defined Feature surface, and a later `activate()` activates it;
3. unavailable Runtime lease prevents controller construction;
4. start failure disposes IPC, stops the controller, releases the Runtime lease, and disposes the Feature surface in reverse-acquisition order;
5. disposal remains exhaustive and ordered if controller stop fails;
6. `checkForUpdates()` cannot call the pending standalone updater before readiness, then activates the committed surface and checks that updater after registration; it becomes unavailable synchronously when disposal starts, and suite mode has no updater.

### Native product tests

Update imports/mocks in:

- `apps/integrated/Bonded/tests/native-feature.test.ts`
- `apps/integrated/Shout/tests/native-feature.test.ts`

Replace the old package-subpath surface mock with the repository-relative source mock `../../../../packages/desktop-shell/src/feature-surface-host`. That resolves to the same source file imported relatively by `feature-lifecycle.ts`. Do not mock `createFeatureLifecycle` itself.

Keep command mapping and product validation assertions unchanged. Add only integration assertions that are product-specific:

- activation reaches the acquired surface after registration;
- disposal unregisters the product's snapshot subscription and invokes the acquired handle's `dispose()` once;
- wrong-id, wrong-product, and standalone contexts each fail before surface acquisition or native IPC handler installation;
- registration invokes the acquired handle's `ready()` once. Record that this is new at the native adapter boundary but is a no-op for the only accepted mode.

Do not duplicate shared LIFO, single-flight, or readiness tests in both product suites.

### Existing shared tests

Retain without semantic changes:

- `tests/feature-surface-host.test.ts`
- `tests/native-feature-adapter.test.ts`
- `tests/feature-runtime.test.ts`

Feature runtime loaders and `MoirasiaFeature` fakes should require no changes because the external interface is unchanged.

## Implementation sequence

### Step 0: make owned IPC cleanup trustworthy

1. Add `tests/app-updater-electron.test.ts` and extend both product `ipc.test.ts` suites with the cleanup-boundary cases above.
2. Harden `registerGitHubUpdaterIpc` and the Bonded/Shout local `registerIpc` functions with file-local exhaustive cleanup and idempotency.
3. Run:

```bash
pnpm exec vitest run tests/app-updater-electron.test.ts
pnpm -C apps/integrated/Bonded exec vitest run tests/ipc.test.ts
pnpm -C apps/integrated/Shout exec vitest run tests/ipc.test.ts
pnpm typecheck
pnpm -C apps/integrated/Amove typecheck
pnpm -C apps/standalone/Orbis typecheck
pnpm -C apps/standalone/YN360 typecheck
```

Acceptance:

- setup failure leaves no updater or product IPC handler and no controller/updater subscription;
- disposal attempts every nested cleanup once and throws its first error;
- command mappings, validators, authorization, snapshot forwarding, and the shared updater registrar signature are unchanged;
- all five `registerGitHubUpdaterIpc` consumers still typecheck;
- no generic cleanup helper is exported.

### Step 1: add the deep module test-first

1. Add the `./feature-lifecycle` export to `packages/desktop-shell/package.json`.
2. Add `tests/feature-lifecycle.test.ts` with the twelve interface cases.
3. Implement `packages/desktop-shell/src/feature-lifecycle.ts` until the new tests pass.
4. Run:

```bash
pnpm exec vitest run tests/feature-lifecycle.test.ts tests/feature-surface-host.test.ts tests/native-feature-adapter.test.ts
pnpm typecheck
```

Acceptance for this step:

- all lifecycle tests pass;
- no `MoirasiaFeature` change;
- no product-specific name appears in `feature-lifecycle.ts`;
- no new dependency appears in a package manifest.

### Step 2: migrate Bonded local

1. Replace Bonded's lifecycle fields and methods with the shared module and product `mount` adapter.
2. Preserve updater behavior and Bonded renderer exclusion.
3. Expand `apps/integrated/Bonded/tests/feature.test.ts` for late registration failure and exhaustive disposal.
4. Run:

```bash
pnpm -C apps/integrated/Bonded exec vitest run tests/feature.test.ts
pnpm -C apps/integrated/Bonded typecheck
```

Acceptance:

- `BondedFeature` remains exported;
- the singleton export remains unchanged;
- Runtime lease errors still reach `main/index.ts` unchanged;
- process exclusion still subscribes after controller start and before surface readiness, so an already-present renderer PID is excluded before loading/showing the standalone surface;
- no manual registration promise or cleanup loop remains in Bonded local.

### Step 3: migrate Shout local

1. Replace Shout's lifecycle fields and methods with the shared module.
2. Add `apps/integrated/Shout/tests/feature.test.ts`.
3. Preserve helper/driver path construction, updater behavior, and Runtime lease errors.
4. Run:

```bash
pnpm -C apps/integrated/Shout exec vitest run tests/feature.test.ts
pnpm -C apps/integrated/Shout typecheck
```

Acceptance:

- `ShoutFeature` and singleton exports remain;
- all new local lifecycle tests pass;
- no manual registration promise or cleanup loop remains in Shout local.

### Step 4: migrate both native adapters

1. Delete `NativeBondedFeature` and `NativeShoutFeature`.
2. Keep each native controller and command table in its product file.
3. Return the shared lifecycle feature from both `createNativeFeature` functions.
4. Update the native product tests for context, activation, and disposal integration.
5. Run:

```bash
pnpm -C apps/integrated/Bonded exec vitest run tests/native-feature.test.ts
pnpm -C apps/integrated/Shout exec vitest run tests/native-feature.test.ts
pnpm -C apps/integrated/Bonded typecheck
pnpm -C apps/integrated/Shout typecheck
```

Acceptance:

- all eight Bonded command mappings and validator semantics remain unchanged;
- all seven Shout command mappings and validator semantics remain unchanged;
- native snapshot decoding and renderer authorization still pass through `native-feature-adapter.ts`;
- no product native feature class repeats surface or cleanup state.

Treat the exact Shout malformed-response assertion at line 113 as the recorded baseline exception. Do not alter decoder behavior in this change. Any additional Shout failure blocks completion.

### Step 5: update the domain glossary and run broad verification

1. Add the Embedded feature lifecycle term to `CONTEXT.md`.
2. Run root checks:

```bash
pnpm typecheck
pnpm exec vitest run tests/app-updater-electron.test.ts tests/feature-lifecycle.test.ts tests/feature-surface-host.test.ts tests/native-feature-adapter.test.ts tests/feature-runtime.test.ts
pnpm test
```

3. Run product checks:

```bash
pnpm -C apps/integrated/Bonded typecheck
pnpm -C apps/integrated/Bonded test
pnpm -C apps/integrated/Bonded build:renderer
pnpm -C apps/integrated/Shout typecheck
pnpm -C apps/integrated/Shout test
pnpm -C apps/integrated/Shout build:renderer
```

4. Run grep gates:

```bash
rg -n "#registration|#disposeIpc|#disposeRenderer|#surface|#lease|#controller" \
  apps/integrated/Bonded/src/main/feature.ts \
  apps/integrated/Shout/src/main/feature.ts

rg -n "class Native(Bonded|Shout)Feature" \
  apps/integrated/Bonded/src/main/native-feature.ts \
  apps/integrated/Shout/src/main/native-feature.ts

rg -l "createFeatureLifecycle" \
  apps/integrated/Bonded/src/main/feature.ts \
  apps/integrated/Bonded/src/main/native-feature.ts \
  apps/integrated/Shout/src/main/feature.ts \
  apps/integrated/Shout/src/main/native-feature.ts
```

Expected grep results:

- the first command has no matches for deleted lifecycle fields;
- the second command has no matches;
- the third command prints exactly the four adapter file paths.

5. Review the final diff for accidental changes to command tables, product validators, updater feed constants, Runtime lease calls, and Amove files. Confirm the intended supporting edits are limited to `packages/desktop-shell/src/app-updater-electron.ts`, both local product `ipc.ts` files, and their named tests.

## Behavior ledger

### Deliberate improvements

- Native and local adapters now share single-flight registration.
- Registration readiness failure rolls back all acquired resources.
- Registration rollback preserves the startup error even if a local cleanup throws; current local adapters do not consistently preserve it.
- The lifecycle attempts every owned cleanup entry, and the three hardened IPC registrars now exhaust their nested handlers and subscriptions.
- Rollback and normal disposal use one reverse-acquisition rule.
- Re-registration after disposal is tested once at the shared interface.

### Preserved behavior

- Feature runtime still loads a `MoirasiaFeature` and invokes `register`, `activate`, and `dispose` as before.
- Local Bonded and Shout support suite and standalone modes.
- Native Bonded and Shout accept suite mode only.
- Standalone updater checks remain product-owned and fire without awaiting.
- The shared updater registrar keeps the same API and channel behavior for its five Bonded, Shout, Amove, Orbis, and YN360 consumers; only failure cleanup changes.
- Runtime lease acquisition arguments and product-specific error classes remain unchanged.
- Bonded process exclusion still follows renderer availability.
- Native command names, channel names, authorization messages, validators, request parameters, snapshot decoders, and snapshot events remain unchanged.
- Suite surface activation and standalone window activation still come from `FeatureSurfaceHandle.activate()`.
- Resource validation and standalone window facts remain in Feature surface host.

### Intentional ordering change

Local normal disposal will release the Runtime lease before disposing the Feature surface, matching rollback and strict reverse acquisition. Today local normal disposal stops the controller, destroys the surface, and only then releases the lease. The lease release is observable to the other allowed host, so this is a real ordering change: another host may acquire after IPC and controller shutdown but just before the old inert surface is destroyed. This is acceptable because the Runtime lease protects the sensitive controller session, not window presence, and all product activity has stopped before release. Exhaustive cleanup also ensures a throwing controller stop or lease release cannot prevent later surface cleanup. Product integration tests must pin the new order.

## Out of scope

- Amove local or native lifecycle migration.
- New shelf, custom-action, or two-renderer hooks in the shared module.
- Changes to `MoirasiaFeature` or Feature runtime loaders. In particular, this module does not fix a native uninstall that overlaps acquisition before `FeatureRuntime` publishes the instance; the unpublished adapter receives no `dispose()` call, so that race belongs at the runtime queue.
- Changes to Feature mode ownership in `src/main/features/host-mode.ts`.
- Changes to Feature surface host window policy.
- Changes to native transport, payload decoding, command validation, or renderer authorization.
- Moving product IPC channel tables into the lifecycle module; only their existing cleanup mechanics change.
- Changes to Runtime lease implementation or product-specific lease adapters.
- Moving updater creation or update checks into the shared lifecycle.
- Fixing the pre-existing Shout malformed-response assertion.
- Generalizing the cleanup scope for unrelated modules. Four lifecycle adapters justify this seam; no broader abstraction is needed.
- Scheduling `register()` against `dispose()` or making concurrent disposal callers await one shared promise. Existing production owners already serialize those operations.
- Removing or modifying `architecture-review-20260922-171414.html`.

## Completion criteria

The implementation is complete when:

1. `feature-lifecycle.ts` owns the documented invariants and passes its interface suite;
2. the four Bonded/Shout adapters use it;
3. manual registration promises, surface fields, and cleanup loops are gone from those adapters;
4. product commands, validation, controllers, Runtime leases, and updater facts remain product-owned;
5. Amove files are unchanged;
6. the relevant root, Bonded, and Shout typechecks pass;
7. all lifecycle-related tests pass, with the exact recorded Shout line-113 assertion as the sole allowed baseline failure;
8. `CONTEXT.md` records the Embedded feature lifecycle ownership and Amove exclusion;
9. updater and local IPC registrar setup/disposal are exhaustive and idempotent at the boundary the lifecycle owns;
10. the final diff contains no unrelated refactor, dependency, generated artifact, or formatting churn.
