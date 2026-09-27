# Implementation plan: make native Host UI state one shared contract

## Decision

Introduce one shared `HostUiState` value in `MoirasiaProtocol` for three reported facts: `mainVisible`, `mainFocused`, and `shelfVisible`. The value owns their defaults, atomic patch validation, and complete serialization.

The two processes keep separate, process-local values:

- `HostUiStateRecovery` in `MoirasiaHost` owns the parent recovery copy and its existing generation/replay state machine.
- `FeatureRuntime` in `MoirasiaFeatureService` owns the child desired-state copy and applies it to running modules or on module startup. It keeps the existing consumer routing and per-module payload construction.

They share a value type and its semantics, not mutable state. `HostApplication` continues to own transport, revision, event broadcast, and the desktop-exit reset request. Amove continues to own hotkey behavior; Bonded continues to own visibility-dependent monitoring. No product policy moves into `MoirasiaProtocol`.

This is the narrowest useful seam: both executable targets already depend on `MoirasiaProtocol`, which owns the native wire value types. A new source file is automatically part of the existing target; no new package target, dependency, protocol, adapter, wire field, or protocol version is needed. The type remains a pure in-process value module and is tested directly through its interface.

The previous `plan.md` described the extraction of `HostUiStateRecovery`, which is already present in the source. This plan replaces that completed plan with a proposed follow-up: centralizing the state defaults and patch validation duplicated between `HostUiStateRecovery` and `FeatureRuntime`.

## Design decisions

The following choices define this proposal.

| Decision | Applied answer | Why |
|---|---|---|
| Scope | Centralize the duplicated value defaults and atomic patch semantics shared by parent recovery and child application; use the value's full serialization for parent replay and reset. | The defaults and parsing are duplicated across both callers; the parent reset also repeats the complete three-key shape. Consumer routing has one owner in `FeatureRuntime` and stays there. |
| Type name | `HostUiState`, following the existing private Swift type and the `Host UI-state recovery` glossary term. | Keeps the domain term recognizable without adding a new concept. |
| Location | `native/moirasia-runtime/Sources/MoirasiaProtocol/HostUiState.swift`. | Host and Feature service already depend on this target; it is the shared owner of the cross-process control contract. |
| Package shape | Add one source file; do not add a SwiftPM target or dependency. | Existing target membership is directory-based and both consumers import `MoirasiaProtocol`. |
| Parent and child ownership | Keep independent `HostUiState` values in each process. | The copies have different lifetimes and purposes; sharing a mutable instance across processes is neither possible nor desired. |
| Patch validation | The shared type validates recognized fields atomically and throws `HostError(code: "invalid_params", message: "<field> must be a boolean.")`. Unknown keys remain ignored. | Preserves the child’s exact public error behavior and gives parent recovery and the Feature service the same parser. |
| Parent invalid-patch behavior | `HostUiStateRecovery` catches/ignores a validation error and continues to forward the original request as today. | The parent records only valid reported state; the Feature service remains responsible for returning the request error. |
| Patch result | Return whether a valid patch changed the complete value. | Parent recovery needs this to avoid dirtying a replay for a no-op; FeatureRuntime selects consumers from key presence, because equal values still need to clear prior module errors. |
| Routing ownership | Keep key-to-consumer routing and per-module payload construction in `FeatureRuntime`. | This logic has one current owner. Moving product identities and routing into the shared value type would add coupling without removing duplicated behavior. |
| Serialization | Full parent replay, restored event, and desktop-exit reset continue to contain all three keys, including default `false` values. | Preserves current payload shape and behavior. |
| Tests | Add direct `HostUiState` tests; retain existing Host recovery and Feature runtime tests. | Unit tests cover shared value semantics; FeatureRuntime tests already pin routing and payloads at the consumer boundary. |
| Domain docs | Update the existing Host UI-state recovery and Feature host descriptions to name the shared `MoirasiaProtocol.HostUiState` value and distinguish the two process-local copies. | This sharpens existing glossary terms; it does not introduce a new domain term. |
| ADR | Do not add an ADR. | There is no `docs/adr/` directory and this change does not reverse a recorded decision. |

