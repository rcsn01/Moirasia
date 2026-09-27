# Implementation plan: serialize pending login-item retries

## Decision

Deepen the existing `ApplicationController` so pending login-item retries use the same per-application queue as explicit commands. Today `#action` queues `open`, `quit`, and `setLoginItem`, while `refresh()` calls `#retryPending()` directly. The visible shell polls `refresh()` every two seconds, but `SwiftApplicationAgent.setLoginItem()` can take up to five seconds. Retries can overlap explicit changes, and serializing them without coalescing would let each poll add another failed retry to the queue.

Keep the public `ApplicationController` interface and `ApplicationAgent` seam unchanged. Add a private snapshot-reconciliation helper, a generic queue helper, and a private per-ID retry-promise map; add no module or public seam. Tests will exercise the behavior through the Controller and its existing injected fake agent.

## Expected behavior

- For one application, explicit commands and automatic login-item retries run in the order they enter that application's queue.
- Per-application queues remain keyed by ID. Explicit commands for different applications can run concurrently; each `#retryPending()` invocation retains its sequential `APPLICATION_IDS` loop, so that pass does not run different IDs' retries concurrently.
- A retry rechecks its pending flag and the latest reconciled installed status/path inside its queued turn. A user command may have cleared the pending flag while the retry waited.
- When the pending flag is still set at retry scheduling, overlapping public refreshes for one ID share its queued or running retry promise. They do not append repeated attempts while a five-second agent call is still running. A later refresh can retry again if the pending flag remains set after that promise settles.
- A rejected retry agent call remains silent and leaves the pending flag set. Explicit command failures continue to populate the application error. Their existing error behavior does not change.
- `refresh()` still reads the application snapshot, waits for each retry it schedules or joins while the pending flag is set, emits one controller snapshot, and returns the latest state.
- An explicit command still performs a final application snapshot before returning. That internal snapshot reconciliation will not run retries. Background retries run from public `refresh()` calls, including the initial and periodic shell refreshes. This avoids queue re-entry and cross-application wait cycles.
- No renderer, native agent, settings format, or IPC changes are needed.

## Decisions settled with recommended defaults

The user asked to apply the recommended answer to each clarification. These are the choices used in this plan.

| Question | Applied decision | Reason |
|---|---|---|
| What is in scope? | The pending login-item retry in `ApplicationController.#retryPending()` and its interaction with queued application commands. | This is the state-changing path that bypasses the queue. |
| Which module owns the change? | Keep `ApplicationController`; add no new module. | It already owns application facts, retries, error reporting, and command ordering. |
| What sits behind the seam? | Keep the existing `ApplicationAgent` seam and its production `SwiftApplicationAgent` and test fake. | The tests already substitute an agent and can control asynchronous calls. A second seam is unnecessary. |
| What is serialized? | Use one queue per `ApplicationId` for commands and retries. Commands on distinct IDs remain concurrent. Keep `#retryPending()` sequential in catalog order, and let overlapping refreshes share one retry promise per ID. | This extends the existing per-application rule without a global lock or a backlog of duplicate retries. |
| How does a queued retry decide whether to run? | Recheck the settings flag and latest reconciled installed status/path inside its queued turn. | An explicit command can resolve the pending work while the retry waits. The retry uses Controller state already refreshed by an agent snapshot; it does not take another agent snapshot inside the queue. |
| How are overlapping retries handled? | When pending remains set, concurrent refreshes await the same queued or running retry for one ID. A later refresh can retry again if pending remains after it settles. | The visible shell polls every two seconds and the agent call times out after five seconds. Without coalescing, failed retries can pile up and delay explicit commands. |
| How is refresh divided? | Public `refresh()` reconciles the snapshot and then retries. The final refresh inside `#action` reconciles only. | Calling retry orchestration while an action holds its queue can deadlock, including when two actions hold different application queues. |
| What happens to failures? | Keep rejected retry agent calls silent and pending. Keep explicit command errors visible. | A background attempt is best effort; a user command must still report failure. |
| Is the public interface changing? | No. Preserve controller methods, the injected `ApplicationAgent` shape, and snapshot fields. | Tests can verify ordering through existing methods. |
| Do domain docs change? | Sharpen the existing `Controller` glossary entry to include automatic pending retries. Add no new domain term or ADR. | The glossary should describe the expanded ownership accurately. |

