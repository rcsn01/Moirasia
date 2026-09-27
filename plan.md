# Implementation plan: concentrate child-generation UI-state recovery in MoirasiaHost

## Decision

Deepen `HostApplication` by extracting its parent-side recovery slice into one internal module, `HostUiStateRecovery`. Today the recovery machine is spread across the host: the memory-only copy plus six flags live as instance fields (`HostApplication.swift:51-57`), and the rules around one replay — generation fencing, the first-full-snapshot gate, coalescing of in-flight changes, outcome handling — are spread across `receive` (`:206-223`), `receiveHealth` (`:225-250`), `mergeHostUiState` (`:263-278`), and the replay send/complete pair (`:289-322`). `f07ad0c` (replay after child restart) introduced the whole machine in one change and had to reason about all of those paths at once; `3d84939` (serialize Feature host events) and `2c3cd4b` (retain UI state) shaped the child-side event serialization and retention that the machine coordinates with.

The new module owns that machine: the recovery copy, generation fencing, the first-full-snapshot replay gate, coalescing of changes that land while a replay is in flight, and the replay outcome handling. `HostApplication` keeps every I/O concern: the control server, the parent revision, settings injection, the supervisor transport, the launcher, and the status item. The change is behavior-preserving. All ten `HostRecoveryTests` must pass without modification; they pin behavior at the host's external seam and are the gate for the extraction.

The deletion test says the module earns its keep: delete it and the copy, the six flags, and the four methods scatter back across `HostApplication`'s callbacks, so the complexity concentrates here instead of moving.

## Expected behavior

Nothing observable changes. The behaviors that must survive the extraction exactly:

1. A `host.setUiState` patch carrying a subset of the three recognized fields (`mainVisible`, `mainFocused`, `shelfVisible`) merges into the recovery copy; unknown keys and empty params change nothing; a patch containing any malformed recognized field absorbs nothing (all-or-nothing), while the request is still forwarded verbatim and the child's error is returned to the client.
2. Retention is unconditional on the child's outcome: a patch retained while the child is unavailable is replayed on the next generation.
3. After a supervised child restart, the parent replays the full retained copy exactly once, after the first full `host.snapshotChanged` event of the new generation. Partial or malformed snapshot payloads never trigger a replay, and later full snapshots in the same generation do not re-trigger one.
4. Changes retained while a replay is in flight coalesce into one trailing replay when that replay completes, carrying the full copy. The chain repeats only while further changes land during in-flight replays; each completion sends at most one trailing replay.
5. A replay that fails with a transport error (`feature_service_crashed`, `feature_service_unavailable`) clears the dirty flag and waits for the next generation. A product error is never retried for its own sake — no announcement, no resend — but a change retained while it was in flight still gets its one trailing replay, and a clean product-error completion ends the cycle without looping.
6. A successful replay (initial or trailing) bumps the parent revision once and broadcasts `host.uiStateChanged` with the full copy params. A replay superseded by a trailing replay announces nothing until the trailing replay succeeds.
7. Events and health observations from stale or terminal generations are dropped: no broadcast, no health-fact update, no replay completion effect.
8. `desktopApplicationExited` retains all-false values and still forwards the reset request to the child even when the copy already holds false, ignoring the response.
9. Everything else (revision monotonicity, settings injection into snapshot payloads, health payload broadcasting, launcher shows on `ui.openShell`/`ui.toggleShelf`, shutdown) is untouched.

## Decisions settled with recommended answers

The user asked to apply the recommended answer to each clarification. These are the choices used in this plan.

