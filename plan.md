# Implementation plan: native Bonded application identity

**Status:** Implemented. This file is the replacement plan. The identity owner, native callers, tests, and domain notes described below have been updated.

## Goal

Give native Bonded application identity one clear owner inside the existing `BondedRuntime` Swift module. Make its identity key and rule matching agree with the TypeScript `Application identity` implementation, remove the duplicate native matcher, and have process resolution use the canonical key rather than formatting it inline.

The change should make the identity logic easier to find without adding a Swift package target, a dependency, a persisted data format, or a second adapter seam.

## Evidence and current friction

- `CONTEXT.md` defines **Application identity** through `apps/integrated/Bonded/src/main/application-identity.ts`. Its key is `bundle:<id>|path:<path>` when the bundle identifier is non-empty and `path:<path>` otherwise. The TypeScript `matchesRule` compares those keys.
- `apps/integrated/Bonded/tests/application-identity.test.ts` pins ordinary non-colliding matching cases: both sides without a bundle identifier match by path; if only one side has an identifier, they do not match; different identifiers or paths do not match.
- Native key construction lives in `native/moirasia-runtime/Sources/BondedRuntime/ObservedIpBlocker.swift` as `bondedApplicationRuleIdentity`. That file also defines the public matcher and a private copy of the matching logic.
- `native/moirasia-runtime/Sources/BondedRuntime/ProcessResolver.swift` formats the same bundle/path key inline before hashing an observed application's ID. Its `path` is the raw executable path returned by `proc_pidpath`. The TypeScript resolver instead stores the containing `.app` path for application targets. The identity-key format can agree without the two modes producing the same key or observed ID for the same process.
- Native matching currently differs from the TypeScript rule. `bondedMatchesApplicationRule` falls back to path equality when either side lacks a bundle identifier. The private blocker matcher repeats that behavior. At equal path inputs, a same-path target with a non-empty bundle identifier can therefore match a bundle-less stored rule in native mode even though the canonical TypeScript implementation rejects it.
- Swift `String ==` treats canonically equivalent Unicode sequences as equal, while TypeScript `===` distinguishes their different code-unit sequences. The current TypeScript identity string is also not injective for arbitrary inputs: `bundleIdentifier: "com.example|path:/Applications/A.app", path: "/Applications/B.app"` and `bundleIdentifier: "com.example", path: "/Applications/A.app|path:/Applications/B.app"` produce the same key. Native settings accept both shapes, and the resolver accepts any non-empty plist identifier.
- `SettingsStore.parseRules` rejects a stored record if `bundleIdentifier` is present but empty. Its existing `canonicalRuleIdentifier` migration changes valid legacy `app_` rule IDs to `rule_`, and `load()` saves the version-3 settings when that migration runs.
- `SettingsStore.swift` uses the shared native key when parsing, deduplicating and migrating rule IDs. `BondedRuntime.swift` already calls the public matcher and rule constructor. When its selection flow sees only a same-path bundle-less stored rule for a target with a bundle identifier, corrected matching will treat them as distinct; explicit selection creates a new bundle-qualified rule and leaves the old rule unchanged.
- The root Swift package has one existing `BondedRuntime` target. The feature executable already depends on it. No `docs/adr/` records were found.

## Settled decisions