## Current evidence

- `src/main/application-controller.ts:21` stores one queue per `ApplicationId`.
- `src/main/application-controller.ts:31-35` implements `refresh()` by reading `ApplicationAgent.snapshot()`, updating application facts, running `#retryPending()`, and emitting a snapshot.
- `src/main/application-controller.ts:36,50,53-61` routes `open`, `quit`, and explicit `setLoginItem` through `#action`.
- `src/main/application-controller.ts:66-81` serializes an action and holds its queue turn through a final refresh. It rechecks installation state after the wait and rebuilds the current agent record.
- `src/main/application-controller.ts:83-89` runs pending retries directly. It reads a status and calls `agent.setLoginItem()` without entering `#queues`.
- `src/main/shell-window.ts:94-98, 109, 143` polls `controller.refresh()` every two seconds while visible and also refreshes on focus and window creation. `src/main/ipc.ts:16` exposes refresh to the renderer; `src/main/ipc.ts:47` handles explicit login-item changes.
- `src/main/application-controller.ts:96-98` runs agent snapshots with a five-second timeout; `src/main/application-controller.ts:103-108` gives login-item commands the same timeout.
- The catalog has four IDs in order: Amove, Vox, Bonded, Shout (`packages/desktop-shell/src/application-catalog.ts:18-24`). The macOS agent currently reports only Amove, Vox, and Bonded (`native/application-agent/main.swift:5-6, 112-113`); the Controller maps missing Shout records to uninstalled/no path. Its snapshot computes `installed` and `path` with separate lookups (`native/application-agent/main.swift:113`), so the path check still matters if installation changes between them. Do not treat this plan as adding Shout agent support.
- `LoginItemControlResult.status` includes `requires-approval` (`packages/desktop-shell/src/index.ts:24-29`), and the login-item control returns it when macOS requires approval (`packages/desktop-shell/src/login-item-control.ts:24-29`).
- `tests/application-controller.test.ts:152-182` covers same-application command ordering and concurrency across different applications, but both ordering checks currently use zero-delay timers. Replace those waits with deterministic fake-agent call-entry signals/barriers while extending the fake.
- `tests/application-controller.test.ts:184-220` covers explicit login-item changes, automatic retry success, and silent retry failure. It does not interleave a retry with an explicit command or another refresh, and it does not cover a missing path or non-enabled retry result.
- `tests/application-controller.test.ts:11-62` already provides a scripted `ApplicationAgent` fake with call logging, gates, and failure controls. Extend that fake rather than exporting a queue or adding another test-only seam.
- `CONTEXT.md` already defines the `Controller` term. No root `docs/adr/` directory exists, and this change does not reverse a recorded decision.

## Architecture

`ApplicationController` remains the one deepened module. Its interface continues to own the application snapshot and command outcomes. Its private per-application queue becomes the shared ordering mechanism for commands and retries targeting one application. A private map of queued/running retry promises coalesces overlapping refreshes by ID. `SwiftApplicationAgent` remains the production adapter; the scripted test fake remains the test adapter.

Keep public snapshot reads outside the per-application queue except for the final snapshot that `#action` currently awaits before releasing its turn. A retry reads the latest `ApplicationStatus` already reconciled into Controller state; it does not take a fresh agent snapshot after waiting. Snapshot reads do not mutate login-item settings, but they can overlap commands and update the status used by a queued retry.

The deletion test says to keep both pieces of current behavior. Removing the retry loses login-item repair; removing the queue lets same-application writes race. The change concentrates retry ordering in the queue the Controller already owns.

## Required invariants