## Current evidence and friction

- `native/moirasia-runtime/Sources/MoirasiaHost/HostUiStateRecovery.swift:21-33` defines a private `HostUiState` with three default-false fields and a full `params` encoder. `:88-103` separately lists the field names, validates them, and assigns them one by one. `:116` and `:146` use that encoder for replay and announcement.
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureRuntime.swift:14` stores another `HostUiState`; `:278-282` defines a second private struct with the same three fields. `:284-338` repeats per-field parsing and maintains `updatesAmove`/`updatesBonded` flags. `:341-355` maps state into `amove.setUiState` and `bonded.setUiState` parameter dictionaries. That routing and projection exist only here, so they remain in `FeatureRuntime`.
- `native/moirasia-runtime/Sources/MoirasiaHost/HostApplication.swift:231-238` manually rebuilds all three false values when the desktop application exits, retains the values, and forwards the reset.
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureModules.swift:71-74,256-258` consumes the per-module request shapes. Those handlers remain the product-command validation surface; `FeatureRuntime` continues to create the per-module payloads and the shared value does not own product runtime effects.
- `native/moirasia-runtime/Package.swift` declares `MoirasiaProtocol`; `MoirasiaHost`, `MoirasiaFeatureService`, and `MoirasiaProtocolTests` already depend on it. Adding `HostUiState.swift` requires no manifest edit.
- `native/moirasia-runtime/Tests/MoirasiaProtocolTests/FeatureRuntimeTests.swift:15-50` pins target selection, exact request payloads, and Amove-before-Bonded ordering. `:52-118` pins partial merge, ignored unknown/empty patches, and all-or-nothing validation. `:120-150` pins startup replay and defaults. `:152-231` pins independent error handling and the need to retry an unchanged desired value to clear an error. `:235-275` pins startup replay failure cleanup, lease release, original error propagation, and retry.
- `native/moirasia-runtime/Tests/MoirasiaProtocolTests/HostUiStateRecoveryTests.swift` directly pins parent-copy semantics: partial merge, malformed-patch no-op, no-op patch not dirtying a replay, full payload shape, and recovery behavior. `HostRecoveryTests.swift` additionally exercises the host through its socket harness, including retention across an unavailable child update and the all-false desktop-exit reset. `HostApplication.swift:167-177` retains before forwarding and broadcasts the original request params on success.
- `docs/architecture/standalone-applications.md` already states that the Feature runtime retains the three facts, applies focus/shelf to Amove and visibility to Bonded, and leaves product policies with those products. The change should make the ownership of the shared data semantics explicit without changing that division of responsibility.
- Recent native-host work (`f07ad0c`, `2c3cd4b`, `bf0309e`) added UI-state retention, child-restart replay, and parent recovery. The field definitions and patch validation remain duplicated between the two native processes; `FeatureRuntime` remains the sole owner of product-specific routing.

## Proposed module interface

Keep the public interface small. The exact spelling can follow Swift conventions during implementation, but it must expose only the shared value contract, not queue behavior or product routing:

```swift
public struct HostUiState: Equatable, Sendable {
    public private(set) var mainVisible: Bool
    public private(set) var mainFocused: Bool
    public private(set) var shelfVisible: Bool

    public init()

    /// Returns true only when the complete value changes.
    /// Every recognized key must be a Bool or this throws without mutation.
    /// Unknown keys are ignored.
    @discardableResult
    public mutating func apply(_ params: [String: JSONValue]) throws -> Bool

    /// Always encodes the complete state using all three keys.
    public var params: [String: JSONValue] { get }
}
```

The module owns only the cross-process Host UI-state value contract:

- Defaults are `false` for all three fields.
- Recognized fields are `mainVisible`, `mainFocused`, and `shelfVisible`.
- A patch may contain any subset. Empty and unknown-only patches are valid no-ops.
- A present recognized field must be a JSON boolean. Parse and validate every recognized field before mutating state, so one malformed field rejects the whole patch.
- `apply` returns whether the complete old and new values differ. An explicitly supplied value equal to the stored value returns `false`.
- `params` always contains all three booleans.
- Invalid fields throw the exact existing `HostError` code and message, checking in current field order: `mainVisible`, then `mainFocused`, then `shelfVisible`.

`FeatureRuntime` continues to select Amove when `mainFocused` or `shelfVisible` is present, Bonded when `mainVisible` is present, and neither for unknown or empty patches. It builds Amove's payload from `mainFocused` and `shelfVisible`, and Bonded's from `mainVisible`, in its existing fixed Amove-then-Bonded order. Shout receives no UI-state request.

The shared type does not own consumer routing or per-module payloads, replay generations, dirty/in-flight flags, queues, module lifecycle, request IDs, method strings, or module errors. It does not add `Codable`; `JSONValue` remains the existing wire representation.

## Required behavior and invariants

1. **Independent ownership:** parent and child each store their own `HostUiState` value. Updating one copy does not mutate or reset the other.
2. **All-or-nothing parse:** for a patch with any invalid recognized field, `apply` throws and leaves all fields unchanged. The `HostUiStateRecovery` caller ignores that error; the `FeatureRuntime` caller returns it through the existing `HostResponse` path.
3. **Unknown/empty patch:** ignored keys do not change state or select a consumer. Empty and unknown-only patches remain successful no-ops in the Feature service.
4. **Presence differs from change:** `FeatureRuntime` selects targets from recognized keys present in the patch, not from `apply`'s changed result. An explicit key selects its consumer even when its value is unchanged.
5. **Parent replay dirtiness:** `HostUiStateRecovery` marks an in-flight replay dirty only when `apply` reports a changed value. An explicit no-op patch does not enqueue a trailing replay.
6. **Feature error recovery:** `FeatureRuntime` reapplies every selected, running consumer even when `apply` returns `false`. This preserves the current behavior where reapplying the same desired values clears a previously recorded module error. Stopped modules retain desired state and receive it when they start.
7. **Deterministic target order:** for patches selecting both consumers, FeatureRuntime handles Amove before Bonded. It still tries Bonded if Amove fails; the first propagated error and snapshot/error-update behavior remain unchanged.
8. **Projection shape:** Amove receives exactly `mainFocused` and `shelfVisible`; Bonded receives exactly `mainVisible`; Shout receives no Host UI-state request. FeatureRuntime owns these projections.
9. **Startup application:** after a product module starts, `FeatureRuntime` continues to apply the latest full projection even if no patch selected it in the current request. New runtime defaults still project all-false values.
10. **Parent behavior:** `HostApplication` retains each valid patch before forwarding it, regardless of the response; malformed patches do not change the recovery copy but are still forwarded, and the forwarded response is returned as-is. On success, the host broadcasts the original patch params, while a successful recovery replay announces the complete copy. Desktop exit still retains and forwards all three false values, even if already false.
11. **Wire compatibility:** request method names, IDs, event names, protocol version, params keys, values, success/error shape, parent revision behavior, and replay gating are unchanged.
12. **Product ownership:** Amove's hotkey policy and Bonded's visibility/sampling policy stay inside their existing runtimes. The shared module only describes the UI-state values; `FeatureRuntime` owns consumer routing and payload construction.
13. **No persistence change:** parent recovery stays in memory; no settings key, file, or recovery-across-host-restart behavior is introduced.

## Implementation sequence

### 1. Add focused tests for the shared contract

Add `native/moirasia-runtime/Tests/MoirasiaProtocolTests/HostUiStateTests.swift`, importing `MoirasiaProtocol`. Keep tests at the public interface, without inspecting storage.

Cover:

1. **Defaults and complete params:** a new value exposes all three facts as `false` and serializes exactly those keys, with no extras.
2. **Partial merge:** apply each field independently and verify omitted fields retain their previous values.
3. **Unknown and empty patches:** empty and unknown-only patches are valid no-ops, return `false`, and leave the full params unchanged. Use an unknown key with an array or object value, and also verify that an unknown non-boolean value beside a valid recognized field is ignored while the recognized field is applied.
4. **All-or-nothing validation:** for each recognized field, a non-boolean value throws `HostError(code: "invalid_params", message: "<field> must be a boolean.")`; a mixed valid/invalid patch leaves the entire old state unchanged. When multiple recognized fields are invalid, assert the first error follows the fixed order `mainVisible`, `mainFocused`, `shelfVisible`.
5. **Change result:** a patch changing any value returns `true`; an explicit patch repeating the stored value returns `false`.

Start with the test file and the new type in one focused change; `swift test --package-path native/moirasia-runtime --filter HostUiStateTests` is the first verification. Existing `FeatureRuntimeTests` already test all five non-boolean `JSONValue` cases against each recognized field through the service and assert exact errors, so direct type tests need not repeat that 3-by-5 matrix. The existing FeatureRuntime routing tests remain the contract for consumer selection, payloads, startup behavior, and Amove-before-Bonded order.

### 2. Add the shared HostUiState value module

Create `native/moirasia-runtime/Sources/MoirasiaProtocol/HostUiState.swift`.

- Implement the public `HostUiState` value with the interface above and read-only public access to its three facts.
- Keep it `Equatable` and `Sendable`; do not introduce reference semantics, global mutable state, locks, queues, or I/O.
- Parse recognized fields in fixed order into a local state copy, then assign it to stored state only after every present value validates. A thrown validation error must not partially mutate the value.
- Return whether the complete value changed; unknown-only, empty, and explicit equal-value patches return `false`.
- Keep consumer routing, method strings, and request IDs out of `HostUiState`; `FeatureRuntime` continues to select modules and create `HostRequest`s.
- No `Package.swift` edit: SwiftPM compiles source files under the declared target directory.

### 3. Reuse the value in parent recovery

Modify `native/moirasia-runtime/Sources/MoirasiaHost/HostUiStateRecovery.swift`:

- Delete the nested private `HostUiState` struct.
- Change `hostUiState` to the shared `MoirasiaProtocol.HostUiState` value (the existing import already provides it).
- Replace the hand-maintained recognized-key array, temporary dictionary, and field-by-field assignment in `retain(_:)` with `try hostUiState.apply(params)`.
- On validation error, return without changing the recovery copy, as today.
- Use the returned `Bool` for the existing equality/no-op guard; preserve `replayStateChanged` behavior exactly.
- Keep replay and announcement payloads sourced from the shared complete `params` property.
- Do not modify generation fencing, full-snapshot validation, replay coalescing, completion handling, or the module's queue contract.

Run `swift test --package-path native/moirasia-runtime --filter HostUiStateRecoveryTests` and keep those tests unchanged.

### 4. Reuse patch semantics in FeatureRuntime

Modify `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureRuntime.swift`:

- Delete the nested private `HostUiState` struct and use the shared type.
- In `setHostUiState`, call `hostUiState.apply(request.params)` once. Let its `HostError` propagate through the existing `handleOnStateQueue` path.
- Derive `updatesAmove` from the presence of `mainFocused` or `shelfVisible`, and `updatesBonded` from the presence of `mainVisible`. Do not use the changed result to select consumers; an equal explicit value must still be reapplied.
- Preserve state assignment before consumer execution: a valid desired value remains retained even if a module rejects its application.
- Apply an update only to a selected module that is currently running. Stopped modules keep the desired state and receive it through startup replay.
- Keep Amove-before-Bonded execution, independent module error capture, error clearing, changed-error snapshot publication, first-error return, and success result unchanged. Still attempt Bonded if Amove fails.
- In `applyHostUiState(to:requestID:)`, build module-specific payloads from the shared value's read-only fields. Keep the existing method names (`amove.setUiState`, `bonded.setUiState`), IDs, module lookup, exact payload keys, and no-op behavior for Shout/other IDs.
- Keep startup replay in `startOrThrow` so a newly started module receives the latest full state. If applying it fails, preserve the existing cleanup: stop the module, release its lease, and propagate the original replay error so retry can reacquire the lease.

