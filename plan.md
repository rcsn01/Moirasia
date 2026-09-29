# Implementation plan: serialize native install changes with feature activation

**Status:** Implemented. The focused suites, typecheck, and full root suite pass.

## Goal

Make a native feature's install, uninstall, retry, adapter acquisition, and activation run in order on the existing per-feature queue owned by `FeatureRuntime`. In particular, a successful uninstall must not race with an Open action or leave a queued recovery turn to register the adapter again afterward.

Reuse `FeatureRuntime.#enqueue` through `FeatureModeLinks.enqueue`. Do not add another queue, lock, public interface, or feature lifecycle abstraction. Keep Local mode unchanged.

## Current behavior

`FeatureRuntime` owns loaded instances, active selection, load errors, and one promise queue per feature ID. `NativeFeatureMode.activate` already uses that queue and checks installed state when its turn starts. Native mode's other paths that acquire adapters also use the queue, but `NativeFeatureMode.setInstalled` does not.

The current native `setInstalled` method clears active selection before the host request, chooses `host.retryFeature` or `host.setFeatureInstalled`, waits for a snapshot, removes and disposes an adapter on uninstall, and queues acquisition after a running install. Those steps can overlap an activation turn. An activation can pass its installed check before the uninstall snapshot arrives, then acquire or activate while uninstall disposes the same adapter.

There are two less obvious queue hazards:

- `#refreshSnapshot` calls `#loadRunningNativeAdapters`, which can enqueue an acquisition for the same feature. Once `setInstalled` itself runs inside that feature's queue, awaiting another enqueue for that ID from inside the current turn would wait on the current turn and deadlock.
- `#loadRunningNativeAdapters` and `applyActive` enqueue lazy loads whose closures do not re-check state. A snapshot or page-selection event can queue a load behind uninstall. The closure could then run after uninstall and register an adapter based on stale state.

The native host has its own serial state queue, but it does not protect the Electron-side adapter instance. On successful `feature.setInstalled(false)`, `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureRuntime.swift` stops the module, releases its lease, marks it uninstalled, and publishes a snapshot. `native/moirasia-runtime/Sources/MoirasiaHost/HostApplication.swift` then persists the Shell settings. The JavaScript transaction must preserve that order while owning adapter cleanup.

## Decisions

1. **Queue the whole native state transaction.** Put every `NativeFeatureMode.setInstalled` call, both `installed: true` and `installed: false`, on the existing per-feature queue. This also serializes retries and repeated install/uninstall requests in call order. Do not queue only the final adapter disposal.
2. **Keep activation on the same queue.** Retain the existing `NativeFeatureMode.activate` turn. Its installed and transition-state checks must run when that turn begins, not before it is queued.
3. **Keep the queue owner unchanged.** Use the existing `FeatureModeLinks.enqueue` callback. Do not edit `FeatureRuntime.#enqueue`, add another queue, or add methods to `FeatureModeLinks`.
4. **Keep Local mode unchanged.** Its install, uninstall, and activation behavior is outside this change.
5. **Keep active-page clearing inside uninstall.** Clear the active feature at the start of the queued uninstall turn, before requesting the host change. Clear it again after the host reports the feature uninstalled if a renderer page report selected that feature while the request was in flight. `setActive` remains synchronous and is not moved onto the queue.
6. **Preserve host request choice.** Compute `retry` inside the queued turn from the latest accepted state. Use `host.retryFeature` for an install request when the feature is already installed and either its native state is `error` or the host has a service error. Otherwise use `host.setFeatureInstalled` with the requested flag.
7. **Keep snapshot, cleanup, and any install acquisition in the same turn.** The queue turn owns the host request, snapshot adoption, active-state reconciliation, adapter removal/disposal, and any acquisition needed after a successful install.
8. **Fence unconfirmed native state.** Keep one private per-feature transition record in `NativeFeatureMode`. It records the requested installed state, the last accepted full native snapshot revision before the request, and the host request outcome: pending, succeeded, or rejected. This is internal state, not a new interface. It prevents a stale cached `installed: true` value from allowing Open or a lazy load after a successful uninstall whose follow-up snapshot failed.
9. **Preserve native disposal behavior.** Remove the instance before awaiting `dispose`. Log and swallow disposal errors, as native mode does today. A disposal failure does not undo a confirmed host uninstall.
10. **Keep the scope in the main-process mode adapter and focused tests.** Expected changes are in `src/main/features/host-mode.ts`, `tests/feature-runtime.test.ts`, and one status-rendering test in `tests/shell-renderer.test.tsx`. Do not change Swift code, renderer controls, controller IPC, the shared feature lifecycle, or `CONTEXT.md`.