1. A queued `open`, `quit`, explicit login-item change, or automatic retry for one ID never overlaps another queued operation for that ID.
2. Queue insertion order determines command/retry order. An explicit request submitted while a retry is in flight waits behind it. A retry submitted behind an explicit request waits, then rechecks whether it still has work.
3. Queue state remains keyed by `ApplicationId`. Explicit operations for different IDs can run concurrently. Each `#retryPending()` invocation retains its current sequential `APPLICATION_IDS` order; this is not a global queue or a promise that retries across concurrent refreshes are serialized.
4. At most one automatic retry per ID may be queued or running. If pending is still set when an overlapping refresh reaches retry scheduling, it awaits that same promise instead of adding another retry. After it settles, a later refresh may retry again if pending remains.
5. The queue recovers after a rejected operation so one failed call does not poison later work.
6. A retry checks `pendingLoginItems[id]` again after waiting. If the flag is gone, it makes no agent call.
7. A retry reads the latest reconciled `ApplicationStatus` when its turn starts, not a fresh agent snapshot. It skips an application that is no longer installed or has no path in that state.
8. A retry calls `setLoginItem(path, id, true)` and stores every returned login-item result. It clears pending only when the returned status is `enabled`; `requires-approval` and other non-enabled results remain pending.
9. A rejected retry agent call stays silent and leaves the pending flag set. If `clearPending()` rejects after an enabled retry result, its in-memory flag has already been removed before persistence (`src/main/settings.ts:29-32`), and the retry catch swallows the failure. For an explicit `setLoginItem`, the same persistence failure propagates through `#action` and becomes a visible command error even though the in-memory flag was removed. Preserve both existing paths; do not claim persistence failure rolls the flag back or expand this plan into persistence recovery.
10. An explicit `setLoginItem` keeps its current behavior: it runs through `#action`, stores its result, clears pending on either `enabled` or `disabled`, and records a failed command on the application status.
11. `#action` must not await a pending retry while holding its queue turn. Its final snapshot reconciliation is snapshot-only and remains in the existing `finally` path. This prevents self-deadlock and cross-application wait cycles while preserving reconciliation after both successful and failed commands.
12. Public `refresh()` reconciles the application snapshot, awaits each retry it schedules or joins while pending remains set, emits once after retry outcomes land, and returns a snapshot that includes those outcomes.
13. No queue state, retry-promise map, pending flag, or new field is added to persisted settings or the renderer contract.

## Implementation sequence

### 1. Add deterministic interleaving tests

Edit `tests/application-controller.test.ts` first.

Extend `makeAgent()` so tests can gate `open`, `quit`, and `setLoginItem` by application and direction, return chosen `LoginItemControlResult` statuses, and expose deterministic call-entry signals, including for `snapshot()`. Track active and maximum simultaneous `setLoginItem` calls. Replace the existing zero-delay waits in the same-ID and different-ID tests with deterministic signals/barriers. Reuse the existing deferred-promise helper; do not add a queue test seam.

Add or extend these cases through the public Controller interface:

1. **Retry then explicit change.** Load application records, mark Amove pending, and start `refresh()`. Hold the automatic `setLoginItem(amove, true)` call on a gate. Submit `setLoginItem(amove, false)`. While the retry remains gated, drain the known promise/microtask chain and assert the call log has not gained the explicit `off`; an unqueued implementation would enter before the gate is released. Release the gate and await both calls. Assert the order is `on`, then `off`, maximum active calls is one, the final login-item result is disabled, and the pending flag is clear.
2. **Explicit change makes a queued retry obsolete.** Load application records, mark Amove pending, and hold an explicit `setLoginItem(amove, false)` after it enters the queue. Start a public `refresh()` and use its snapshot-entry signal plus a deterministic microtask barrier to ensure it has queued a retry behind that command. Release the explicit call. Assert its disabled result is stored and it clears the pending flag. Assert the queued retry rechecks the flag and does not issue `setLoginItem(amove, true)`.
3. **Overlapping refreshes share one retry.** Mark Amove pending, hold the first automatic retry, and start a second `refresh()`. Use its snapshot-entry signal plus a deterministic microtask barrier to ensure it has reached retry scheduling while pending remains set, before releasing the first gate. Release with an enabled result. Await both refreshes and assert one `on` call total, both refreshes include the settled result, and maximum active calls is one.
4. **A later refresh retries after a failed attempt.** Extend the existing silent-retry-failure test: after the first refresh settles with the pending flag intact, clear the fake failure and call `refresh()` again. Assert a second attempt runs and clears pending. This proves the coalescing entry is removed after settlement rather than suppressing all future retries.
5. **A queued retry uses the latest reconciled installed state.** Load application records, mark Amove pending, and hold `open(amove)` in its queue. Start a public refresh. Use a snapshot-entry signal, then drain the known promise/microtask chain while the open gate remains closed so the refresh has reconciled its captured installed record and queued the retry. Change the fake records so Amove is uninstalled, then release `open`. Its final snapshot reconciliation updates Controller state before the retry turn. Assert the retry makes no login-item call and leaves pending set.
6. **An installed record without a path is skipped.** Give Vox an installed record with no path, mark it pending, and call `refresh()`. Assert no `setLoginItem` call occurs and pending remains. This is distinct from the uninstalled-after-wait case.
7. **A non-enabled retry result remains pending.** Return `requires-approval` for the automatic `on` call. Assert the result is stored, pending remains, and no application error is added. This is a result value the production login-item control can return.
8. **Action-final reconciliation does not retry.** Load application records, mark Amove and Vox pending, and make the explicit `setLoginItem(amove, false)` call fail. Assert the final snapshot reconciliation performs no automatic `on` calls for either ID and both pending flags remain set. Clear the fake failure, call public `refresh()`, and assert both pending retries then run. This covers the failed command's own ID and another application's pending work.
9. **Different applications remain concurrent.** Keep the existing test that gates one application's action while another application's action proceeds. It protects per-ID command concurrency. Do not infer from this test that the sequential retry loop runs different IDs concurrently.