Run `swift test --package-path native/moirasia-runtime --filter FeatureRuntimeTests` without weakening or rewriting the existing assertions. Specifically preserve the tests for partial updates, invalid-field atomicity, stopped-module startup replay, Amove-before-Bonded ordering, independent failures, repeated desired values clearing errors, and startup replay failure cleanup.

### 5. Replace the parent reset literal and synchronize the domain docs

Modify `native/moirasia-runtime/Sources/MoirasiaHost/HostApplication.swift`:

- At the desktop-exit reset, replace the hand-built three-key dictionary with `HostUiState().params`. Continue retaining that complete reset before forwarding the same `host.setUiState` request. Preserve the unconditional forward even when the copy is already all false, the ignored response, and the existing request method/ID behavior.
- Leave the regular `host.setUiState` handler unchanged: it retains a valid patch before forwarding the original request verbatim, does not roll back on child failure, returns the child's response, and broadcasts the original patch params only on success. The recovery module's successful replay announcement continues to use the complete retained state.

Run `swift test --package-path native/moirasia-runtime --filter HostRecoveryTests`; retain its socket-level reset assertions unchanged.

Update the existing descriptions in `CONTEXT.md` and the relevant paragraph in `docs/architecture/standalone-applications.md`:

- Name `MoirasiaProtocol.HostUiState` as the shared value, patch-validation, and complete-serialization owner.
- State explicitly that the parent recovery copy and child desired-state copy are separate in-memory values using the same contract.
- Keep ownership of generation replay in `HostUiStateRecovery`, consumer routing in `FeatureRuntime`, host transport/broadcast in `MoirasiaHost`, and product policy in Amove/Bonded.
- Do not add a new glossary term or ADR; the existing Host UI-state recovery and Feature host terms already name this concept.

### 6. Verify the full native integration

Run the focused suites first, then the complete native package tests and release build:

1. `swift test --package-path native/moirasia-runtime --filter HostUiStateTests`
2. `swift test --package-path native/moirasia-runtime --filter HostUiStateRecoveryTests`
3. `swift test --package-path native/moirasia-runtime --filter FeatureRuntimeTests`
4. `swift test --package-path native/moirasia-runtime --filter HostRecoveryTests`
5. `swift test --package-path native/moirasia-runtime`
6. `swift build --package-path native/moirasia-runtime -c release --arch arm64`

The full package run validates the shared public type across the protocol library, host executable, feature-service executable, product runtimes, and integration tests. The release arm64 package build checks the optimized compilation path without staging app bundles. No TypeScript, renderer, preload, or wire-schema tests need changes because the JSON protocol payload remains identical.

## Test ownership and tests that should survive

- **New `HostUiStateTests`:** direct unit tests for default values, patch validation and error order, merge behavior, changed/no-op results, and complete serialization. These cross the shared type's interface only.
- **Existing `HostUiStateRecoveryTests`:** remain unchanged. They test how the parent recovery module uses the shared type together with generation/replay state.
- **Existing `FeatureRuntimeTests`:** remain unchanged. They test the child runtime's observable request routing, ordering, startup replay, and error recovery through `FeatureRuntime.handle`.
- **Existing `HostRecoveryTests`:** remain unchanged. They cross the host's authenticated socket seam and protect the parent forwarding/reset behavior.
- **Existing `FeatureModules` behavior:** remain unchanged. The modules still validate their own requests and execute product-owned effects; this plan does not redesign their interface.

If an existing integration test fails after the extraction, fix the shared value contract or its call sites. Do not relax the assertion to match a new implementation detail.

## Risks and mitigations