| Question | Applied decision | Reason |
|---|---|---|
| What is in scope? | The parent-side recovery slice of `HostApplication`: the memory-only recovery copy, generation fencing, the first-full-snapshot replay gate, replay coalescing, and replay outcomes. | One rule spread across five call paths is the friction; nothing else in the host changes. |
| Which module owns the change? | A new internal module, `HostUiStateRecovery`, in `native/moirasia-runtime/Sources/MoirasiaHost/HostUiStateRecovery.swift`. `HostApplication` remains the host orchestrator and owns all I/O. | The recovery machine is one concept and deserves one module; no existing module fits, and the child-side `FeatureRuntime` already owns in-child retention. |
| Is a new package target or protocol added? | No. The module is internal to the `MoirasiaHost` executable target; no protocol, no port, no `Package.swift` change. | One adapter means a hypothetical seam. Nothing varies across a port in production; new files are picked up by the existing target globs. |
| What is the interface? | Three transition methods (`accept(event:generation:)`, `acceptGeneration(_:generation:)`, `retain(_:)`) plus two constructor-injected effect closures (`sendReplay`, `announceRestored`). | Depth: three methods hide validation, fencing, gating, coalescing, and outcome handling behind a small interface. |
| How is health reported to the module? | A neutral `GenerationObservation` enum (`.started`, `.running`, `.ended`) mapped at the call site; `.error` and `.stopped` both map to `.ended`. | The module is a generation state machine, not a supervisor observer; it should not reference `FeatureServiceSupervisor`. |
| What do the effect closures do? | `sendReplay` forwards a tagged `host.setUiState` through the supervisor and hops the completion to the state queue exactly once; with no supervisor it completes immediately with `feature_service_unavailable`, tagged with the caller's generation. `announceRestored` bumps the parent revision and broadcasts `host.uiStateChanged` with the full copy params. | The module owns the rules; the host owns transport and revision. Production wiring and test captures are two adapters at the internal seam, so the seam is real. |
| What happens to `forwardTagged`? | The replay send is its only caller that consumes the tag; `forward` (`:189`) wraps it and always drops the tag. After the extraction the replay send moves into the module's `sendReplay` effect, `forward` becomes its only remaining caller, and `forwardTagged` inlines into `forward` with the identical nil-supervisor error code and message. | Deletion test: the module absorbs the tagged path; the untagged `forward` keeps its exact behavior. |
| Is the flag set simplified? | `initialReplayAttempted` collapses into `initialSnapshotReceived`. Both always flip together in the gate and reset together on `.started`, so the inner check is always true when reached. The module holds the copy plus five flags. | Provable equivalence (below): both flags are written only in the gate branch (`:210`, `:212`) and in the `.started` reset (`:232-233`), so they are always equal and the inner check is dead. |
| What is the threading contract? | The module is single-threaded by contract: every call occurs on the host state queue. No locks, no queue injection, no `DispatchSpecificKey` assertion. | The host already serializes every call site; assertions would add interface weight for no behavioral gain. The contract is documented in the module's doc comment. |
| How is the module constructed? | In `HostApplication.init`, immediately after `super.init()`, into a `private var uiStateRecovery: HostUiStateRecovery!`; both closures capture `self` weakly. The constructor signature does not change. | Swift forbids capturing self before phase 1 completes, and an IUO property is implicitly nil-initialized; weak captures avoid a retain cycle. `main.swift:36` and the `HostRecoveryTests` harness are untouched. |
| Which tests survive? | All ten `HostRecoveryTests` pass unchanged; they pin behavior at the host's socket seam. New `HostUiStateRecoveryTests` target the module's interface directly. The supervisor and FeatureRuntime suites are untouched. | The interface is the test surface: the host suite keeps crossing the host's external seam; the module suite crosses the internal seam. Editing the host suite would hide wiring regressions. |
| Is the copy persisted? | No. It stays memory-only, as `CONTEXT.md` and `docs/architecture/standalone-applications.md:29` record. | No confirmed requirement; persistence would change crash-recovery semantics and belongs to a future decision. |
| Do the domain docs change? | Add the **Host UI-state recovery** term to `CONTEXT.md`. The term is already present in the current working tree as an uncommitted edit, inserted after the Feature host entry; executing this step means verifying its position and wording and keeping it. No ADR: no `docs/adr/` directory exists and nothing here reverses a recorded decision. | The module names a concept the glossary describes but does not name. |