Keep the existing tests for explicit result storage and visible command errors. The second case above pins explicit `disabled` result storage and pending clearing; retain the existing enabled-result and silent-agent-failure retry assertions. The current suite has no test for a missing retry path or a non-enabled retry result, so add the cases above rather than leaving those as conditional work.

Run the focused tests before changing production code. The interleaving cases should fail against the current direct retry path.

### 2. Extract snapshot reconciliation from retry orchestration

In `src/main/application-controller.ts`, move the body that reads `agent.snapshot()` and rebuilds `#applications` into a private snapshot-reconciliation helper.

The helper must preserve existing behavior:

- Rebuild all four application statuses from catalog facts and agent records.
- Preserve each prior `loginItem` result and any current application error.
- Update `#applications` only. Do not run retries or emit from this helper.

Then make public `refresh()` perform these steps in order:

1. Reconcile the application snapshot.
2. Run `#retryPending()`, joining any retry already queued or running for an ID.
3. Emit once.
4. Return `snapshot()`.

Change the final refresh in `#action` to call the snapshot-only helper and emit the same final controller update. Keep it in the current `finally` path so reconciliation runs after both success and failure; do not call public `refresh()`, because public refresh starts retries and can re-enter a queue already held by `#action`. Preserve the current error behavior if this final snapshot itself fails.

Keep `#action`'s current checks and behavior: reject an initially uninstalled application, recheck installed state inside the queued turn, rebuild the record from current status, clear prior errors before the operation, record explicit operation failures, and reconcile application facts before the turn completes.

### 3. Share the per-application queue

Factor the existing queue chaining into one private generic helper used by both `#action` and `#retryPending`.

The helper should:

- Select the previous promise for the same `ApplicationId`, or an already-resolved promise if there is none.
- Recover from a rejected previous operation before running the next operation.
- Append the new operation and store its promise under that ID.
- Return the new operation's typed promise to its caller.

Keep the queue map private. Do not export a lock, queue interface, or queue class. A private generic helper is enough because the existing `ApplicationAgent` injection already gives tests a second adapter at the seam.

`#action` uses this helper for its existing application commands. `#retryPending` uses it for the automatic login-item write. Keep the queue turn around explicit operation plus final snapshot reconciliation, as today. A retry's queue turn includes its eligibility checks, agent call, result update, and pending-flag clear so another writer cannot split that transition.

### 4. Route each retry through its queue

Keep the retry loop in `#retryPending()` and preserve the current `APPLICATION_IDS` iteration order. For each ID:

- Skip it early when the settings snapshot has no pending flag.
- If that ID already has a queued or running retry promise, await that promise instead of enqueueing a duplicate.
- Otherwise enter that ID's queue and store its promise in a private per-ID retry map before yielding. Remove the entry in `finally`, only if it still points to that same promise, so later refreshes can retry work that remains pending.
- Inside the queued operation, read settings again. Return without an agent call if the pending flag was cleared while this retry waited.
- Read the latest reconciled application status from `#applications`. Return if it is no longer installed or its path is absent. Do not query `agent.snapshot()` again inside the queued operation.
- Call `agent.setLoginItem(status.path, id, true)`.
- Store every returned `loginItem` result.
- Clear the pending setting only for `enabled`; leave it set for every other returned status.
- Preserve the current best-effort catch around the retry and pending-flag update. A rejected agent call remains silent and leaves the pending flag set. If persistence rejects after `clearPending()` has removed the in-memory flag, do not claim that value is restored or expand this plan into persistence recovery.