1. **Canonical matching rule.** Build `bundle:<id>|path:<path>` only for a non-empty identifier; otherwise build `path:<path>`. Compare the UTF-8 bytes of the encoded keys, not Swift `String ==`, because Swift equates canonically equivalent Unicode sequences while TypeScript `===` does not. Paths and bundle identifiers remain case- and normalization-sensitive, and `targetKind` does not participate. For non-colliding keys, a same-path pair matches only when its non-empty identifiers are equal or both identifiers normalize to absent; an identifier on one side only, unequal identifiers, or unequal paths do not match. Keep the existing unescaped `|path:` key format, including its delimiter-collision behavior: distinct field pairs that encode to identical key bytes match in TypeScript today and remain identical under this plan. Fixing that requires a coordinated TypeScript/key-format change and persisted-ID migration, so it is out of scope.
2. **Seam location.** Add `ApplicationIdentity.swift` inside the current `BondedRuntime` target. Do not create a new SwiftPM target or product. The existing native callers already use this target in-process, so a new package seam would add indirection without creating a useful adapter choice.
3. **Interface shape.** Keep every existing public function name, signature, type and access level unchanged. Move the implementations of `bondedApplicationRuleIdentity`, `bondedApplicationRuleForTarget`, `bondedMatchesApplicationRule`, and `bondedContainingApplication` to the identity source file. Add internal `bondedApplicationRuleIdentityData(path:bundleIdentifier:)` for byte-exact key comparison/deduplication, and `bondedObservedApplicationId(path:bundleIdentifier:)` to hash the canonical identity with the native `app_` prefix. This keeps key equality and observed-application ID policy with identity instead of duplicating them across callers. Do not introduce a new public type or redesign unrelated callers.
4. **Opaque ID hashing.** Keep `bondedOpaqueId` generic because `FlowHistory` uses it for flow IDs as well as application and rule IDs. Move its unchanged implementation from `ProcessResolver.swift` to a small `OpaqueIds.swift` source file so the resolver no longer appears to own general ID hashing. Preserve the hash algorithm, prefix handling and 16-character digest.
5. **Persisted data.** Preserve native `app_` and `rule_` prefixes, the current SHA-256-derived values for valid inputs, selected timestamps, and the version-3 JSON settings shape. Native rule construction must omit `bundleIdentifier` when its input is empty, as the TypeScript constructor does. Keep `SettingsStore.parseRules` rejecting a present-but-empty stored identifier. Do not add a migration or rewrite settings solely because matching changes. Preserve the existing load-time `app_`-to-`rule_` migration, which saves the normalized version-3 settings, and do not infer a missing bundle identifier from a path. A path-only reference and a bundle-qualified reference remain different identities.
6. **Cross-language scope.** Do not change the TypeScript implementation. Use its implementation and existing tests as the reference for equal path inputs; the native tests below pin additional Unicode and delimiter boundary behavior. The TypeScript local resolver supplies an application bundle path; the Swift native resolver continues to supply the raw `proc_pidpath` executable path. Do not normalize native paths or promise cross-mode key, observed-ID, or stored-rule-ID equality. TypeScript rule IDs use `app_`; native stored rule IDs use `rule_`. Update the domain and architecture notes to describe these as separate local- and native-mode implementations under the same Application identity term, with no shared runtime state or cross-language module.

## Intended ownership after the change

`BondedRuntime` remains the Swift module and the seam its current callers already use. Its Application identity implementation owns:

- the canonical bundle/path identity key and its UTF-8 `Data` form for byte-exact comparison;
- matching a target to a stored rule by comparing canonical key bytes;
- construction of a stored rule from an observed target;
- resolution of the containing `.app` path;
- observed application ID construction through the internal `bondedObservedApplicationId(path:bundleIdentifier:)` helper.

`OpaqueIds.swift` owns only the shared opaque-ID hash operation. It does not own application identity or flow history policy.

`ProcessResolver` continues to own PID lookup, caching, bundle metadata reads, display-name resolution and classification. It passes the raw executable path returned by `proc_pidpath` and the bundle identifier to the Application identity implementation; it does not substitute the containing `.app` path. `ObservedIpBlocker` continues to own learned-address state, limits and reference counts. It calls the shared key and matcher rather than carrying a second matching implementation. `SettingsStore` continues to own parsing, validation and migration; it uses the shared key to identify duplicate records. `BondedRuntime` keeps its current transition and firewall policy.

## Implementation steps

### 1. Add focused tests before changing behavior

Create `native/moirasia-runtime/Tests/MoirasiaProtocolTests/BondedApplicationIdentityTests.swift` with `Foundation`, `XCTest` and `@testable import BondedRuntime`. Keep the tests out of the unrelated `NativeRuntimeTests.swift`; the existing `MoirasiaProtocolTests` target already depends on `BondedRuntime`, and SwiftPM discovers source files in its default test directory without a manifest edit.

Pin the identity-key cases:

- a non-empty bundle identifier produces `bundle:<id>|path:<path>`;
- a missing or empty bundle identifier produces `path:<path>`;
- path and non-empty bundle identifier both participate in the key;
- paths and bundle identifiers are compared by exact UTF-8 representation, without case folding or Unicode normalization;
- `targetKind` does not participate in matching.

Pin matcher behavior as a matrix:

| Target identity | Stored rule identity | Expected |
| --- | --- | --- |
| same path and same non-empty bundle identifier | same path and identifier | match |
| same path, different non-empty bundle identifiers, including case-only differences | different identifier bytes | no match |
| same path, bundle identifiers use composed versus decomposed Unicode | different identifier bytes | no match |
| same path and identifier, different `targetKind` | same path and identifier | match |
| same path with neither identifier, different `targetKind` | same path-only key | match |
| different paths, same bundle identifier | different path | no match |
| paths differing only by case, same bundle identifier | different path | no match |
| same bundle identifier, paths use composed versus decomposed Unicode | different path bytes | no match |
| path-only references use composed versus decomposed Unicode | different path-only key bytes | no match |
| same path, target has non-empty identifier and rule does not | different key | no match |
| same path, rule has non-empty identifier and target does not | different key | no match |
| same path, neither has an identifier | same path-only key | match |
| different paths, neither has an identifier | different path-only key | no match |
| same path, empty target identifier and missing rule identifier | same path-only key | match |
| same path, missing target identifier and empty rule identifier | same path-only key | match |
| same path, both identifiers empty | same path-only key | match |
| same path, empty identifier on either side and non-empty identifier on the other | different key | no match |
| distinct bundle/path fields that encode to the same key because a value contains `|path:` | same encoded key bytes | match, preserving the existing TypeScript behavior |

Use helper-level tests for empty identifiers; `SettingsStore.parseRules` still rejects a stored rule that explicitly contains an empty `bundleIdentifier`. Use composed/decomposed Unicode cases in matching, blocker deduplication and settings deduplication: those distinct UTF-8 keys must remain distinct. Exercise `findRule` by loading the first Unicode identity and calling `addRule` with the second under a different rule ID; it must add and return the second rule. For the delimiter-collision row, use target `(bundleIdentifier: "com.example|path:/Applications/A.app", path: "/Applications/B.app")` and rule `(bundleIdentifier: "com.example", path: "/Applications/A.app|path:/Applications/B.app")`. Assert their encoded keys are identical and they match, preserving current TypeScript behavior. This is a known key-format limitation, not intended identity semantics.

Add rule-construction checks for the `rule_` prefix, stable output for the same identity, different output for bundle-qualified versus path-only references, omission of an empty `bundleIdentifier`, and preservation of an explicitly supplied `selectedAt` value. Test `bondedObservedApplicationId(path:bundleIdentifier:)` for the `app_` prefix and distinct bundle-qualified versus path-only seeds. Pass an executable path to the helper and verify that the path is used unchanged.

Preserve the existing containment behavior with tests for the outermost `.app` when a nested helper bundle exists, a plain executable path, a bare `Foo.app`, a trailing slash after `.app`, case-insensitive `.app` matching, and a lookalike such as `Foo.appish/Contents/MacOS/Tool` that must not match.

Add blocker-level tests that load a bundle-less rule, then observe a same-path target with a non-empty bundle identifier. Assert `observe(...).selected == false`; also cover the inverse one-sided case, exact identity, neither identifier, and empty-versus-missing identifiers. Add composed/decomposed path and identifier cases to verify `load`, `findRule` and target matching use byte-exact identity data rather than Swift `String` equality. These pin `ObservedIpBlocker.observe` behavior after its local matcher is removed. Add a settings fixture containing composed/decomposed but byte-distinct identities and assert `parseRules` retains both. In `NativeRuntimeTests.swift`, retain the existing legacy rule-ID migration test and assert that loading semantically changes only the legacy `app_` ID to `rule_`: the persisted top-level fields remain `version`, `monitoringEnabled`, `monitorWhenHidden`, `blockingEnabled` and `applicationRules`, and the rule keeps its path, display name, target kind, bundle identifier and `selectedAt`.

Pin `bondedOpaqueId(prefix: "flow", value: "abc")` to `flow_ba7816bf8f01cfea`. This reuses the existing SHA-256 fixture and protects the generic hash used by `FlowHistory`; the rule-construction and observed-application ID tests pin `rule_` and `app_` separately.

First run `swift test --package-path native/moirasia-runtime --filter BondedApplicationIdentityTests`. The one-sided non-empty bundle-identifier cases must fail against the current native matcher; then implement the fix and require the focused tests to pass. Keep the pre-existing TypeScript application-identity tests unchanged.

### 2. Establish the native identity implementation