## Current evidence

- `native/moirasia-runtime/Sources/MoirasiaHost/HostApplication.swift:51-57` — the recovery copy (`hostUiState`) plus the six flags (`activeGeneration`, `generationTerminal`, `initialSnapshotReceived`, `initialReplayAttempted`, `replayInFlightGeneration`, `replayStateChanged`).
- `:47-50` — `revision`, `serviceState`, `serviceError`, `serviceRestartCount` stay host-owned; they are broadcast facts, not recovery state.
- `:169-180` — the `host.setUiState` handler merges into the copy, forwards the client request verbatim, and on success broadcasts `host.uiStateChanged` with the request params (the patch, not the full copy).
- `:188-198` — `forward` wraps `forwardTagged` and drops the tag; `forwardTagged`'s nil-supervisor branch completes with `feature_service_unavailable` tagged `activeGeneration ?? 0`. `forward` (`:189`) and the replay send inside `sendUiStateReplay` (`:294`) are its only callers, and the replay send is the only one that consumes the tag.
- `:206-223` — `receive` fences on `activeGeneration == generation && !generationTerminal` (`:208`), runs the gate (`:209-215`), then bumps the revision, injects settings, broadcasts, and shows the launcher.
- `:225-250` — `receiveHealth`: a newer `.starting` resets the generation flags (`:228-235`); other states are accepted only for the active non-terminal generation (`:237`); `.error`/`.stopped` mark terminal and clear replay state (`:238-242`); accepted observations update the health facts and broadcast the health payload (`:244-248`).
- `:252-261` — `desktopApplicationExited` merges all-false and forwards the reset unconditionally, ignoring the response.
- `:263-278` — `mergeHostUiState` validates all recognized fields before absorbing anything (a present-but-non-boolean value returns without applying any key), merges, and marks `replayStateChanged` when a replay is in flight.
- `:280-287` — `isFullSnapshot` requires `version == 1`, a `revision` number, a `settings` object, and a `features` array.
- `:289-300` — `sendUiStateReplay` guards the active generation, builds a fresh-UUID `host.setUiState` request from the full copy, clears the dirty flag, records the in-flight generation, and forwards tagged with a state-queue hop.
- `:302-322` — `completeUiStateReplay` guards the active, non-terminal, matching in-flight generation; transport failures clear the dirty flag and wait for the next generation; a dirty flag sends one trailing replay; success bumps the revision and broadcasts the full copy.
- `native/moirasia-runtime/Tests/MoirasiaProtocolTests/HostRecoveryTests.swift:21-285` — ten tests pin the behaviors: partial merge and replay after snapshot, malformed field does not partially update, unavailable update retained for the next generation, only a complete snapshot after starting triggers replay, later full snapshots do not re-trigger, stale/terminal callbacks cannot complete recovery, in-flight changes coalesce into one trailing request, a product error still delivers one trailing request when a change landed in flight and never loops while transport failures wait for the next generation, successful replay uses an increasing parent revision and existing payload, desktop exit updates the copy before forwarding.
- `native/moirasia-runtime/Tests/MoirasiaProtocolTests/FeatureServiceSupervisorTests.swift` — pins supervisor generation tagging and pending-request completion; untouched by this plan.
- `native/moirasia-runtime/Package.swift` — `MoirasiaHost` executable target; `MoirasiaProtocolTests` already uses `@testable import MoirasiaHost`, so an internal module is directly testable with no manifest change.
- `native/moirasia-runtime/Sources/MoirasiaHost/main.swift:36` — the only production construction site; the default `supervisorFactory` path. `HostApplication`'s constructor signature does not change.
- `CONTEXT.md:10` — the Feature host term records the recovery copy as memory-only and the replay-after-first-full-snapshot rule. `docs/architecture/standalone-applications.md:29` adds that recovery across a full `MoirasiaHost` restart and Electron reconnect resynchronization remain outside this path.
- `f07ad0c` introduced this machine in one change and had to reason about every one of those paths at once; `3d84939` and `2c3cd4b` never touched the host recovery paths — they shaped the child-side event serialization and retention the machine coordinates with.

