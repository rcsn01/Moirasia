# Implementation plan: serialize native feature activation with adapter loading

**Status:** Implemented. Focused tests and the full root suite pass.

## Goal

Make every native feature acquisition and activation use the existing per-feature queue owned by `FeatureRuntime`. When native state reports a feature as running while its renderer adapter is still loading, an Open action must wait for that load rather than start a second adapter registration. Return activation failures through the existing IPC and renderer promise so the shell can show its current error alert.

Keep Amove's native registration sequence and its custom shelf behavior intact. Do not force the native Amove adapter through the shared Embedded feature lifecycle.

## Decision reached while exploring the candidate

The first suggestion was to move Amove's outer registration and cleanup into `createFeatureLifecycle`. The code does repeat some responsibilities, but the shared module calls `mount` before `surface.ready()`. Amove's native test pins the opposite order for its custom IPC: it waits for the surface, then registers IPC. Supporting that sequence with the shared module would add a new post-readiness variation point for one adapter. The shared module's users, Bonded and Shout, currently use its existing mount-before-ready flow. A one-user variation point is not justified yet.

The deeper issue is in the `Feature runtime`, not in Amove's custom lifecycle. Native snapshot recovery queues an adapter load, but native activation calls the same acquisition kernel directly. `FeatureRuntime` already owns the per-feature queue, so activation should join that queue. An in-flight guard inside `NativeAmoveFeature` would not solve the race: each native loader call constructs a fresh feature adapter with its own fields.

## Evidence and current friction

- `CONTEXT.md` defines the `Feature runtime` as owner of loaded instances and the per-feature serialization queue. `FeatureModeLinks.enqueue` in `src/main/features/host-mode.ts` exposes that queue to mode adapters.
- `FeatureRuntime.#acquire` in `src/main/features/runtime.ts` returns early only when `#instances` already contains the feature. It records an instance after loading and registering it. It does not join an acquisition that has started but has not committed.
- Native startup queues installed-feature acquisition in `NativeFeatureMode.start`. Snapshot recovery queues running adapters in `#loadRunningNativeAdapters`, and `applyActive` queues a missing adapter. Native shelf operations run inside the queue because `FeatureRuntime.#shelf` enqueues them.
- `NativeFeatureMode.activate` is the exception. It calls `#links.acquire(id)` directly, then selects and activates the feature. A concurrent snapshot-recovery load can pass the same empty-instance check.
- `NativeFeatureMode.isLoaded` returns true from native `running` status even before the Electron adapter commits to `FeatureRuntime.#instances`. The Features screen uses `describeFeature`, not `isLoaded`: `loaded` is true when there is no effective service error and either an adapter is committed or native feature state is `running` while the service is not `starting`. `describeFeature` ignores service errors for uninstalled features, whose row shows Install rather than Open. For an installed feature, a valid full snapshot clears service error and sets the host to `running`; with the feature also `running`, `describeFeature` can report loaded while its adapter is still registering, so Open is enabled. During reconnect or service error, an installed feature still reported as `running` has `loaded: false`, so Open is disabled.
- `createNativeFeature` in `apps/integrated/Amove/src/main/native-feature.ts` creates a new `NativeAmoveFeature` for each loader call. Its `#controller` check only protects repeat calls on that one object, not concurrent loads that create separate objects.
- `NativeAmoveFeature.register` has product-specific ordering. `SuiteAmoveController.start` fetches the native snapshot, subscribes to native and shelf state, then waits for `surface.ready()`. Only after that does `NativeAmoveFeature.register` register the custom Amove IPC. `apps/integrated/Amove/tests/native-feature.test.ts` asserts readiness precedes IPC registration.
- The shared `createFeatureLifecycle` module owns single-flight registration, surface readiness, rollback, and disposal for Bonded and Shout. Its tests cover those responsibilities, but its current `mount` phase runs before readiness. Amove's shelf is a separate window and its custom two-renderer IPC and host UI-state reporting remain Amove-owned.
- `ApplicationController.openFeature` in `src/main/application-controller.ts` discards the `void | Promise<void>` result from `FeatureRuntime.activate`. The IPC handler returns `openFeature`, `ControllerApi.openFeature` is typed as `Promise<void>`, and the renderer already catches its rejection. Returning the result will let asynchronous native activation failures reach that existing alert path.
- No ADRs were found in `docs/adr/`. The existing domain glossary already places queue ownership in the `Feature runtime` term; no new domain term is needed.

