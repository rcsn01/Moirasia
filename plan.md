# Implementation plan: serialize native Feature host event publication

## Decision

Deepen the existing `FeatureRuntime` in the native Feature host. It already owns module lifecycle, snapshots, and the revision value, so it is the narrowest owner for ordering those facts. Reuse the serial queue that already orders ParentConnection requests. Construct it once in `main.swift` and pass the same queue instance to both `FeatureRuntime` and `ParentConnection`. Route module snapshot hooks onto that queue asynchronously. Route semantic hooks inline only when they already run on the queue, and asynchronously otherwise.

Suppress a per-feature snapshot when its JSON payload matches that feature's last payload passed to `emit`. Keep every `host.snapshotChanged` publication and every semantic event while the Feature host is active, including `ui.toggleShelf`. Drop hook work processed after shutdown completes. Do not change the wire protocol, the external host's revision restamping, or `FramedWriter`'s output lock.

## Settled decisions

These choices are settled; no implementation decisions remain open.

| Decision | Applied choice | Reason |
|---|---|---|
| Scope | Native Feature host event publication only | The issue is in Swift `FeatureRuntime`, not the TypeScript Feature runtime or renderer. |
| Deepened module | Keep `FeatureRuntime`; do not add a separate event-publisher type | Revision, module snapshots, and event emission already meet there. A second publisher would split ownership again. |
| Queue ownership | Reuse one serial queue for both FeatureRuntime state and ParentConnection request ordering | Construct one queue in `main.swift` and inject the same instance into both modules. The main-thread signal path also enters that queue through FeatureRuntime. |
| ParentConnection | Keep the current request/connection policy on the shared queue | ParentConnection retains frame and request ordering. FeatureRuntime state and publication callbacks use that same queue, so no second runtime queue or extra request hop is introduced. |
| Callback behavior | Snapshot hooks always enqueue asynchronously. Semantic hooks run inline only when already on the shared queue, otherwise enqueue asynchronously. | A module must not wait for FeatureRuntime while it is calling a snapshot hook. Inline semantic events from an in-queue request preserve their current order before the response. |
| Duplicate snapshots | Suppress a per-feature snapshot event when its JSON payload equals the last payload passed to `emit` for that feature | These events are state snapshots. Equal payloads carry no new state. The host-wide snapshot still reports installed/running/error state. |
| Other events | Never deduplicate `host.snapshotChanged` or named semantic events | Host snapshots include aggregate status. Semantic events such as `ui.toggleShelf` represent actions, not state. |
| Revision | Increment only when an event is handed to `emit`, on the shared queue | The `UInt64` event revision is strictly increasing until its existing overflow boundary. The full snapshot stores it as a JSON `Double`, which is exact only through 2^53. Keep this existing representation and protocol unchanged. |
| Protocol and host | Keep `HostEvent`, payload schemas, HostApplication restamping, and TypeScript clients unchanged | The host already restamps events from the Feature host on its own serial queue. This plan fixes the upstream owner without changing the wire contract. |
| Test seam | Inject fake `FeatureModule` instances through an internal initializer and test the executable target with `@testable import` | This exercises the real FeatureRuntime publication path without starting PF, audio, or hotkey work. A Swift 6.4 temporary package check confirmed that a test target can depend on and import an executable target. |
| Domain vocabulary | Update the existing `Feature host` entry in `CONTEXT.md`; add no new term | Event revision and publication ownership belong to the existing Feature host concept. |
| Out of scope | No changes to product commands, Bonded policy, Shout audio behavior, host revision restamping, or renderer subscriptions | Those are not required to serialize and test event publication. |

## Current evidence

