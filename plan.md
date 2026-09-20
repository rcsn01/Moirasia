# Implementation plan: the Application identity module

## Decision

Architecture-review candidate 1, finalized. One deep module owns every definition of "the same application" in Bonded: identity-key construction, rule matching, bundle containment, display-name derivation, and opaque-id seeding. Today those five facts live in four modules with three different key formats and one live divergence between the stored identity key and runtime matching. After this change there is one interface with one test surface, and identity bugs have locality.

Terminology follows `CONTEXT.md` and the codebase-design vocabulary: the new module is the **Application identity module**; `settings-store`, `observed-ip-blocker`, and `process-resolver` become thin **adapters** over it. `application-classifier` does not become an adapter — it consumes nothing from the new module (its cache key stays internal, see "What deliberately stays out"); the module only documents the key-format distinction once. No new seam is invented: the module is in-process, and its two real adapters (persisted `StoredApplicationRule` vs freshly resolved `ProcessTarget`) already exist on either side of it.

## Verified baseline

Repository root: `/Users/mac/Syncthing/Projects/Moirasia`. Nested Bonded repo: `apps/integrated/Bonded`, branch `main`, tip `475d4a0 feat: sort Apple apps last`; root tip `af28a24 feat: add native Bonded application classification`. Both worktrees are clean as of this plan. `plan.md` in the repository root was the previous (completed) native-feature-state plan and has been deleted per instruction; this file replaces it.

Vocabulary sources read: root `CONTEXT.md` (domain glossary; no Bonded-specific "Application identity" term exists yet — this plan adds one, see "CONTEXT.md update"). No ADR directory exists at root or under `apps/integrated/Bonded`; no ADR conflicts. `docs/architecture/standalone-applications.md` was not re-litigated: this plan touches no launch/mode/lease decisions.

## The five scattered definitions (evidence)

| # | Location | Format / behavior |
|---|----------|-------------------|
| 1 | `settings-store.ts:26` `applicationRuleIdentity` | `bundle:<id>\|path:<path>` or `path:<path>` when no bundle id |
| 2 | `observed-ip-blocker.ts:54` `matchesApplicationRule` | both have bundle id ⇒ bundle **and** path must match; otherwise **path only** — accepts a same-path/different-bundle-id target the store would reject as a distinct identity |
| 3 | `application-classifier.ts` `classify` cache key | `path\0targetKind\0bundleIdentifier` — a *different* key for the same concept (intentionally: classification is per-path evidence), but stated ad hoc |
| 4 | `process-resolver.ts:37` `containingApplication` | regex extracting `…​.app` from an executable path |
| 5 | `process-resolver.ts:108` | `opaqueId('app', path)` — seeds the opaque id from **path only**, so the same `.app` path under a different bundle identifier (app replaced in place, or a bundle-id read that flaps) keeps one observed id across bundle identities while the strict matching branch treats such a pair as different apps, and a bundled app's observed id ignores the bundle identifier its persisted rule id uses |

Also related: `observed-ip-blocker.ts:38` `applicationIdentityKey` is a pure re-export alias of definition 1; `settings-store.ts:190` `addApplicationIfMissing` dedupes by id **or** identity; `observed-ip-blocker.ts:70` (`load`) dedupes by identity only while `observed-ip-blocker.ts:155` (`findRule`, backing `addRule`) dedupes by id **or** identity. Path-only and not touched by this plan: `controller.ts:269` excludes the host's own app by comparing `containingApplication` outputs.

Divergence consequence today: a rule persisted as `bundle:com.a|path:/App.app` and a later process target with the same path but a **missing** bundle id (a failed bundle-id read) match by path in `matchesApplicationRule` — an unidentified process silently adopts the bundle-keyed rule and its learned addresses — while the two sides produce different identity strings in `applicationRuleIdentity`. A target with the same path but a **different** bundle id does **not** match today (the strict branch requires bundle equality) yet still collides on the observed id, which is seeded from the path alone. Re-selection always reuses the existing rule through the path fallback, and the blocker's `findRule` hits the persisted rule by id, so this divergence never inserts a duplicate rule — it manifests as lenient adoption plus the id-seed inconsistency of definition 5. No test pins the one-sided-bundle case: `tests/observed-ip-blocker.test.ts` covers only both-present and both-absent pairs.