Add `native/moirasia-runtime/Sources/BondedRuntime/ApplicationIdentity.swift`.

Move the existing public identity-key, rule-construction, rule-matching and containing-application functions out of `ObservedIpBlocker.swift` and `ProcessResolver.swift`. Preserve every existing public name, signature, type and access level. Implement `bondedMatchesApplicationRule` as equality between the target and rule identity-key `Data` values from `bondedApplicationRuleIdentityData`. Treat an empty bundle identifier as absent in the identity key and in the constructed rule, matching the TypeScript truthy check. Keep `SettingsStore.parseRules` rejecting a persisted record whose `bundleIdentifier` field is present but empty.

Add the internal `bondedApplicationRuleIdentityData(path:bundleIdentifier:)` helper, returning `Data(bondedApplicationRuleIdentity(path: path, bundleIdentifier: bundleIdentifier).utf8)`. Use this data value everywhere keys are compared or deduplicated: `bondedMatchesApplicationRule`, `ObservedIpBlocker.load`, `ObservedIpBlocker.findRule`, and `SettingsStore.parseRules` (store dedupe values in `Set<Data>`, not `Set<String>`). This matches JavaScript string equality for canonically distinct Unicode sequences while preserving the public string key and its hash seed. Keep the existing unescaped delimiter format and its documented collision behavior.

Add the internal `bondedObservedApplicationId(path:bundleIdentifier:)` helper. It must return `bondedOpaqueId(prefix: "app", value: bondedApplicationRuleIdentity(path: path, bundleIdentifier: bundleIdentifier))`. `ProcessResolver` passes its existing executable path unchanged. Keep rule construction on the native `rule_` prefix. Do not make the generic opaque-ID helper part of the Application identity interface.

Add `native/moirasia-runtime/Sources/BondedRuntime/OpaqueIds.swift` and move `bondedOpaqueId` there without changing its implementation or output. This is a source-placement change only. Do not modify `Package.swift`: both files belong to the existing target.

### 3. Route callers through the owner and delete duplicate logic

In `ProcessResolver.swift`, replace the inline identity expression and `app_` hashing with `bondedObservedApplicationId(path:bundleIdentifier:)`. Pass the raw executable path returned by `proc_pidpath`; do not substitute the containing `.app` path. This preserves native target paths and observed IDs for existing valid inputs. Keep PID lookup, cache behavior and metadata extraction unchanged. Remove the old definition of `bondedContainingApplication` from this file while preserving its call sites.

In `ObservedIpBlocker.swift`, remove the moved free-function definitions and delete the private `bondedMatches` implementation. Have `ruleForTarget` call `bondedMatchesApplicationRule`. Use `bondedApplicationRuleIdentityData` in `load` and `findRule` so deduplication and fallback lookup use the same byte-exact comparison. Leave learned-address state and limit handling untouched.

In `SettingsStore.swift`, keep validation and migration behavior unchanged. `parseRules` continues to reject a present-but-empty `bundleIdentifier`, but changes its identity deduplication set from `Set<String>` to `Set<Data>` using `bondedApplicationRuleIdentityData`. `canonicalRuleIdentifier` continues to preserve existing `rule_` IDs and convert legacy `app_` IDs to identity-derived `rule_` IDs.

`BondedRuntime.swift` already uses `bondedMatchesApplicationRule` and `bondedApplicationRuleForTarget`; do not change those call sites or firewall/application-selection sequencing. With the corrected matcher, explicitly selecting an observed target whose path matches only a bundle-less stored rule creates a separate bundle-qualified rule and saves both records. Do not silently upgrade the old path-only rule.

### 4. Keep the domain notes accurate

Update the **Application identity** entry in `CONTEXT.md` to state that the TypeScript module is the local-mode implementation and the Swift `BondedRuntime` module is its native-mode peer. Record byte-exact key comparison, empty identifiers treated as absent, one-sided identifiers not matching, and `targetKind` being ignored. Also record the resolver path difference (TypeScript application bundle path versus Swift raw executable path) and that IDs/state are mode-local. Keep the existing product responsibilities and avoid introducing a new domain term.

Add a short matching ownership note to `docs/architecture/standalone-applications.md` in the native feature section. Distinguish the Swift implementation from the TypeScript implementation, including their different resolver path inputs and native `rule_` versus TypeScript `app_` stored-rule prefixes. Do not claim that the two language implementations share runtime state, persisted IDs or a cross-language module.