- `native/moirasia-runtime/Sources/MoirasiaFeatureService/ParentConnection.swift:15, 23-35, 63-78` creates a serial connection queue and routes requests, startup, and parent shutdown through it.
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureRuntime.swift:8, 16-24, 56-105` stores the mutable revision and installs module hooks. The hooks call publication methods directly on their caller's thread.
- No root Moirasia ADRs were found under `docs/adr/`; this plan does not reopen a recorded decision.
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureRuntime.swift:167-180` increments the same plain `UInt64` revision in host snapshot, feature snapshot, and semantic event paths. `snapshot()` writes `Double(revision)` into the full payload (`native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureRuntime.swift:155-164`), so exact payload/envelope equality is bounded by Double's integer precision.
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureRuntime.swift:94-97` publishes a feature snapshot after a successful non-read command.
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureModules.swift:37-46, 94-104, 193-203` forwards Bonded, Shout, and Amove callbacks through the hooks. Bonded schedules snapshots on its own queue (`native/moirasia-runtime/Sources/BondedRuntime/BondedRuntime.swift:288-292`); Shout calls its snapshot hook on the caller's thread (`native/moirasia-runtime/Sources/ShoutRuntime/ShoutRuntime.swift:190-214`); Amove invokes its hooks inline from an action (`native/moirasia-runtime/Sources/AmoveRuntime/AmoveRuntime.swift:86-95, 135-140`).
- Bonded commands can publish through both `FeatureRuntime`'s post-command path and a later runtime callback. Amove's `performAction` request runs on ParentConnection's queue and can emit `ui.toggleShelf` before its response (`native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureModules.swift:235-242`, `native/moirasia-runtime/Sources/AmoveRuntime/AmoveRuntime.swift:86-95`). Hotkey actions instead enter through the AppKit event handler (`native/moirasia-runtime/Sources/AmoveRuntime/AmoveRuntime.swift:29-37`, `native/moirasia-runtime/Sources/AmoveRuntime/HotkeyRegistry.swift:183-205`), outside ParentConnection's queue.
- Shout's helper replies run on the engine queue (`native/moirasia-runtime/Sources/ShoutRuntime/AudioEngine/ShoutEngine.swift:21, 126-129`). `ShoutRuntime.snapshot` and its callback-driven mutations have no shared lock or serial queue (`native/moirasia-runtime/Sources/ShoutRuntime/ShoutRuntime.swift:49-54, 190-214`); the FeatureRuntime queue does not make those module-owned accesses thread-safe.
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/SignalCoordinator.swift:5-10` runs the SIGTERM handler on the main queue. `native/moirasia-runtime/Sources/MoirasiaFeatureService/main.swift:23-25` calls `runtime.stopAll()` directly there, outside ParentConnection's request queue.
- `native/moirasia-runtime/Sources/MoirasiaProtocol/Protocol.swift:251-262` protects framed writes with a lock. That lock prevents interleaved bytes; it does not protect FeatureRuntime's revision or state. The FeatureService emit closure logs writer failures instead of propagating them (`native/moirasia-runtime/Sources/MoirasiaFeatureService/main.swift:19-22`).
- `native/moirasia-runtime/Sources/MoirasiaHost/HostApplication.swift:171-180` receives events on its state queue and assigns the outward host revision. Keep this behavior as the final cross-source ordering point.
- `src/main/native-host/client.ts:191-219` consumes the host revision. `packages/desktop-shell/src/native-feature-adapter.ts:64-84` supports both `getSnapshot()` and per-feature snapshot events. Bonded and Shout renderers fetch an initial snapshot before subscribing (`apps/integrated/Bonded/src/renderer/App.tsx:196-200`, `apps/integrated/Shout/src/renderer/App.tsx:134-138`); Amove does the same in its native controller (`apps/integrated/Amove/src/main/native-feature.ts:105-110`). Suppressing an equal update does not remove the initial state read.
- `native/moirasia-runtime/Package.swift` currently keeps `MoirasiaFeatureService` out of the Swift test target's dependencies. The existing `MoirasiaProtocolTests` cover Bonded, Shout, and Amove runtimes, but not FeatureRuntime orchestration.

## Target behavior

### State ownership

`FeatureRuntime` and `ParentConnection` receive the same serial queue, labeled `com.moirasia.feature-service.state`, constructed once in `main.swift`. Initialize the module map, hooks, and settings before exposing the runtime. After initialization, keep every access to FeatureRuntime state on that queue:

- Read the `modules` map there; do not change it after initialization.
- Keep `revision`, `settings`, `installed`, `leases`, `moduleErrors`, `shellVisible`, `shutdownErrors`, and the emitted-snapshot cache there.
- Run `handle(_:)`, `startInstalled()`, and `stopAll()` there.
- Build snapshots and emit all three event types there.
- Route `publishHook` and `eventHook` work from Bonded, Shout, and Amove through that queue.

Keep the existing synchronous internal call shape. `handle(_:)`, `startInstalled()`, and `stopAll()` use a queue-specific key: if already on the shared queue, they execute inline; otherwise they synchronously enter it. This prevents deadlock when `host.prepareToQuit` reaches `stopAll()` from inside `handle(_:)`, and serializes the SIGTERM path with incoming requests.

ParentConnection uses this same queue to serialize decoded requests and write their responses in order. Its calls into FeatureRuntime execute inline on the queue. The queue is a construction-time dependency, not a new protocol or an additional serialization hop.

### Event and revision rules

| Event path | Proposed rule |
|---|---|
| `host.snapshotChanged` | Always emit when the existing runtime calls `publishSnapshot()`. Increment revision once and include that revision in the full snapshot payload. |
| `<feature>.snapshot` | Capture the module snapshot on the FeatureRuntime queue. If it equals the last payload passed to `emit` for that feature, do not emit or increment revision. Otherwise cache it, increment revision, and pass the event to `emit`. |
| Named event such as `ui.toggleShelf` | While active, always emit. Increment revision once. Never compare it with snapshot payloads. Drop hooks queued after shutdown completes. |
| `host.getSnapshot` response | Return the revision observed on the FeatureRuntime queue with the corresponding aggregate snapshot. Do not emit an event for the read. |
| Host-forwarded revision | Leave HostApplication's existing `max(hostRevision + 1, incomingEvent.revision)` rule unchanged. |

The snapshot cache lives only for the FeatureRuntime process. It records the last payload passed to `emit`, not confirmed wire delivery: the production emitter catches and logs writer failures, and this plan adds no retry. An identical module snapshot on a start/stop transition does not require a per-feature event because `host.snapshotChanged` always carries the changed feature status. A newly started Feature host begins with an empty cache and publishes its initial snapshots.

FeatureRuntime's event envelope uses `UInt64`, while the full snapshot stores the revision as `Double`; exact field equality is guaranteed only through 2^53. Tests assert that equality at their ordinary revision values. No representation or overflow-policy change is included.

Queue submission order, not wall-clock timing, determines the shutdown boundary. Hook work submitted ahead of the `stopAll()` block runs first. Work submitted behind it, including off-queue hooks produced while a module is stopping, runs after `stopAll()` sets `shutdownErrors` and is dropped. A semantic hook called inline from the shared queue during `module.stop()` runs before that marker is set and is emitted before the shutdown snapshot. Successful shutdown stores an empty, non-`nil` `shutdownErrors` array. `startInstalled()` resets the marker before startup; production calls it only from `ParentConnection.start()`.

### Preserve the writer lock

Responses and FeatureRuntime events use the same queue after this change. Keep `FramedWriter`'s lock unchanged. Removing a protocol-level framing safeguard is unrelated to this refactor.

## Implementation sequence

### 1. Add direct FeatureRuntime test access

**Files**

- `native/moirasia-runtime/Package.swift`
- New `native/moirasia-runtime/Tests/MoirasiaProtocolTests/FeatureRuntimeTests.swift`
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureRuntime.swift`
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureModule.swift`
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/ParentConnection.swift`
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/main.swift`

**Work**

1. Add `MoirasiaFeatureService` to the `MoirasiaProtocolTests` target dependencies.
2. Import it with `@testable import MoirasiaFeatureService` in the new test file. Name its `XCTestCase` class `FeatureRuntimeTests` so the focused SwiftPM filter selects the suite.
3. Add an internal initializer that accepts `userData`, the serial queue, and a `[String: FeatureModule]` map. Require each map key to equal its module's `id`. Make the production initializer accept that same queue and delegate with the existing Bonded, Shout, and Amove module construction.
4. Install the same publish and semantic-event hooks for injected and production modules. Keep `FeatureModule` internal and do not add a package product.
5. Use a fake `BasicFeatureModule` that can update a JSON snapshot and fire either hook. Protect fake snapshot state with a lock or deterministic queue handoff so the test itself has no data race.
6. Give every fixture a unique temporary `userData` directory. The injected initializer still reads `userData/settings.json`; do not point tests at real application data. Avoid `startInstalled()` and retry paths so fixtures do not acquire Runtime leases or start hardware-backed modules.

The test-target dependency pattern was checked in a temporary SwiftPM package using the repository's Swift 6.4 toolchain. The executable target compiled as a test dependency and its `@testable` module imported without running its top-level `main.swift` code.

### 2. Share the runtime state queue

**Files**

- `native/moirasia-runtime/Sources/MoirasiaFeatureService/main.swift`
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/ParentConnection.swift`
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureRuntime.swift`
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureModule.swift`