## Required ordering

For one feature ID, queue insertion order determines the result.

| Calls arrive in this order | Required result |
| --- | --- |
| Open, then Uninstall | Open checks installed state, acquires if needed, selects and activates the feature. Uninstall then clears selection, requests native uninstall, adopts state, removes the instance, and disposes it before releasing its turn. |
| Uninstall, then Open | Uninstall completes its host/snapshot/cleanup turn first. Open then checks the latest state and rejects as not installed. It does not call the loader or activate the removed instance. |
| Install, then Open | Install requests native state and adopts a fresh snapshot. If the feature is running, it acquires the adapter in the current turn. Open then uses that instance. |
| Open, then Install/Retry | Open completes first. The install or retry request runs afterward and uses the current snapshot to choose the host method. |
| Running-state recovery queued before Uninstall | Recovery finishes first. Uninstall then removes and disposes the registered instance. |
| Recovery or active-page load queued during Uninstall | Its closure re-checks current installed, transition, host-health, and instance state. It returns without loading if uninstall won. |

Different feature IDs remain independent. Shelf operations keep their existing Amove queue turn through `FeatureRuntime.#shelf`.

## Implementation steps

### 1. Strengthen the native test fake and add failing regressions

Extend the `fakeNativeClient` helper in `tests/feature-runtime.test.ts` only as far as these cases need. It should support a mutable full snapshot with an incrementing native-service `revision`, a deferred host mutation response, and a failing `host.getSnapshot` request. Continue to test through `FeatureRuntime`; do not inspect its private queue or the mode's private transition record.

Use valid `NativeHostSnapshot` fixtures for every test that exercises `setInstalled`, snapshot revisions, or the transition fence. A runtime configured with only Amove as its loader still expects only Amove in `NativeFeatureMode`, but the actual host wire snapshot must include all three known feature statuses and valid settings. Update the fake host to advance the feature-service revision and mutate Amove's installed/state fields on successful `host.setFeatureInstalled` and `host.retryFeature` calls. Existing projection-only tests may keep reduced one-feature snapshots. Revise the retry test to start from `installed: true, state: 'error'` and call `setInstalled('amove', true)` directly; a successful uninstall clears the native error and should not be used to manufacture a retry case.

Add these regression cases before changing production code:

1. **Open then uninstall.** Start from a loaded native Amove adapter. Call `runtime.activate('amove')`, then `runtime.setInstalled('amove', false)` without awaiting between calls. Record activation, host mutation, and disposal. Assert activation completes before the uninstall request and disposal follows the request and snapshot. Assert activation and disposal never overlap.
2. **Uninstall then Open.** Gate the host uninstall response. Enqueue uninstall first and Open second. Before releasing the host gate, assert Open has not loaded or activated an adapter. Return a full snapshot with Amove uninstalled and stopped. Assert the adapter is disposed once and Open rejects with the not-installed error without another loader call.
3. **Stale recovery and active-page loads.** Start with Amove installed but without an adapter after a failed initial load. Emit a full `running` snapshot and gate the recovery adapter's registration. While that recovery turn is active, enqueue uninstall, call `runtime.setActive('amove')` while the cached state still permits the selection, then emit another full running snapshot. The active-page load and second recovery are now queued behind uninstall. Release the first registration, gate the host uninstall response, then return a newer full snapshot showing Amove uninstalled and stopped. Add a later queued activation as a barrier. Assert the stale callbacks run without loading another adapter, active selection is clear, and the barrier activation rejects as not installed.
4. **Successful mid-session install does not deadlock.** Start with a full snapshot showing Amove uninstalled and stopped. Make the host mutation update the snapshot to installed/running. Await `runtime.setInstalled('amove', true)` and assert registration completes once. Then activate Amove and assert it uses that same instance. This proves the install turn calls `#links.acquire` directly instead of awaiting a nested enqueue for the same ID. The recovery turn scheduled by snapshot adoption must become a no-op when it finds the committed instance.
5. **Request rejection still releases the queue.** Make the host mutation reject before changing native state. Assert `setInstalled` rejects and does not remove or dispose the existing adapter. Then queue an activation and assert it runs, proving a rejected transition does not poison the next queue turn. Also cover a request whose native state change is visible in a fresh snapshot even though the outer host request rejects during settings persistence; in that case reconcile from the fresh snapshot, clean up if it confirms uninstalled, and still return the original host error.
6. **Snapshot failure after successful uninstall is fail-closed.** Let the host confirm the uninstall, then make `host.getSnapshot` fail. Assert the operation rejects with that snapshot error, the instance is still removed and disposed once, and the unresolved transition record prevents Open, shelf, recovery, and active-page lazy loading from acquiring against the old cached installed state. Emit a later full snapshot with a newer revision and Amove uninstalled; assert the fence clears and Open still rejects as not installed.
7. **Snapshot failure after successful install is fail-closed.** Let the host confirm an install or retry, then make the snapshot request fail. Assert no adapter acquisition occurs while state is unconfirmed. Emit a later full snapshot confirming installed/running, then assert recovery registers one adapter and a queued activation uses it.
8. **Native disposal failure remains swallowed.** Make the native adapter's `dispose` reject during a confirmed uninstall. Assert the instance is removed, the error is logged, and the transition result is governed by host/snapshot confirmation rather than the disposal rejection.

9. **Pending state stays visible and safe.** In `tests/shell-renderer.test.tsx`, render a snapshot with an installed feature, `loaded: false`, and the transition-confirmation `loadError`. Assert Open is disabled, the confirmation message is visible, and Retry remains available. This exercises the existing Features screen without changing its controls.

Use deferred promises and event logs, not sleeps. Release all gates and observe all queued promises in `finally` blocks so a failing assertion cannot strand work or create an unhandled rejection.

### 2. Queue the complete native installed-state operation

In `NativeFeatureMode.setInstalled` in `src/main/features/host-mode.ts`, return the result of `#links.enqueue(id, async () => { ... })`. Move every existing step into that closure:

1. Read the current status and calculate the retry choice only after the turn begins.
2. Clear active selection if this is an uninstall of the active feature.
3. Establish the private transition record and capture the last accepted full snapshot revision.
4. Send the existing `host.retryFeature` or `host.setFeatureInstalled` request with the existing arguments.
5. Refresh and adopt host state while retaining the queue turn.
6. For a confirmed uninstall, clear active selection again if it was selected during the request, remove the instance, and dispose it with the existing logged-and-swallowed error behavior.
7. For a confirmed install/retry whose native state is `running`, acquire in this turn with `await #links.acquire(id)`. Preserve today's behavior of not turning an adapter load failure into a host install failure; `#acquire` records its load error and running-state recovery remains responsible for a later attempt.

Do not call `#links.enqueue(id, ...)` from this closure. `#refreshSnapshot` can enqueue a recovery turn for the same ID. Awaiting that turn from inside the current turn would deadlock. Direct acquisition is safe because the current turn already owns the ID. Any recovery turn appended during the snapshot refresh runs afterward and sees the instance or the latest native state.