The retry promises and the queue remain private. Keep the loop sequential; a single refresh does not run retry agent calls for different IDs in parallel. Do not call `refresh()` from inside a retry operation. In particular, a retry queue turn must not trigger another `#retryPending()` pass.

The catalog contains four IDs, but the current macOS agent snapshot reports only Amove, Vox, and Bonded. The Controller sees Shout as uninstalled/no path and skips it. Preserve that current behavior; adding Shout support is outside this change.

### 5. Update the domain glossary

In `CONTEXT.md`, sharpen the existing `Controller` entry so it says the Controller owns per-application serialization for `open`, `quit`, explicit login-item changes, and pending login-item retries. Preserve the existing description of application facts and command ordering. Add no new term.

No ADR is needed. No architecture document needs a change for this focused Controller behavior.

### 6. Verify

Run checks in this order:

1. `pnpm exec vitest run tests/application-controller.test.ts`
2. `pnpm typecheck`
3. `pnpm test`

The focused suite verifies observable ordering through the Controller interface. Typechecking catches queue helper and promise typing errors. The full suite provides broad regression coverage, but do not claim it directly verifies shell polling or the refresh IPC handler: `tests/shell-window.test.ts` covers window lifecycle without asserting refresh cadence, and there is no dedicated IPC refresh test. The public Controller interface remains unchanged, so no shell or IPC code needs modification. This plan changes no rendered UI, so browser testing is not needed.

## Risks and limits

- **Retry timing after an action.** The old `#action` final `refresh()` retried every pending ID, including the command's own ID when an explicit login-item operation failed and left its flag set. The new internal snapshot-only reconciliation will not. Pending retries will run at the next public `refresh()`. That normally occurs at shell creation, focus, explicit refresh, or the visible-window polling interval. The plan chooses this timing change over retry orchestration inside a held queue, which can deadlock.
- **Pending state changes while waiting.** The pre-queue check is only an optimization. The in-queue check is required for correctness.
- **Snapshot freshness stays unchanged.** Public `ApplicationAgent.snapshot()` calls stay outside the per-application queue, and concurrent refreshes can complete their snapshots out of order. A retry checks the latest status written into Controller state, not a fresh agent snapshot taken after the wait or necessarily the newest OS observation. The app can be removed or moved after that snapshot; the control call may then fail and remain pending for a later refresh. This plan coalesces retries, not snapshot requests, and does not add global agent serialization.
- **Each refresh retry pass remains sequential across IDs.** Keep the current loop order. Per-ID queues allow explicit commands on other IDs to proceed. This does not add a global lock across concurrent refreshes.
- **Polling must not build a retry backlog.** The visible shell polls every two seconds, and the login-item executable has a five-second timeout. Share one queued/running retry promise per ID across overlapping refreshes. After it settles, a later refresh may retry again if pending remains.
- **No user-facing error for a failed agent retry.** It continues to wait for the next refresh, matching current behavior. A failed settings write follows the existing store semantics and is not redesigned here.

## Out of scope

- Changing the Swift application agent or its command protocol.
- Changing explicit command error messages or login-item result handling.
- Serializing work globally across applications.
- Adding locks to `ShellSettingsStore` or changing settings persistence.
- Moving retries to `ShellWindowLifecycle`, IPC, or a new module.
- Changing refresh intervals, retry backoff, or adding retry telemetry.
- Adding renderer controls, UI states, or new application status fields.
- Revisiting native Feature host recovery or any unrelated recent architecture work.

## Completion criteria

- Every `ApplicationController` call to `ApplicationAgent.setLoginItem()` for an application, whether explicit or automatic, runs in that application's existing serialized queue.
- The interleaving tests prove no same-application overlap, stale pending flags and uninstalled/pathless applications are skipped, and overlapping refreshes that still observe pending work share one retry promise.
- A later refresh can retry again after an agent rejection or non-enabled result leaves pending set.
- Explicit commands on different application IDs remain independent; retry calls within one `#retryPending()` pass remain sequential in catalog order.
- Retry failure, explicit error reporting, setting-clear rules, and controller snapshots keep the behaviors listed above.
- The Controller term in `CONTEXT.md` reflects retry ownership.
- The focused tests, typecheck, and full test suite pass.