**Work**

1. Construct one serial queue labeled `com.moirasia.feature-service.state` in `main.swift` before creating the runtime and connection. Pass that exact queue object to both initializers.
2. Replace ParentConnection's privately created queue with the injected queue. Preserve its existing order of startup, requests, close, and stop operations.
3. Store the shared queue in FeatureRuntime and set a queue-specific marker during initialization.
4. Route `handle(_:)`, `startInstalled()`, and `stopAll()` through a reentrant queue helper. Calls from ParentConnection already on the shared queue execute inline. The SIGTERM call from the main queue synchronously enters the same queue.
5. Ensure the `host.prepareToQuit` branch can call `stopAll()` without nested-sync deadlock. The queue-specific helper must execute inline when already on the shared queue.
6. Change `publishHook` to enqueue snapshot publication asynchronously. The closure must not synchronously wait for FeatureRuntime while Bonded, Shout, or Amove is publishing.
7. Change `eventHook` to emit inline only when already on the shared queue. When invoked from a module-owned queue, enqueue asynchronously. This keeps in-queue request-triggered semantic events ahead of their response without blocking external callback queues. Check `shutdownErrors` in the inline path and again when either hook's queued work runs.
8. Update the `FeatureModule` hook comments to say callbacks may fire from a module-owned queue and that FeatureRuntime schedules snapshot publication. Keep the hook types unchanged.
9. Run all mutations of runtime dictionaries, status fields, settings, and revision on the shared queue. Keep initialization-only settings loading before the runtime is exposed.
10. Make `publishSnapshot`, `publishFeatureSnapshot`, and `emitFeatureEvent` on-queue operations. Keep their event names and payload shapes unchanged.
11. Add a per-feature cache of `JSONValue` snapshots. Use its existing `Equatable` conformance, with no serialization, hashing, or generic diff layer. Skip `<feature>.snapshot` only when that feature's payload equals its own last payload passed to `emit`. Store the payload before calling `emit`. The closure logs writer failures and does not return success, so do not roll back the cache or revision after a failed write.
12. Keep host snapshot emissions unconditional. Keep named semantic events unconditional while active. Increment revision only for an event that passes the suppression and shutdown checks and is handed to `emit`.
13. Ignore module-hook work that runs after `stopAll()` has completed. Reset the shutdown marker in `startInstalled()` as it does today.
14. Leave ParentConnection framing, request IDs, response order, HostApplication revision rewriting, and the existing `FramedWriter` lock unchanged.