### 3. Add a private transition fence and reconcile stale work

Keep a private `Map<FeatureId, ...>` in `NativeFeatureMode`. It must distinguish a request still in progress from a request the host accepted. Use the existing `NativeHostSnapshot.revision`; do not add a protocol field or change `NativeHostClientLike`.

- Capture the last accepted full snapshot revision when the queued state transition begins.
- Set the pending target before sending the request so any work queued behind this turn cannot trust stale cached installation state.
- A full snapshot event received while the mutation request is pending cannot clear the record yet. When the request settles, reconcile the latest accepted full snapshot. If the request succeeded, clear the record only when a full snapshot newer than the captured revision confirms the requested installed flag. A matching event can provide that confirmation even if the following `host.getSnapshot` read fails. A partial projection, malformed snapshot, older snapshot, or newer snapshot with a conflicting installed flag does not clear the fence.
- If the host request rejects, first reconcile any newer full event that arrived while it was pending. If that event confirms the requested state, clear the fence and dispose if it confirms the feature is uninstalled. Otherwise make one best-effort full snapshot request while the turn still owns the feature. A valid post-request full read is authoritative even if the host's nested feature change committed before the outer Shell settings write failed; clear the fence and dispose if the actual state is uninstalled. Preserve and rethrow the original mutation error. If neither event nor read yields a valid post-request full snapshot, retain the fence and adapter; do not allow acquisition while the native state is uncertain. A later reconnect/full snapshot or a new explicit state operation resolves it.
- If the host request succeeds and neither a matching full event nor the follow-up full snapshot confirms the target, keep the fence. A successful uninstall request confirms that the native module stopped, so still clear active selection and remove/dispose its adapter before rejecting with the snapshot or confirmation error. A successful install/retry without confirmed status must not acquire an adapter. If a full event already confirms the target, the operation may proceed on that evidence even when the follow-up read fails.
- On an accepted full snapshot, update the latest full snapshot revision monotonically. Do not let an older full snapshot overwrite newer status or release a fence. Reconcile events received during the request only after its outcome is known: a successful request requires the requested installed value; a rejected request may use a matching newer event or a fresh post-error full `host.getSnapshot` as the authority for the actual state.

While a transition record remains, `installed`, `isLoaded`, and `describeFeature` must not advertise an actionable loaded feature from stale cache. Report the requested installed value, report `loaded: false`, and expose a clear confirmation error through the existing `loadError` field. This keeps the current Features screen behavior: Open stays disabled while loading is unconfirmed, and the existing error/Retry or Install control remains available. No renderer change is needed.

Update all queued native acquisition closures to re-check at execution time:

- `#loadRunningNativeAdapters` checks that no transition is pending, no service error is active, the feature is still installed and `running`, and no instance already exists.
- `applyActive` checks that no transition is pending, the feature is still installed, it is still the active feature, and no instance already exists.
- `activate` checks for an unresolved transition before checking installed state or calling `acquire`.
- The native Amove shelf path checks for an unresolved transition before calling `acquire`. Its outer per-feature queue stays unchanged.

These checks make queued work harmless if a snapshot or renderer event scheduled it before uninstall but it runs afterward. Keep `#refreshSnapshot`'s existing status publication and recovery responsibilities.

### 4. Preserve current behavior outside this transaction

Do not change:

- `FeatureRuntime.#enqueue` recovery behavior or its per-feature keying.
- Native launch loading, service subscriptions, snapshot validation, shell visibility, or native UI-state request formats.
- `NativeFeatureMode.activate`'s activation order: acquire, set active, then call the optional feature `activate` method.
- The retry selection between `host.retryFeature` and `host.setFeatureInstalled`.
- Native disposal order: remove the instance before awaiting its disposer; log and swallow disposer failures.
- `LocalFeatureMode`, the application controller, preload, IPC handlers, renderer controls, native Swift implementation, Amove's custom adapter lifecycle, shelf behavior, or the shared `FeatureLifecycle` module.