## Validation

Run checks from the repository root:

1. `swift test --package-path native/moirasia-runtime`. The test target depends on `BondedRuntime`, both executables and every other package target, so this also compiles the complete debug target graph.
2. `swift build --package-path native/moirasia-runtime -c release --arch arm64` on macOS, matching the runtime packaging architecture without running the staging script.
3. `pnpm --dir apps/integrated/Bonded exec vitest run tests/application-identity.test.ts` to verify the unchanged TypeScript reference contract.
4. `git diff --check` and inspect `git diff -- CONTEXT.md docs/architecture/standalone-applications.md native/moirasia-runtime` for accidental changes to protocol, settings format, ID prefixes or unrelated Bonded behavior.

Do not run `pnpm runtime:build` solely for this refactor. Its script removes and recreates `native/staged/runtime`; compiling the Swift package directly gives the relevant build check without that staging side effect.

## Acceptance criteria

- Native identity key generation has one implementation, and `ProcessResolver` no longer formats the key inline.
- Native target-to-rule matching has one implementation. The private `ObservedIpBlocker` matcher is gone.
- Native matching agrees with TypeScript string-comparison semantics for equal input paths, including one-sided, empty, case-only, Unicode-normalization and target-kind cases. Canonically distinct UTF-8 key bytes remain distinct; the existing unescaped delimiter collision remains unchanged. The matcher does not normalize the native executable path to a bundle path.
- Bundle containment keeps its current path behavior after moving to the identity implementation.
- Native `app_`, `rule_` and `flow_` prefixes, hash output, settings JSON shape and existing migration behavior remain unchanged. Empty bundle identifiers normalize to absent in keys and new rules, while persisted records that explicitly contain an empty identifier remain rejected. Identity matching and deduplication intentionally become UTF-8-byte-exact for canonically equivalent but byte-distinct strings, matching TypeScript.
- Blocker tests pin `ObservedIpBlocker.observe` selection status against the shared matcher; `BondedRuntime` continues to use that public matcher for rule selection.
- No new SwiftPM target, product, dependency, settings migration or TypeScript behavior is introduced.
- Swift tests and builds pass, and the domain notes describe both mode-specific implementations accurately.

## Risks and mitigations

- **Existing native fallback behavior changes.** A path-only stored rule will no longer match a same-path observed target with a non-empty bundle identifier. This is intentional parity with the TypeScript matcher for equal path inputs. Loading does not upgrade the old rule or guess an identifier. If the user explicitly selects that observed target, `BondedRuntime` treats it as a distinct identity, appends and saves a bundle-qualified rule, and leaves the path-only rule in place. The TypeScript resolver supplies a different path for application targets, so this refactor does not promise cross-mode key or ID equality.
- **Identifier prefixes are easy to conflate.** Native observed application IDs use `app_`; native stored rule IDs use `rule_`; flow IDs use `flow_`. Pin all three in tests and keep generic hashing separate from application identity. TypeScript local stored-rule IDs remain `app_`.
- **Swift Unicode equality currently collapses distinct TypeScript identities.** Swift considers canonically equivalent strings equal, so current matcher and `Set<String>` deduplication can collapse composed/decomposed paths or identifiers that TypeScript keeps distinct. The byte-data helper fixes this deliberately; existing valid rules that were previously merged may now remain separate.
- **The key format has an existing delimiter collision.** Unescaped `|path:` inside a bundle identifier or path can make distinct field pairs encode to the same key and therefore the same observed/rule ID. The TypeScript implementation already treats these as equal, and this refactor preserves that behavior. Fixing it requires coordinated TypeScript changes and an identity/hash migration; do not claim that distinct field values always imply distinct keys.
- **Moving functions can expose access-control assumptions.** Preserve every existing public function's access level and signature; only `bondedApplicationRuleIdentityData(path:bundleIdentifier:)` and `bondedObservedApplicationId(path:bundleIdentifier:)` are new and internal. Compile the whole Swift package, including the feature executable, before considering the refactor complete.
- **A broad cleanup could dilute the seam.** Do not refactor display names, classification, enforcement, network monitoring, the TypeScript implementation, or unrelated identifier consumers. Keep change review focused on identity ownership and exact key semantics.