### 3. Add focused Swift tests

**File**

- `native/moirasia-runtime/Tests/MoirasiaProtocolTests/FeatureRuntimeTests.swift`

**Required cases**

1. **Concurrent semantic callbacks are serialized and nonblocking.** Hold the test queue behind a semaphore, fire many named-event hooks from concurrent queues, and assert every hook call returns before releasing the queue. In the test emitter, record whether each call runs on the injected serial queue using a queue-specific marker. Release the queue, drain it with `host.getSnapshot`, and use a thread-safe recorder to assert every event arrives once, every emit ran on that queue, and revisions strictly increase. Running every emit on the same serial queue proves they cannot overlap without a flaky stress assertion.
2. **Request plus callback yields one changed feature snapshot.** Have a fake module mutate its snapshot and fire `publishHook` inside `handle`. The normal post-command path emits the new value; the queued hook sees the same value and emits nothing extra. Use a follow-up `host.getSnapshot` call as a queue barrier before asserting.
3. **Off-queue snapshot hooks do not block and still publish changes.** Hold the test queue behind a semaphore, change a fake module's snapshot on its module queue, fire `publishHook`, and assert the hook call returns before releasing the test queue. Then drain the queue and assert the changed payload emits once with the next revision.
4. **The snapshot cache is per feature.** Give two fake modules the same initial JSON payload and fire both hooks; drain the queue with `host.getSnapshot` and assert both feature events emit. Re-fire an unchanged payload and drain again; assert both are suppressed. Change one module's payload, fire its hook, drain again, and assert only that feature emits, without affecting the other feature's cache.
5. **Host snapshots remain unconditional.** Start a fake module directly, without acquiring a FeatureRuntime lease, then send `feature.setInstalled` with `installed: false` twice while its module snapshot payload stays unchanged. Assert both `host.snapshotChanged` events emit, each payload revision matches its event revision at these ordinary counter values, and the repeated per-feature snapshot is suppressed.
6. **Semantic events are not coalesced and request ordering is preserved.** Have a fake module's request handler call `eventHook("ui.toggleShelf")` twice while `handle` runs on the shared queue. Assert both events are emitted before the response is returned, each with its own increasing revision.
7. **Snapshot reads observe the serialized revision.** After queued work drains, request `host.getSnapshot` and assert its revision matches the last emitted event revision at the test's ordinary counter values.
8. **Shutdown ordering and late hooks are explicit.** First enqueue a changed snapshot hook before calling `host.prepareToQuit`; assert it emits before the shutdown snapshot. In the fake module's `stop()`, invoke a semantic hook inline and assert it emits before the final host snapshot. Also arrange a callback on the fake module's own queue, release it only after `host.prepareToQuit` returns, and fire both hooks with a changed snapshot. After a `host.getSnapshot` queue barrier, assert those late hooks emitted nothing. Account for the host and per-feature snapshots that `stopAll()` itself emits. Use successful shutdown to verify the empty-but-non-`nil` shutdown marker.