## Architecture

`HostUiStateRecovery` is a deep module: a small interface over a large implementation.

```swift
/// Owns the parent-side recovery copy of reported host UI state and the
/// replay cycle that restores it after a supervised child restart.
///
/// Contract: every method must be called on the host state queue. The module
/// is not thread-safe. The copy is memory-only; recovery across a full
/// `MoirasiaHost` restart and Electron reconnect resynchronization are
/// outside this module.
final class HostUiStateRecovery {
    enum GenerationObservation {
        case started   // a new child generation is starting
        case running    // the active generation is running
        case ended      // the active generation errored or stopped
    }

    typealias ReplaySender = (HostRequest, UInt64, @escaping (HostResponse, UInt64) -> Void) -> Void
    typealias RestoredAnnouncer = ([String: JSONValue]) -> Void

    init(sendReplay: @escaping ReplaySender, announceRestored: @escaping RestoredAnnouncer)

    /// Fences stale or terminal generations and drives the first-full-snapshot
    /// replay gate. Returns false when the host must drop the event.
    @discardableResult
    func accept(event: HostEvent, generation: UInt64) -> Bool

    /// Fences stale observations; a new `.started` resets per-generation state
    /// and `.ended` marks the generation terminal. Returns false when the host
    /// must drop the observation.
    @discardableResult
    func acceptGeneration(_ observation: GenerationObservation, generation: UInt64) -> Bool

    /// Merges a UI-state patch into the recovery copy. All recognized fields
    /// must be valid or nothing is absorbed; a no-op patch changes nothing.
    func retain(_ params: [String: JSONValue])
}
```

The implementation behind that interface: the copy struct, `activeGeneration`, `generationTerminal`, `initialSnapshotReceived`, `replayInFlightGeneration`, `replayStateChanged`, the all-or-nothing validation, the full-snapshot shape check, and the replay send/complete cycle with coalescing and outcome classes.

The dependency category is in-process: pure state plus two effect closures, so the module is tested directly with no adapter. The closures are the module's internal seam, and it is a real one: `HostApplication` supplies the production implementation (supervisor transport with one queue hop; revision bump plus broadcast), and the new tests supply captures. The external seams are untouched: `FeatureServiceSupervisorDriving` keeps its two adapters (production `FeatureServiceSupervisor` and `FakeSupervisor`), the control server socket protocol, the event names, and the revision scheme do not change.

`HostApplication` constructs the module right after `super.init()`:

```swift
private var uiStateRecovery: HostUiStateRecovery!

// init, immediately after super.init():
self.uiStateRecovery = HostUiStateRecovery(
    sendReplay: { [weak self] request, fallbackGeneration, completion in
        guard let self else { return }
        guard let supervisor = self.supervisor else {
            completion(HostResponse(id: request.id, error: HostError(code: "feature_service_unavailable", message: "MoirasiaFeatureService is not running.")), fallbackGeneration)
            return
        }
        supervisor.request(request) { [weak self] response, requestGeneration in
            guard let self else { return }
            self.stateQueue.async { completion(response, requestGeneration) }
        }
    },
    announceRestored: { [weak self] params in
        guard let self else { return }
        self.revision += 1
        self.server?.broadcast(HostEvent(event: "host.uiStateChanged", revision: self.revision, payload: .object(params)))
    }
)
```

The call-site rewires are small:

- `receive` replaces its fence and gate with `guard self.uiStateRecovery.accept(event: event, generation: generation) else { return }`, then keeps the revision, settings injection, broadcast, and launcher logic unchanged. The gate sends the replay before the host broadcasts the event, exactly as today (`:209-219` order).
- `receiveHealth` maps the health state to an observation (`.starting` → `.started`, `.error`/`.stopped` → `.ended`, otherwise `.running`), fences with `acceptGeneration`, then keeps the health-fact update and health payload broadcast unchanged.
- The `host.setUiState` handler calls `uiStateRecovery.retain(request.params)` in place of `mergeHostUiState`, keeping the verbatim forward and the patch broadcast on success.
- `desktopApplicationExited` calls `uiStateRecovery.retain(params)` for the all-false reset and keeps the unconditional forward.
- `forward` inlines the supervisor-nil branch (the tag was always dropped) and `forwardTagged` is deleted.
- The recovery copy and the six flag fields (`:51-57`), the private `HostUiState` struct, and the four private methods are deleted from `HostApplication`.

Locality: every future recovery change (a fourth UI-state fact, a different coalescing rule, retry-on-product-error) lands in one file with its own tests. Leverage: the host's callbacks shrink to "ask the module, then do host I/O".

## Required invariants

1. Generation fencing is exact. A `.started` observation is accepted only when `activeGeneration == nil || generation > activeGeneration`; a repeated or older `.started` is dropped without resetting anything. `.running` and `.ended` are accepted only when `activeGeneration == generation && !generationTerminal`. Events are accepted only under that same predicate, and a nil `activeGeneration` drops both.
2. On an accepted `.started`: `activeGeneration = generation`, and `generationTerminal`, `initialSnapshotReceived`, `replayInFlightGeneration`, `replayStateChanged` are all cleared. On an accepted `.ended`: `generationTerminal = true`, `replayInFlightGeneration = nil`, `replayStateChanged = false`.
3. The replay gate opens once per generation: for an accepted event named `host.snapshotChanged` whose payload is a full snapshot (object with `version == 1`, a numeric `revision`, a `settings` object, and a `features` array) while `initialSnapshotReceived` is false, the flag is set and exactly one replay is sent. No later full snapshot in that generation re-triggers it.
4. A replay request is `HostRequest(id: UUID().uuidString, method: "host.setUiState", params: <all three copy values>)`; the id is fresh on every send, including trailing replays.
5. `retain` absorbs nothing when any recognized field is present but non-boolean; when all present fields are valid it merges them, and a patch that leaves the copy unchanged does not mark a replay dirty. A changed patch retained while a replay is in flight sets the dirty flag.
6. A replay completion is honored only when `activeGeneration == generation && !generationTerminal && replayInFlightGeneration == generation`. The completion tag is the supervisor's send-time generation; a completion tagged otherwise (including a crash between gate and send) is dropped.
7. Transport failures (`feature_service_crashed`, `feature_service_unavailable`) clear the dirty flag and produce no announcement and no immediate resend; the next generation's gate is the only retry path. A product error produces no announcement and no resend of itself, but the dirty-flag check precedes the ok check: a change retained while the replay was in flight still gets its one trailing replay after a product error, and a clean product-error completion (no dirty flag) ends the cycle — no loop.
8. A dirty flag at completion sends exactly one trailing replay; the superseded replay announces nothing. Only a successful (initial or trailing) replay calls `announceRestored` once, with the full copy params.
9. A replay completion reaches the module exactly once. With a supervisor, the host's `sendReplay` closure hops the completion to the state queue exactly once; with no supervisor the closure completes immediately — synchronously on the state queue — and the module must tolerate that re-entry, because the completion only clears state the send just set. The module never touches queues.
10. The `host.setUiState` handler still forwards the client request verbatim, broadcasts the request params (not the copy) on success, and absorbs patches regardless of the child's response. `desktopApplicationExited` still forwards the all-false reset even when the copy already holds false, ignoring the response.
11. The recovery copy stays memory-only; no file, defaults domain, or settings key is added.
12. No wire protocol, event name, revision scheme, `HostApplication` constructor signature, or `FeatureServiceSupervisorDriving` change.

## Implementation sequence

### 1. Add the module and its direct tests