## Failure behavior

| Failure point | Required behavior |
| --- | --- |
| Host mutation rejects and a fresh full snapshot reports the feature installed | Clear the transition fence, keep the adapter, reject with the original host error, and allow the next queue turn to proceed. |
| Host mutation rejects but the fresh full snapshot confirms the feature is uninstalled | Clear active selection, remove and dispose the adapter, then reject with the original host error. Disposal errors are logged and swallowed. |
| Host mutation rejects and neither a newer matching event nor a fresh full snapshot establishes state | Keep the transition fence and adapter. Reject with the original host error. No later activation or lazy load may use the stale cache until a full snapshot or a new explicit state operation resolves the fence. |
| Host mutation succeeds; uninstall snapshot confirms `installed: false` | Clear active selection, remove the adapter, dispose it, and resolve. Disposal errors remain logged and swallowed. |
| Host mutation succeeds; install/retry snapshot confirms `installed: true` | Clear the fence. If native state is `running`, acquire directly in the current turn. Adapter registration failure remains a load error, not a host mutation error. |
| Host mutation succeeds; neither the latest full event nor the follow-up full snapshot confirms the requested state | Keep the fence. For uninstall, remove/dispose because the host confirmed the native stop. For install/retry, do not acquire. Reject with the snapshot error or a specific state-confirmation error. A later matching full snapshot or explicit state request is required before acquisition resumes. |
| Native adapter disposal rejects | Remove the instance first, log the rejection, and swallow it. If snapshot confirmation also failed, propagate the snapshot/confirmation error, not the disposer error. |
| A queued operation rejects | Preserve `FeatureRuntime.#enqueue` behavior: later turns recover from a rejected predecessor and still run in FIFO order. |

## Validation

Validation run from the repository root:

1. **Red/green queue regressions:** `pnpm exec vitest run tests/feature-runtime.test.ts`. The Open/uninstall ordering regression failed before queueing and passed afterward.
2. **Focused suites:** `pnpm exec vitest run tests/feature-runtime.test.ts tests/shell-renderer.test.tsx` — passed, 54 tests.
3. **Typecheck:** `pnpm typecheck` — passed.
4. **Full root suite:** `pnpm test` — passed, 351 tests.
5. **Diff hygiene:** `git diff --check`. Inspect the diff and confirm only `src/main/features/host-mode.ts`, `tests/feature-runtime.test.ts`, `tests/shell-renderer.test.tsx`, and this plan changed.

No Swift build is needed because this plan leaves native sources unchanged. There is no shell browser suite under `tests/e2e`; the focused jsdom renderer test covers the changed `FeatureStatus` state. No renderer controls or layout change.

## Acceptance criteria

- Every native install, uninstall, and retry operation shares the existing per-feature queue with Open and other native adapter operations.
- Queue order decides races. Open queued before uninstall completes first; Open queued after a confirmed uninstall rejects before acquiring an adapter.
- Native host mutation, snapshot adoption, active selection, adapter cleanup, and install acquisition stay inside the same feature turn.
- No same-ID operation awaits a later turn from inside its current turn.
- A stale running-state recovery or active-page lazy load cannot register an adapter after uninstall. Every queued closure re-checks current state when it runs.
- Successful uninstall followed by snapshot failure still removes/disposes the adapter and fences later acquisition until native state is confirmed.
- Host request and snapshot failures follow the table above. Disposal errors remain logged and swallowed. Later queue turns remain usable after rejection.
- Native retry selection and current install/load behavior remain intact. Local mode is unchanged.
- No new queue, public interface, dependency, Swift change, renderer control, or domain term is introduced.
- The focused tests, typecheck, full root suite, and `git diff --check` pass.