Use explicit semaphores and queue barriers rather than sleeps. The event recorder and fake snapshot state must be thread-safe; do not rely on a stress assertion over revision values alone.

### 4. Keep the domain glossary aligned

**File**

- `CONTEXT.md`

Update the existing `Feature host` entry to say that the native Feature host also serializes module snapshot and semantic-event publication and owns its native event revision. Do not add a separate `Feature event publisher` term. The existing `Feature runtime` term names the TypeScript runtime and should remain distinct.

## Verification plan

Run checks in this order:

1. Focused Swift tests:
   ```sh
   swift test --package-path native/moirasia-runtime --filter FeatureRuntimeTests
   ```
2. Full native runtime tests:
   ```sh
   swift test --package-path native/moirasia-runtime
   ```
3. Runtime host and feature-service build through the repository script:
   ```sh
   pnpm runtime:build
   ```
   This script removes and recreates the ignored `native/staged/runtime` directory. Preserve any locally needed staged files there before running it; the current directory contains generated host and FeatureService binaries and app bundles.
4. Existing TypeScript event-consumer tests, without changing their contract:
   ```sh
   pnpm exec vitest run tests/native-host-client.test.ts tests/native-feature-adapter.test.ts
   ```
   Both paths exist under the root `tests/` directory.
5. Final diff review:
   ```sh
   git diff --check
   git diff -- CONTEXT.md native/moirasia-runtime/Package.swift \\
     native/moirasia-runtime/Sources/MoirasiaFeatureService/main.swift \\
     native/moirasia-runtime/Sources/MoirasiaFeatureService/ParentConnection.swift \\
     native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureRuntime.swift \\
     native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureModule.swift \\
     native/moirasia-runtime/Tests/MoirasiaProtocolTests/FeatureRuntimeTests.swift
   ```

### Manual native-mode check

On macOS with the native Feature host enabled:

1. Open Bonded and observe its native snapshot subscription.
2. Toggle monitoring once. Confirm the command resolves and FeatureRuntime emits one `bonded.snapshot` event for an identical post-command/callback state. The command response still carries its own snapshot. If the module state changes before the queued callback is handled, confirm the distinct follow-up event reaches the adapter.
3. Leave Bonded running until a monitor status or observed-flow update arrives. Confirm background updates still reach the adapter.
4. Trigger Amove's shelf hotkey. Confirm `ui.toggleShelf` still reaches the host exactly once per action.
5. Quit the suite while a module callback is active. If a Shout command is in flight, allow its existing ten-second completion timeout before treating the wait as a deadlock. Confirm shutdown completes without a post-shutdown event and all output remains valid framed JSON lines.
6. Restart the suite and confirm the fresh Feature host publishes initial snapshots with a fresh process-local cache. Verify `host.getSnapshot` reports the revision for that new Feature host process; do not compare it with revisions from the previous process.