## Settled decisions

1. **Queue owner.** Use the existing per-feature queue through `FeatureModeLinks.enqueue`. Do not add another lock, cache, queue, or registration promise to `NativeAmoveFeature` or `FeatureRuntime.#acquire`.
2. **Operation scope.** Keep the installed check, acquisition, active-feature selection, and feature activation in one queued turn. This prevents a second acquisition from starting between registration and activation. Re-check installation inside the queued turn.
3. **Local mode.** Leave `LocalFeatureMode.activate` synchronous and unchanged. Do not serialize unrelated features globally. The queue remains per feature.
4. **Amove lifecycle.** Keep Amove's custom native startup and cleanup sequence. Preserve snapshot/subscription setup, then surface readiness, then custom IPC registration. Do not change the shared `FeatureLifecycle` module or move Amove shelf, native decoding, commands, or UI-state reporting into it.
5. **Error flow.** Make `ApplicationController.openFeature` return a `Promise<void>` that settles with `FeatureRuntime.activate`. Keep the current `ControllerApi` and renderer interface; the renderer already displays rejected Open actions.
6. **Test surface.** Test the acquisition race through `FeatureRuntime`, the promise propagation through `ApplicationController`, and the visible failure through the shell renderer. Do not test the private queue map directly.
7. **Domain notes.** Keep `CONTEXT.md` vocabulary unchanged. It already names the `Feature runtime` and its queue. No ADR is needed for this bounded implementation.

## Ownership after the change

`FeatureRuntime` continues to own feature instances, load errors, active selection, and the per-feature queue. Native mode must route each operation that can acquire an adapter through that queue:

| Native acquisition path | Current route | Planned route |
| --- | --- | --- |
| Installed adapters at launch | `enqueue` | unchanged |
| Adapter becomes running after recovery | `enqueue` | unchanged |
| Active-page selection finds no instance | `enqueue` | unchanged |
| Reinstall after native state is running | `enqueue` | unchanged |
| Shelf open or toggle | `FeatureRuntime.#shelf` enqueues | unchanged |
| Open / activation | direct `acquire` | enqueue acquisition and activation together |

`NativeFeatureMode` still owns native status and mode policy. `FeatureRuntime.#acquire` remains the only loader/registration implementation. The existing `MoirasiaFeature` interface stays the test surface for product adapters. Amove's `NativeAmoveFeature` remains the adapter for custom shelf, two-renderer IPC, native snapshots, and host UI-state reporting.

`ApplicationController` will pass the activation promise through its existing IPC handler. The main process will not catch and discard an error that the renderer already knows how to display.

## Implementation steps

### 1. Add native acquisition regression tests

Add native-mode regression tests to `tests/feature-runtime.test.ts`, using its existing `fakeNativeClient` helper and the public `FeatureRuntime` interface. Construct the runtime with `await settingsWith(undefined)`, `loaders: { amove: legacyLoader }`, `nativeLoaders: { amove: nativeLoader }`, `context: () => CONTEXT`, and the fake client's `client` as `nativeClient`. `FeatureRuntime` derives its feature IDs from the `loaders` keys, so this keeps the test to Amove alone; the context callback is required because no `EmbeddedFeatureHost` is supplied. Do not use `fakeNativeClient`'s default empty snapshot: its initial `host.getSnapshot` response must contain `features: [{ id: 'amove', installed: true, state: 'starting' }]`. These reduced one-feature fixtures are accepted by `NativeFeatureMode.#applySnapshot` for this mode-level test because its expected feature IDs contain only Amove. They are not valid native wire snapshots: `NativeHostClient` requires a full `NativeHostSnapshot` with all three feature statuses. This test covers the mode's queue behavior, not wire-schema validation.

For the overlap regression:

1. Make the first native loader call reject, so `syncAtLaunch` finishes with Amove installed but without an instance.
2. Emit the one-feature `running` fixture `features: [{ id: 'amove', installed: true, state: 'running' }]`. `fakeNativeClient` passes it directly to the mode, bypassing `NativeHostClient`'s full-snapshot wire validation. Snapshot handling accepts the Amove projection and queues `#loadRunningNativeAdapters`.
3. Have the second loader call return a recovery feature whose `register` waits on a deferred promise. Signal the test when registration starts. Make each loader call return a distinct feature object so the test models `createNativeFeature` constructing a fresh adapter on every call; later calls should return immediately-registerable features so the pre-fix activation can settle after the expected failure assertion.
4. While registration is pending, assert `runtime.statuses()` reports Amove as `loaded: true`. The accepted fixture sets host service state to running; `FeaturesScreen` uses that `loaded` status to enable Open for an installed feature. This mode-level test asserts the status, not the DOM. In production, the full validated snapshot has the same running service and feature states.
5. Call `runtime.activate('amove')` before releasing the registration gate.
6. While the gate remains closed, assert the native loader has been called exactly twice and only the recovery adapter has begun registration. Release the gate, await activation, and assert the loader count remains two, that same adapter committed, and it received one activation. In `finally`, release the gate and observe activation if an earlier assertion exits before the normal await, so the intentionally failing pre-fix assertion leaves no blocked work or unhandled rejection.

The loader count is exactly two: the failed initial attempt and the queued recovery attempt. With the current direct activation path, Open starts a third loader while recovery is pending, so the overlap assertion fails before the implementation change. Use promise gates, not time-based sleeps.

Also add a separate native activation failure test with the same Amove-only runtime and initial `starting` fixture. Let the startup loader call reject with `new Error('feature service is starting')`, then await `runtime.syncAtLaunch()`. Emit the same one-feature `running` fixture and have the second loader return a feature whose deferred `register` rejects with `new Error('recovery registration failed')`. After registration starts, call `runtime.activate('amove')` and confirm the loader count remains two while recovery is pending. Reject the registration gate with the recovery error. The activation turn must make exactly one serialized retry; have the third loader call reject with `new Error('activation retry failed')` and assert activation rejects with an `Error` carrying that third call's message, not the earlier recovery error. Then have the fourth loader call return a valid feature, activate again, and assert success, one activation of that feature, and a cleared load error. In `finally`, reject the gate if it is still pending and observe the activation promise so a failed assertion cannot leave queued work unresolved or produce an unhandled rejection. The four calls are the failed startup attempt, failed recovery registration, failed activation retry, and successful later turn. This covers registration failure, error selection, and recovery of the existing per-feature queue without inspecting its private map.

### 2. Route native activation through the queue

Update `NativeFeatureMode.activate` in `src/main/features/host-mode.ts` so it returns the promise from `#links.enqueue(id, operation)`. Inside that operation:

1. Re-check `installed(id)` inside the queued operation. If false, throw an `Error` with message `Feature '${id}' is not installed.`.
2. Call `const loaded = await #links.acquire(id)` once.
3. If `loaded` is false, throw an `Error` using `#links.loadError(id)`, or the fallback message `Feature '${id}' could not be loaded.`.
4. Call `#links.setActive(id)` only after acquisition succeeds.
5. Preserve the existing optional activation call: `#links.instance(id)?.activate?.()`.

Keep these steps in the same queued operation. `setActive` calls `applyActive`, but the instance has already committed by then, so that path must observe the instance and must not enqueue a second load. Do not call `enqueue` from inside an operation already queued by `FeatureRuntime.#shelf`; shelf ownership stays as it is.

Add a concise source comment beside native activation explaining that acquisition shares the per-feature queue with snapshot recovery. Do not add a new method to `FeatureModeLinks` or a new feature lifecycle module.

### 3. Preserve and return activation completion

Change `ApplicationController.openFeature` in `src/main/application-controller.ts` to `async openFeature(id: ApplicationId): Promise<void> { await this.features.activate(id) }`. `FeatureRuntime.activate` returns `void | Promise<void>`, so directly returning its result does not satisfy the `Promise<void>` return type. The async wrapper also converts a synchronous Local mode activation throw into a rejected promise. The method currently discards the result. `src/main/ipc.ts` already returns the method result from its `IPC.openFeature` handler, `src/preload/shell.ts` already returns `ipcRenderer.invoke`, `ControllerApi.openFeature` already promises `void`, and `src/renderer/shell/controller.ts` already catches failures. Do not change those interfaces or add a second error channel.

Add `ApplicationController` tests for both a rejected activation promise and a synchronous activation throw. In each case assert that `openFeature` returns a promise rejecting with the original error; it must not throw synchronously for the Local mode case.

### 4. Test the user-visible failure path