## The deepened module

**New file:** `apps/integrated/Bonded/src/main/application-identity.ts`

```
Interface (all exports; pure, no Electron, no fs, no clock):
  interface ApplicationTargetLike { path: string; targetKind: 'application' | 'executable'; bundleIdentifier?: string; displayName?: string }
  identityKey(target | rule): string          // the single key format, replaces definitions 1+2
  matchesRule(target, rule): boolean          // defined in terms of identityKey
  ruleForTarget(target, selectedAt?): StoredApplicationRule   // moved from observed-ip-blocker.ts
  containingApplication(executablePath): string | undefined   // moved from process-resolver.ts
  applicationId(target): string                 // opaqueId('app', seed); seed = `bundle:<id>|path:<path>` when the target's bundle id was read, else the raw path
  displayNameForPath(path): string            // basename/extension logic moved from process-resolver.perform
```

Interface invariants (these *are* the depth; all hidden from callers):

- One key format: `bundle:<id>|path:<path>` when a bundle identifier exists on **either** side being compared, else `path:<path>`. `matchesRule` compares computed keys, so the fallback divergence becomes structurally impossible.
- `identityKey` is total, pure, and cheap; no normalization beyond trimming nothing (paths arrive canonical: `realpath` output or `Info.plist`-adjacent app path — the resolver's job, unchanged).
- `applicationId` stays `opaqueId('app', seed)` — see "id-seed migration" below for the exact seed policy (raw path unless a bundle id was read, so executable ids do not churn).
- No persistence, no cache, no I/O: depth comes from the *decision* (what makes two references the same application), not from machinery.

**Deletion test:** delete this module and the five definitions reappear across four files, plus the divergence bug reappears as an unowned gap between two of them. Complexity concentrates — it earns its keep.

**Seam placement:** the seam sits between *resolved process targets* (produced by `process-resolver`, consumed live) and *persisted rules* (produced by `settings-store`, consumed at load). The module's interface is the only crossing point. Both adapter types are real and both are exercised in tests through the same interface.

**What deliberately stays out:** classification cache-keying (definition 3 stays inside `application-classifier` — classification is a property of *evidence per path*, not of identity; the module only guarantees the key format is documented once, in `identityKey`), `readBundleIdentifier` (I/O, stays in `process-resolver`), and `MAX_APPLICATION_RULES` (capacity policy stays with the store/blocker).

## Migration of call sites

1. **`settings-store.ts`** — delete `applicationRuleIdentity`; import `identityKey` from `./application-identity`. `parseApplicationRules` and `addApplicationIfMissing` call `identityKey`; `identityKey` emits the identical string for every single-reference shape (`bundle:<id>|path:<path>` when the rule carries a bundle id, else `path:<path>`), so dedupe behavior is unchanged. The store has no direct test of `applicationRuleIdentity` today; its behavioral `addApplicationIfMissing` dedupe test stays and keeps passing untouched.
2. **`observed-ip-blocker.ts`** — delete `applicationIdentityKey`, `applicationRuleForTarget`, `matchesApplicationRule`, and the now-consumerless local `ApplicationRuleTarget` interface (nothing outside this file imports it); import `matchesRule` and `identityKey` from `./application-identity` — **not** `ruleForTarget`, which the blocker never calls (only `controller.ts` creates rules) and which would collide with the blocker's own private `ruleForTarget` finder. `load` (line 70) dedupes with `identityKey`; `findRule` (line 155) keeps its id-or-identity shape (`this.rules.get(rule.id)` fast path preserved) with `identityKey` substituted; the private `ruleForTarget`/`ruleIdForTarget` take `ProcessTarget` and call `matchesRule`.
3. **`process-resolver.ts`** — `containingApplication` and the `displayName = basename(path, extname(path))` line move out; `perform` composes `containingApplication`, `displayNameForPath`, `applicationId(target)`, and keeps `readBundleIdentifier` + classifier delegation as-is. In the same commit, update `controller.ts`'s `containingApplication` import (`./process-resolver` today, line 8; used for `ownApplicationPath` at line 26) to `./application-identity`, or the process-resolver migration commit's `tsc --noEmit` fails.
4. **`controller.ts`** — imports of `matchesApplicationRule`/`applicationRuleForTarget` come from `./observed-ip-blocker` today; after migration they import from `./application-identity` (or keep re-exports for one commit — decision: re-export **not** kept; controller updates its imports — the identity functions now come from `./application-identity`, `ObservedIpBlocker` stays on `./observed-ip-blocker` — no consumer outside this repo).

`opaqueId` in `ids.ts` stays as the low-level hash formatter (mirrors `artifactPath`'s role in the catalog); the identity module is its only application-side caller.

### Id-seed migration (behavior change, deliberate)

`process-resolver` seeds the opaque id from `path` only. Under the unified module the seed becomes: the raw path for executables and for applications whose bundle-id read failed, `bundle:<id>|path:<path>` for applications **when the bundle identifier was read**. This changes `ObservedApplication.id` for bundled apps between sessions. The observed id is derived and never persisted — no `app_*` id derived from an observation reaches any store; the `opaqueId` outputs that **are** persisted are rule ids in `settings.json`, and their seed (`identityKey`, applied at selection time, not observation time) is unchanged by this migration. `isOpaqueId` shape is unchanged. The id-pin risk check is resolved as of this plan: `rg "app_[a-f0-9]{16}"` over the root's `apps/`, `packages/`, `src/`, `scripts/` finds no consumer pinning an observed id across restarts — every hit is a shape-only fixture (`app_0123456789abcdef` in the native/renderer/contract tests, `app_aaaa…` fillers, and `tests/process-resolver.test.ts` matching only `/^app_[a-f0-9]{16}$/`); e2e asserts no observed id. The plan accepts the id churn because it fixes the real inconsistency: today a bundled app's observed id ignores its bundle id while its persisted rule id uses it.

One accepted edge: the bundle-id read can fail intermittently (1s `plutil` timeout), so the same bundle's observed id can flap between the two seeds across resolver-cache expiries within a session. `FlowHistory` is keyed by target id, so a flip adds a second history entry for the same app, and stale renderer-held ids fail selection with 'The observed application is no longer available' until the 15-minute expiry clears them. Rare and self-healing; accepted.

### The divergence fix (behavior change, the point of the work)

`matchesRule` is defined as identity-key equality: `identityKey(target) === identityKey(rule)`. When both sides carry a bundle identifier the key embeds both bundle and path, so **both** must be equal; when neither carries one the key is the path alone; when exactly one side carries a bundle identifier the keys cannot be equal, so there is **no** match — conservative: an unidentified process must not silently adopt a bundle-keyed block. This makes the fallback divergence structurally impossible. Exact table locked in tests:

| rule bundle | target bundle | match on |
|---|---|---|
| present, same id | present, same id | bundle + path (identity) |
| present, different id | present, different id | no match (keys differ) |
| present | absent | no match |
| absent | present | no match |
| absent | absent | path |

This is a deliberate tightening of today's fallback (`target.bundleIdentifier && rule.bundleIdentifier → both; else path`). Today rule-with-bundle + target-same-path-without-bundle matches by path; after this plan it does not. Same-path pairs with bundle ids on both sides already never match today (the strict branch) and keep not matching; both-absent pairs keep matching by path. The fixture monitor's `curl` flows carry no bundle id and rules for executables carry none (verified: the fixture `resolvePath` returns `/usr/bin/curl`, so every e2e target is an executable), so `tests/e2e/app.spec.ts` flow is unaffected; the e2e run after migration re-verifies.

## Tests (new module = new test file)

**New:** `apps/integrated/Bonded/tests/application-identity.test.ts`, table-driven, pure:

- identity keys: with/without bundle id, path-only equality, same-path/different-bundle **distinct**, bundle-match/path-mismatch (still distinct — both bundle and path are in the key)
- `matchesRule` full truth table above, including the tightened row, as a regression pin
- `ruleForTarget` id stability: same target → same id, twice
- `containingApplication`: nested `.app` inside `.app` picks the **outermost** bundle — verified against the current regex during plan review (`/Applications/Foo.app/Contents/MacOS/Bar.app/Contents/MacOS/bin` → `/Applications/Foo.app`; the non-greedy prefix stops at the first `.app` followed by `/` or end-of-string, and a trailing bare `Foo.app` also matches). The existing resolver test's expectation `/Applications/Browser.app` for the Helper-inside-Browser case is consistent and is re-asserted here
- `displayNameForPath`: application strips `.app`, executable keeps basename
- `applicationId` collides when seeds collide (documents the invariant, guards future seed changes)

**Updated:** `tests/observed-ip-blocker.test.ts` — the matching assertions in its first test duplicate the identity surface and move to the identity module's tests (the blocker has no identity-key assertions to delete: `applicationIdentityKey` had no test importer); the remaining blocker-behavior tests keep constructing rules via `ruleForTarget` imported from `./application-identity`. `tests/process-resolver.test.ts` — the `containingApplication` test moves to the identity module's tests (no re-export is kept on the resolver); the resolver file keeps its cache, process-name-refresh, and classification cases. `tests/settings-store.test.ts` — untouched: it imports no identity symbol today and its dedupe test passes via the store's unchanged behavior. `tests/controller.test.ts` — no change (verified: it imports no identity symbol and exercises no matching flow).

**Test surface statement:** every identity fact is tested through the new module's interface; the blocker and store tests stop re-probing the identity-key format directly (the store keeps its behavioral dedupe test through `addApplicationIfMissing`). No test reaches past the interface (no private-state poking).

## CONTEXT.md update

Add to root `CONTEXT.md` under Terms:

> **Application identity** — `apps/integrated/Bonded/src/main/application-identity.ts`; the single owner of "the same application": identity key (`bundle:<id>|path:<path>` or `path:<path>`), rule matching, bundle containment, and opaque-id seeding for observed applications. Settings, the observed-IP blocker, and the process resolver are adapters over it.

## Execution steps (each its own commit, nested repo `apps/integrated/Bonded`)

1. **Add the module + table-driven tests, no consumers moved.** `application-identity.ts` + `application-identity.test.ts` green. Verify: `pnpm -C apps/integrated/Bonded exec vitest run tests/application-identity.test.ts`.
2. **Migrate `process-resolver`** to `containingApplication`/`displayNameForPath`/`applicationId` from the module; delete its local regex and basename logic; move the `containingApplication` test import; update `controller.ts`'s `containingApplication` import (migration item 3). Verify: focused resolver tests + `tsc --noEmit`.
3. **Migrate `settings-store`** to `identityKey`; delete `applicationRuleIdentity`; settings-store tests keep passing untouched (they exercise the store's interface, which is unchanged).
4. **Migrate `observed-ip-blocker`** to `matchesRule`/`identityKey`; delete its three local functions and the local `ApplicationRuleTarget` interface; controller import updates in the same commit. Verify: focused blocker + controller tests.
5. **Tighten matching** per the table (the one behavior change), with its regression test already in place from step 1. Verify: full nested Vitest.
6. **Update root `CONTEXT.md`** with the Application identity term.
7. **Full verification:** nested `typecheck`, full `vitest run` (expect 75+ passed / 1 skipped), `build:renderer`, full `playwright test` (2 passed, 2 packaged skipped), root `pnpm typecheck`, root `pnpm test`. If the shared runtime lease is held by a live Moirasia host, ask before terminating it (same environmental blocker as before).
8. **Status check:** both repos clean after commits; no leftover `applicationRuleIdentity`/`applicationIdentityKey`/`applicationRuleForTarget`/`matchesApplicationRule`/`ApplicationRuleTarget` references (`rg` clean).

Commit messages: `refactor: own application identity in one module` (steps 2–4 may fold into it if the intermediate states add no review value; step 5 is its own commit: `fix: match bundle-keyed rules by bundle identity`).

## Out of scope

- The async cache deepening (candidate 2) — the identity module is its future first adapter, not part of this plan.
- Native (`ApplicationClassifier.swift`) — classification is not identity; the native runtime is untouched.
- Renderer label/ordering code — already settled in `475d4a0`.
- Any persistence-format change — `settings.json` v3 keys are untouched; identity keys never hit disk (ids on disk are opaque hashes of pre-existing seeds, and stored rules carry path/bundleIdentifier directly).