- **Conflating change with target selection.** Parent recovery only dirties a replay for changed values, but FeatureRuntime must reapply an unchanged explicit value to clear stored module errors. Use `apply`'s return value only for the parent dirty check; FeatureRuntime selects targets from recognized-key presence. Existing tests cover equal-value error recovery.
- **Changing operation order.** FeatureRuntime must continue applying Amove before Bonded and attempt both even if Amove fails. Keep the explicit sequential calls; do not derive execution order from dictionary iteration. `testUiStateRoutesOnlyRelevantFieldsAndResetsAllFacts` asserts the order.
- **Partial mutation on invalid input.** Do not assign values while still validating later fields. Parse all recognized fields into local values first, then apply in one mutation. Test every field's error and a mixed valid/invalid patch.
- **Changing error messages.** Keep the existing `invalid_params` code and exact `"<field> must be a boolean."` message. Let FeatureRuntime propagate `HostError`; parent recovery intentionally ignores the same failure and forwards the original request.
- **Changing no-op behavior.** Unknown-only and empty patches remain accepted by FeatureRuntime and do not call modules. A repeated recognized key calls its selected consumer only when that module is running, even if its value is unchanged. A stopped module receives the latest value on startup. If startup replay fails, retain the existing stop-and-release cleanup and original error. Parent replay handling treats the patch as a no-op if the complete value did not change.
- **Moving product routing into the protocol target.** Keep the shared target's responsibility limited to state fields, patch validation, and complete serialization. FeatureRuntime owns consumer selection and payloads; Amove's hotkey rules, Bonded's monitoring decisions, and product runtime errors remain product-owned.
- **Accidentally merging process state.** The parent and child copies are intentionally distinct and memory-only. Do not attempt to share mutable state, persist a copy, or alter restart recovery semantics.
- **Protocol drift.** Keep the full params and per-product projections byte-for-byte equivalent in keys and values. No wire protocol version bump is warranted because the payload is unchanged.
- **Replacing staged build output.** `node scripts/build-moirasia-runtime.mjs` recursively removes and recreates `native/staged/runtime`, which already exists as ignored output in this worktree. This source-only change does not need a staging test; use the release arm64 `swift build` above and leave the existing staged bundles alone.
- **Over-expanding the seam.** The module has no external I/O and one implementation, so do not introduce an adapter, protocol, SwiftPM target, or dependency solely for testing.

## Out of scope

- Reworking the already-deep `HostUiStateRecovery` generation/replay state machine.
- Combining parent and child mutable copies or persisting either copy.
- Recovery across a full `MoirasiaHost` restart or Electron reconnect resynchronization.
- Changing `HostRequest`, method strings, event names, error envelopes, protocol version, or revision behavior.
- Replacing string-based native method dispatch or redesigning the general `FeatureModule` interface.
- Changing `FeatureModules` validation or moving Amove/Bonded runtime behavior into `MoirasiaProtocol`.
- Adding Host UI-state facts, adding a Shout projection, or changing default values.
- Changes to TypeScript, Electron, renderer behavior, packaging metadata, or the standalone applications.
- Adding an ADR.

## Completion criteria

- One public `MoirasiaProtocol.HostUiState` type defines the three native Host UI-state facts, all-or-nothing patch validation, and complete params.
- `HostUiStateRecovery` and `FeatureRuntime` no longer define duplicate `HostUiState` structs or independently implement patch validation and state mutation; `FeatureRuntime` retains its single-owner consumer routing and payload construction.
- `FeatureRuntime` still selects consumers by key presence, applies equal-value explicit patches to selected running modules, retains state for stopped modules, and preserves Amove-before-Bonded handling.
- Parent recovery still marks only real state changes dirty, and the desktop-exit reset remains a full all-false request.
- Existing `HostUiStateRecoveryTests`, `FeatureRuntimeTests`, and `HostRecoveryTests` pass unchanged; new `HostUiStateTests` cover the shared interface.
- Full native package tests and the release arm64 SwiftPM build pass without replacing `native/staged/runtime`.
- `CONTEXT.md` and `docs/architecture/standalone-applications.md` accurately describe the shared value and distinct parent/child ownership.
- No wire-format, persistence, product-policy, or unrelated lifecycle change is introduced.