Create `native/moirasia-runtime/Sources/MoirasiaHost/HostUiStateRecovery.swift` with the interface and the full state machine. Create `native/moirasia-runtime/Tests/MoirasiaProtocolTests/HostUiStateRecoveryTests.swift` with a small harness: the module constructed with recording closures, where `sendReplay` captures `(request, generation, completion)` and tests drive completions synchronously with an explicit tag, and `announceRestored` captures the announced params. No sockets, no queues, no timeouts. Tests open a generation with `acceptGeneration(.started, ...)` before gating replays, because events and observations are dropped while `activeGeneration` is nil.

Add these cases through the module's interface:

1. **Partial retention and unknown keys.** `retain(["mainVisible": true])` is reflected in the next replay's params; `retain(["page": "settings"])` and `retain([:])` change nothing.
2. **All-or-nothing validation.** After absorbing `mainVisible: true`, a patch containing `mainFocused: "true"` plus `shelfVisible: false` absorbs nothing; the next replay still carries the pre-patch copy.
3. **A no-op patch does not mark a replay dirty.** Gate a replay, retain a patch equal to the current values, complete the replay; no trailing replay is sent.
4. **One replay per generation after the first full snapshot.** A full snapshot sends one replay; a second full snapshot sends none; payloads missing `version`, `revision`, `settings`, or `features` never trigger one.
5. **Stale- and future-generation events are dropped.** After generation 2 starts, a full snapshot tagged generation 1 neither sends a replay nor returns true; an event tagged generation 3 before generation 3's `.started` is dropped the same way.
6. **New-generation reset and repeated `.started`.** After generation 1 ends, `.started` generation 2 reopens the gate; a second `.started` for generation 2 is dropped; an older `.started` is dropped.
7. **A terminal generation drops everything.** After `.ended`, events for that generation return false, a completion for the in-flight replay is dropped (no announcement, no trailing replay), and `.running` returns false.
8. **In-flight changes coalesce into one trailing replay.** Retain two patches while a replay is in flight; completing the first with success sends exactly one trailing replay carrying the full copy and announces nothing for the superseded success; completing the trailing replay announces once with the full copy.
9. **Transport failures wait for the next generation.** Completing with `feature_service_crashed` (and separately `feature_service_unavailable`) announces nothing and resends nothing; the next generation's first full snapshot fires a fresh replay carrying the retained values.
10. **Product errors neither loop nor announce.** A clean completion with a product error code announces nothing and resends nothing, and a later full snapshot in the same generation does not refire. A product error with the dirty flag set still sends the one trailing replay — the dirty check precedes the ok check — and completing that trailing replay with a product error and no new changes ends the cycle.
11. **Success announces the full copy with a fresh request.** The replay request carries a fresh UUID, method `host.setUiState`, and all three keys; the announcement receives the same full params.
12. **A completion tagged with a different generation is dropped.** Complete the in-flight replay with the supervisor's send-time tag bumped past a simulated crash; no state changes.

Run `swift test --package-path native/moirasia-runtime --filter HostUiStateRecoveryTests`. Nothing else references the module yet, so the rest of the package stays green.

### 2. Rewire HostApplication

- Add the `private var uiStateRecovery: HostUiStateRecovery!` property and construct it immediately after `super.init()` with the two weak closures shown above.
- Replace the fence and gate in `receive` with the `accept(event:generation:)` call, keeping the revision, settings injection, broadcast, and launcher logic byte-for-byte otherwise.
- Replace the fence in `receiveHealth` with the observation mapping plus `acceptGeneration(_:generation:)`, keeping the health-fact update and broadcast unchanged.
- Replace `mergeHostUiState` with `retain` in the `host.setUiState` handler and in `desktopApplicationExited`.
- Delete the recovery copy and the six flag fields (`:51-57`), the private `HostUiState` struct, `mergeHostUiState`, `isFullSnapshot`, `sendUiStateReplay`, `completeUiStateReplay`, and `forwardTagged`; inline the supervisor-nil branch into `forward` with the identical error code and message.

Run `swift test --package-path native/moirasia-runtime --filter HostRecoveryTests`. All ten tests must pass without modification. If one fails, the extraction drifted — the module's predicates, its completion ordering, or the host wiring; fix that, never the tests.