Add a shell renderer test in `tests/shell-renderer.test.tsx` where the loaded Amove Open action rejects with `new Error('Amove activation failed.')`. Click Open and assert the existing "Action failed" alert displays `Amove activation failed.`. This jsdom test verifies renderer behavior when `ControllerApi.openFeature` rejects; it does not exercise Electron IPC. The `ApplicationController` test covers the main-process method, and source inspection confirms the handler in `src/main/ipc.ts` and the bridge in `src/preload/shell.ts` forward the promise. No layout or controls change.

Keep `apps/integrated/Amove/tests/native-feature.test.ts` unchanged and require it to pass. Its existing readiness-before-IPC assertion is a guardrail for the product-specific lifecycle that this plan deliberately retains. If it fails, fix the implementation to preserve the tested order; do not weaken the assertion.

## Validation

Run from the repository root:

1. **Red/green regression:** `pnpm exec vitest run tests/feature-runtime.test.ts`. The new overlap test must fail before queueing native activation and pass afterward.
2. **Focused regression tests:** `pnpm exec vitest run tests/feature-runtime.test.ts tests/application-controller.test.ts tests/shell-renderer.test.tsx`.
3. **Amove lifecycle guard:** `pnpm --dir apps/integrated/Amove exec vitest run tests/native-feature.test.ts` to confirm its startup order and cleanup remain intact.
4. **Typecheck:** `pnpm typecheck`.
5. **Full root suite:** `pnpm test`.
6. **Diff hygiene:** `git diff --check`, then inspect the changes to `src/main/features/host-mode.ts`, `src/main/application-controller.ts`, and the three test files. Source-check that `src/main/ipc.ts` and `src/preload/shell.ts` still return the activation promise. Confirm there is no change to local activation, Amove's shelf behavior, or shared lifecycle sequencing.

No native build, staging command, packaging, or migration is needed. The root Playwright configuration points at `tests/e2e`, which currently has no shell end-to-end suite. The renderer interaction is covered by the existing jsdom test harness; this work does not change the layout or controls.

## Acceptance criteria

- Every native path that can load an adapter uses the existing per-feature queue; native activation no longer calls `acquire` outside it.
- If snapshot recovery is registering an adapter, Open waits behind that registration instead of starting another loader or `MoirasiaFeature.register` call.
- After registration commits, queued activation selects and activates that same instance once.
- Failed loading still rejects with the existing load error and does not poison later queue turns.
- The installed-state check, activation semantics, active-page update, and feature activation remain unchanged when there is no load in progress.
- `ApplicationController.openFeature` returns activation completion. Native activation failures reach the renderer's existing error alert.
- `LocalFeatureMode.activate`, Amove's custom registration order, native snapshot and shelf subscriptions, custom IPC, and two-renderer behavior remain unchanged.
- No new adapter seam, public interface, dependency, state persistence, or domain term is added.
- Focused tests, Amove lifecycle tests, typecheck, the full root test suite, and `git diff --check` pass.

## Risks and scope limits

- **Queued activation waits for recovery.** This is intentional. Loading and activation must not run concurrently for the same feature. Other feature IDs keep independent queue turns.
- **The adapter is not committed while registering.** `FeatureStatus.loaded` may still be true from native state during recovery. This plan does not change that status definition; it makes an Open action safe while registration is in progress.
- **Registration failure during recovery.** The queued recovery operation may finish without an instance. The following activation turn then makes one serialized retry and surfaces its existing error if it also fails. Later queue turns remain usable because `FeatureRuntime.#enqueue` recovers from a rejected predecessor.
- **Native uninstall can still overlap activation.** `NativeFeatureMode.setInstalled` performs the uninstall request, snapshot refresh, and adapter disposal outside the per-feature queue. Activation re-checks installation when its queued turn begins, but an uninstall started after that check can still race with acquisition or activation. This plan leaves that existing transaction ordering unchanged; the queue does not serialize the whole install/uninstall operation.
- **Do not add an instance-local guard as the fix.** The feature loader constructs a fresh adapter for each acquisition attempt, so fields on one `NativeAmoveFeature` cannot serialize distinct objects.
- **Do not force Amove into `createFeatureLifecycle`.** Its post-readiness IPC order is a concrete constraint. Reopen that choice only if another feature needs the same post-ready sequence and a second adapter makes the seam real.
- **Do not broaden into uninstall transaction ordering, native UI-state recovery, product controller cleanup, or changes to other Feature mode responsibilities.** Those are separate decisions.