## Acceptance criteria

- Every FeatureRuntime mutable field is read and written on the one shared serial queue after construction.
- Requests, startup, shutdown, snapshots, module snapshot hooks, and named event hooks share one revision owner.
- The FeatureRuntime `UInt64` revision increases strictly for each event handed to `emit` until its existing overflow boundary. A writer failure does not roll back the revision or cache, and no handed-off event has a duplicate or regressing revision.
- Identical per-feature snapshot payloads do not generate repeated per-feature events. Changed payloads do.
- `host.snapshotChanged` remains unconditional. Each semantic hook that passes the shutdown check is handed to `emit` once; in-queue request events remain ahead of their response. Writer errors remain logged and are not retried.
- ParentConnection and FeatureRuntime use the same queue object and still process requests in order. HostApplication still restamps revisions. FramedWriter retains its lock.
- Existing event and response schemas do not change.
- FeatureRuntime tests exercise asynchronous hooks through the injected serial queue. Production passes the same queue object to FeatureRuntime and ParentConnection.
- Focused and full Swift tests plus the runtime build pass.
- No changes to Bonded enforcement policy, Shout audio operations, Amove hotkey actions, renderer contracts, or TypeScript host clients. Off-queue event publication is serialized as specified above.

## Risks and limits

- **A module snapshot may change before its queued hook runs.** The hook carries only a signal, not a frozen payload, so FeatureRuntime reads the latest module snapshot when it handles the hook. Snapshot events represent current state, not every intermediate transition. A different payload still emits; only equal per-feature payloads coalesce. Named semantic events remain separate and are never coalesced.
- **Feature snapshot equality affects notification counts.** Only equal per-feature payloads are suppressed. FeatureRuntime's full `host.snapshotChanged` payload still publishes aggregate feature status and snapshots. HostApplication's health-only `host.snapshotChanged` events remain outside this cache and unchanged. Tests establish this separation explicitly.
- **Shutdown ordering follows queue submission order.** A hook submitted ahead of the `stopAll()` block runs first; one submitted behind it runs after. A semantic hook invoked inline during `module.stop()` is emitted before the shutdown marker; off-queue hooks queued during the stop are dropped after the marker is set. Tests cover callbacks on both sides of that boundary.
- **The FeatureRuntime queue does not make module snapshots thread-safe.** Bonded serializes its snapshot access on its own queue. Amove locks the state returned by `snapshotValues()`. Shout's `ShoutRuntime.snapshot` and its callback-driven mutations share no lock or serial queue, so a background Shout update can overlap `ShoutModule.snapshot()`. This plan leaves that pre-existing module-level synchronization issue unchanged; it only serializes FeatureRuntime state and event emission.
- **Concurrent off-queue callbacks are ordered by queue submission, not by when source actions began.** Preserve the stronger before-response guarantee only for semantic hooks invoked inline while request handling is already on the shared queue.
- **The shared queue can delay shutdown behind an active request.** Shout request handling can wait up to ten seconds in `waitForCompletion` (`native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureModules.swift:180-187`); the SIGTERM handler on the main queue waits synchronously to enter the shared queue. Keep this serialization so shutdown does not race an in-flight request, and allow for that existing timeout in the manual quit check.
- **Host-level re-sequencing can hide some upstream ordering defects.** Tests target the native FeatureRuntime directly, before HostApplication rewrites the revision.
- **Revision representation has existing high-value limits.** FeatureRuntime and HostApplication use ordinary `UInt64` increments, which trap at overflow. FeatureRuntime encodes the full-snapshot revision as `Double`, so it stops representing every integer exactly above 2^53. This plan keeps both existing representations and makes no overflow/schema change; tests assert exact equality at ordinary revision values.

## Non-goals

- Change the `HostEvent` protocol, version, payload schema, event names, or TypeScript decoders.
- Move revision ownership into `MoirasiaHost` or remove its event restamping.
- Change module command responses, module snapshot contents, or `host.getSnapshot` fields.
- Change Bonded, Shout, or Amove runtime policies or their internal queue designs.
- Deduplicate host-wide snapshots or semantic events.
- Add event persistence, replay, retries, new metrics, or a new publisher package.
- Expand this change into other architecture-review candidates.