### 3. Update the domain glossary

Add the **Host UI-state recovery** term to `CONTEXT.md`, inserted after the Feature host entry, naming the module path and its ownership. The term is already present in the current working tree as an uncommitted edit; verify its position and wording and keep it. Leave the Feature host entry unchanged; it still describes the behavior accurately. No ADR is needed.

### 4. Verify

1. `swift test --package-path native/moirasia-runtime --filter HostUiStateRecoveryTests`
2. `swift test --package-path native/moirasia-runtime` (full package, including the unchanged `HostRecoveryTests`, `FeatureServiceSupervisorTests`, `FeatureRuntimeTests`, `ProtocolTests`, `NativeRuntimeTests`, and `SafeIOTests`)
3. `node scripts/build-moirasia-runtime.mjs` (the release arm64 build the packaging path uses)

There are no TypeScript, renderer, or IPC changes, so `pnpm typecheck`, `pnpm test`, and browser testing are unaffected.

## Risks and limits

- **Predicate drift.** The fencing and gate predicates in the invariants are quoted from the current code. The easiest mistakes are accepting a repeated or older `.started` — resetting per-generation state would reopen the gate and replay again mid-generation — and treating a nil `activeGeneration` as accepting non-starting observations. The module tests mirror the exact predicates; the host suite pins the end-to-end outcomes.
- **Queue-hop wiring.** With a supervisor, exactly one hop on a replay completion, inside the host's `sendReplay` closure. Two hops reorder completions; none races the module state. The nil-supervisor branch completes immediately where today's `forwardTagged` defers by one hop; that is equivalent, because the nil response is always a transport failure that only clears state the send just set, and every state-queue interleaving that can run in today's window — a patch, a `.started`, a terminal health observation, another event — leaves the same end state either way.
- **Retain cycles.** Both effect closures capture `self` weakly. The host owns the module, so a strong capture would cycle.
- **Init phase 1.** Swift forbids capturing self before all stored properties and `super.init()` complete; the IUO property assigned after `super.init()` sidesteps it. A `lazy var` also works (its first access is already serialized on the state queue) but makes construction timing implicit.
- **Flag collapse.** The `initialReplayAttempted` collapse is provably equivalent: both flags are written only in the gate branch (`:210`, `:212`) and in the `.started` reset (`:232-233`), they start equal, and nothing else reads them, so they are always equal and the inner check is always true when reached. The module carries five flags.
- **Completion tags.** Completions carry the supervisor's send-time generation, which can differ from the gate's generation after a crash between gate and send; the module guard drops the mismatch. This is the case the socket harness cannot reach cheaply and the module tests can.
- **Single-threaded contract.** The module is not thread-safe by itself; the plan keeps every call site on the state queue. A dispatch-specific assertion would require queue injection and adds interface weight for no behavioral gain.

## Out of scope

- Any child-side `FeatureRuntime` or product-module change; in-child retention already lives there.
- Persisting the recovery copy; recovery across a full `MoirasiaHost` restart; Electron reconnect resynchronization.
- Supervisor restart policy, backoff, or generation tagging.
- Wire protocol, event names, revision scheme, or settings-injection changes.
- Moving health-fact broadcasting, the launcher, the status item, or shutdown into the module.
- A public protocol or port for the module, or a second production adapter.
- Any TypeScript, renderer, IPC, or packaging change.

## Completion criteria

- One module owns the recovery copy and the generation/replay machine; `HostApplication` declares none of the recovery copy, the six flag fields, or the four methods.
- The module's interface is three methods plus two effect closures; internal to the `MoirasiaHost` target; no protocol added.
- All ten `HostRecoveryTests` pass unmodified.
- The new `HostUiStateRecoveryTests` pass and cover the enumerated cases, including the mismatched-completion tag case.
- The full package suite and the release arm64 build pass.
- `CONTEXT.md` gains the Host UI-state recovery term; no ADR is created.