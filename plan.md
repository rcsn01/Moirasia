# Plan: canonicalize the feature resource interface

## Goal

Make named resource maps the only valid `FeaturePaths` interface. Remove the deprecated scalar aliases that validation still accepts but the feature surface host cannot consume consistently.

The finished seam must have one meaning:

- Hosts provide named maps such as `preloads.main`, `renderers.main`, and `native.helper`.
- The feature catalog declares which names each host mode requires.
- `validateFeatureResources` rejects a missing or invalid named resource before the feature surface host creates a `BrowserWindow` or registers appearance state.
- Feature implementations read the same named maps that validation checked.

This deepens the feature resource module by shrinking the interface every caller must understand. Validation and startup will use the same names, with no scalar representation that only part of the implementation understands.

## Settled decisions

### Remove all scalar aliases now

Delete these fields from `FeaturePaths`:

- `preload`
- `rendererUrl`
- `rendererFile`
- `nativeExecutable`

Do not add another deprecation period, translation module, compatibility adapter, runtime warning, or fallback. The package is private, every supported source consumer is in this workspace, and every production context producer already emits named maps.

### Keep named maps as the canonical interface

Retain:

- `preloads?: FeatureResourceMap`
- `renderers?: FeatureResourceMap`
- `native?: FeatureResourceMap`
- `workers?: FeatureResourceMap`
- `assetsDirectory?: string`
- `dataDirectory?: string`
- `legacyDataDirectories?: readonly string[]`

The maps remain optional because requirements differ by feature and host mode. Required names continue to come from `featureCatalog.get(context.id).requirements[context.mode]`. Do not make every map globally required or introduce feature-specific path types in this migration.

### Preserve validation as the seam

Keep `validateFeatureResources(context, requirements?)` as the resource validation interface. It is exported, directly tested, and called by `acquireFeatureSurface` before side effects.

Simplify its implementation so each requirement reads only its matching named map:

- preload requirements read `paths.preloads?.[name]`;
- renderer requirements read `paths.renderers?.[name]`;
- native requirements read `paths.native?.[name]`;
- worker requirements continue to read `paths.workers?.[name]`.

Keep the current URL rule for renderer values and the current absolute-path rule for all other resources. A renderer may be an absolute path or an HTTP or HTTPS URL. Other required resources must be absolute according to the existing POSIX, UNC, or drive-letter checks. Validation checks only names listed in the selected requirements. It must continue validating every supplied `legacyDataDirectories` entry.

Do not add a second validated-resource object or an accessor module. The mismatch comes from two accepted representations, not from a missing abstraction.

### Reject alias-only runtime objects before side effects

TypeScript will no longer expose the scalar fields, but runtime JavaScript can still pass arbitrary objects. Objects containing only `preload`, `rendererUrl`, `rendererFile`, or `nativeExecutable` must not satisfy named requirements.

For standalone renderer acquisition, rejection must happen in `validateFeatureResources` before `BrowserWindow` construction. The current renderer-alias path creates a window and registers appearance state, then fails in `ready()` because that code reads only `renderers.main`. That inconsistent path must disappear.

### Remove Amove's last compatibility read

Amove must read `native.addon`, `preloads.shelf`, and `renderers.shelf` directly from the maps. Delete the private `namedResource` helper. Once its fallback argument is gone, it is a one-line pass-through and fails the deletion test.

Keep the existing missing-shelf-preload guard. Leave Amove's existing `assetsDirectory` and `dataDirectory` defaults unchanged; normal registration validates both directories before constructing `AppController`, and changing those defaults is unrelated. Do not add new local defaults. Missing required resources belong to the host validation seam.

### Keep domain and host ownership decisions unchanged

This change does not add or rename a domain concept, so `CONTEXT.md` does not need an update.

There is no root `docs/adr/` directory, and this change supports the feature catalog and feature surface host split documented in `docs/architecture/standalone-applications.md`. The independent Orbis repository has its own `docs/adr/` directory, which does not govern this contract. No ADR is needed.

Do not:

- merge `acquireFeatureSurface` with `acquireStandaloneSurface`;
- move feature catalog ownership;
- redesign artifact resolution;
- alter feature lifecycle behavior;
- add a new module or adapter;
- change standalone-only application contracts that happen to use similar field names.

## Ground-truth inventory

The inventory searches `packages`, `src`, `tests`, and `apps`. It excludes nested `.git` metadata, `node_modules`, Python `.venv`, vendored dependencies, Rust `target`, Swift `.build`, and generated `out`, `dist`, `build`, and `release` directories.

### Contract declaration and fallback reads

`FeaturePaths` is declared in `packages/desktop-shell/src/feature.ts`. That file contains all four deprecated declarations and all validator fallback reads:

- `preload` can satisfy only `preloads.main`;
- `rendererUrl`, then `rendererFile`, can satisfy only `renderers.main`;
- `nativeExecutable` can satisfy only `native.executable`.

`acquireFeatureSurface` validates the context before selecting suite or standalone behavior. Standalone handling then reads only named maps. It reads `preloads.main` before constructing the window and reads `renderers.main` in `ready()` after constructing the window and registering appearance state.

The compatibility case taxonomy is:

- `preload` is considered only when `preloads.main` is nullish. It cannot satisfy any other preload name. If it is the only main preload in an otherwise valid standalone context, validation passes and `standaloneHandle` rejects the missing named `preloads.main` before constructing a window.
- `rendererUrl` is considered only when `renderers.main` is nullish. `rendererFile` is considered only when both the named value and `rendererUrl` are nullish. If either scalar renderer is the only main renderer in an otherwise valid standalone context, validation passes, a window is constructed, appearance is registered, and `ready()` disposes appearance state and destroys the window before rejecting the missing named `renderers.main`.
- `nativeExecutable` is considered only when `native.executable` is nullish. No catalog requirement asks for that name, so only an explicit requirement can reach this fallback.
- A present empty, relative, or otherwise invalid named value wins over its scalar alias under `??` and fails validation. The validator does not fall back after rejecting a named value.
- Aliases are ignored for unlisted requirements. Validation still ignores all supplied named resources that the selected requirement table does not list, except that it always validates every supplied `legacyDataDirectories` entry.

These cases cover alias absent or present, named value absent or present, matching or nonmatching requirement names, valid or invalid values, and explicit or catalog-driven requirements. There is no remaining compatibility branch outside this taxonomy.

### Production context producers

There are six production context branches. All six already emit named maps:

- `src/main/features/suite-context.ts` has suite branches for Amove, Bonded, and Shout.
- `apps/integrated/Amove/src/main/standalone.ts` emits `preloads.main`, `preloads.shelf`, `renderers.main`, `renderers.shelf`, and `native.addon`.
- `apps/integrated/Bonded/src/main/standalone.ts` emits `preloads.main`, `renderers.main`, and `native.helper`.
- `apps/integrated/Shout/src/main/standalone.ts` emits `preloads.main`, `renderers.main`, `native.helper`, and `native.driver`.

No production producer writes a deprecated scalar alias.

### Production consumers

Bonded and Shout consume named maps exclusively.

Amove has the only production scalar read outside validation. In `apps/integrated/Amove/src/main/app-controller.ts`, `preloads.shelf` falls back to `ctx.paths.preload`. The same helper reads `native.addon` and `renderers.shelf` without fallbacks.

Both Amove context producers provide `preloads.shelf`, and both Amove catalog requirement tables require it. The validator's `preload` fallback applies only to the name `main`, so `ctx.paths.preload` cannot satisfy Amove's `shelf` requirement. `AmoveFeature.register` acquires and validates the feature surface before constructing `AppController`; the controller's shelf fallback is therefore unreachable through normal suite or standalone registration. Removing it does not remove supported behavior.

### Catalog requirements

The feature catalog has six mode-specific requirement tables, one suite and one standalone table for each embedded feature:

- Amove standalone requires `preloads.main`, `preloads.shelf`, `renderers.main`, `renderers.shelf`, `native.addon`, `assetsDirectory`, and `dataDirectory`.
- Amove suite requires `preloads.shelf`, `renderers.shelf`, `native.addon`, `assetsDirectory`, and `dataDirectory`.
- Bonded standalone requires `preloads.main`, `renderers.main`, `native.helper`, and `dataDirectory`.
- Bonded suite requires `native.helper` and `dataDirectory`.
- Shout standalone requires `preloads.main`, `renderers.main`, `native.helper`, `native.driver`, and `dataDirectory`.
- Shout suite requires `native.helper`, `native.driver`, and `dataDirectory`.

No production requirement uses `native.executable`. The `nativeExecutable` fallback is reachable only through an explicit requirement in the migration-era contract test.

### Existing test coverage that must change

Three root test sites still use the old shape:

- `tests/feature-contract.test.ts` has 4 tests. Replace `keeps the legacy main resource fields usable during migration`; the other 3 tests cover named maps, workers, directories selected by explicit requirements, relative preloads, and a disallowed renderer scheme.
- `tests/feature-surface-host.test.ts` has 13 tests and 14 `acquireFeatureSurface` calls. Replace `cleans up if validation passed through a deprecated renderer alias but the named renderer is absent`; keep the other 12 tests unchanged.
- `tests/feature-runtime.test.ts` has 16 tests that share one scalar-shaped `FeatureContext` fixture even though none calls resource validation. Change only that fixture.

The focused baseline is 33 tests across those three files, and all 33 pass before the migration. Positive named-map coverage already exists in the contract and surface-host tests. Preserve it and add one catalog-driven Shout standalone case because Shout is the only production requirement set with two names in one native map. The test-local `context` helper currently restricts its `id` parameter to `'amove' | 'bonded'`; the Shout case requires widening that parameter to `FeatureContext['id']`.

Related unchanged coverage also matters. `tests/feature-catalog.test.ts` pins the Amove, Bonded, and Shout requirement tables, including both Shout native names. `tests/feature-paths.test.ts` pins all three suite producers in development and packaged modes. `apps/integrated/Amove/tests/feature.test.ts` passes canonical maps through suite and standalone acquisition but mocks `AppController`. `apps/integrated/Bonded/tests/feature.test.ts` uses canonical suite and standalone maps. Shout has no feature registration test or test `FeatureContext`; its standalone producer and direct named-map consumer are covered by the Shout type check. These tests and compiler checks do not replace the new alias-rejection cases.

### Lexical search classification

The current static search returns 49 matching lines containing 57 token occurrences for `rendererFile`, `rendererUrl`, `nativeExecutable`, or `paths.preload` across the searched source tree. Per token, it finds 5 `rendererFile` occurrences in 4 files, 38 `rendererUrl` occurrences on 33 lines in 15 files, 10 `nativeExecutable` occurrences in 7 files, and 4 `paths.preload` occurrences in 4 files. Some lines contain more than one token, so the per-token line counts are not additive. Most results are unrelated to `FeaturePaths`:

- local `rendererUrl` variables hold Electron development-server URLs;
- content-security-policy functions accept a renderer URL;
- `src/main/paths.ts` exposes the root shell's separate `preload()` path resolver;
- `packages/desktop-shell/src/standalone-launch.ts` uses a renderer URL in its own launch options;
- Exithibition owns a separate `nativeExecutable` field in its standalone application resources;
- YN360 and Orbis use separate standalone surface contracts.

The migration must classify matches rather than require the broad lexical search to return zero. After implementation there must be no deprecated alias declaration, validator fallback, production `FeaturePaths` read or write, or stale runtime fixture. Deliberate runtime-regression test objects may retain the old property spellings behind an `unknown` cast.

## Implementation steps

### Step 1: narrow `FeaturePaths` and validator reads

File: `packages/desktop-shell/src/feature.ts`

1. Remove the four deprecated scalar properties and their comments from `FeaturePaths`.
2. Keep the comment that resources are keyed by feature-owned names and renderer entries may be packaged paths or HTTP or HTTPS development URLs.
3. In `validateFeatureResources`, remove every scalar fallback.
4. Read required preload, renderer, native, and worker values only from their named maps.
5. Leave default requirement lookup through the feature catalog unchanged.
6. Leave `requireResource`, `requireDirectory`, absolute-path detection, URL detection, and existing error text unchanged.
7. Do not clean up the return values from `requireResource` or `requireDirectory`. That is unrelated work.

Expected result: the resource interface has one representation, and validation cannot accept a value downstream code ignores.

### Step 2: remove Amove's compatibility read

File: `apps/integrated/Amove/src/main/app-controller.ts`

This file belongs to the independent nested Amove Git repository.

1. Replace `namedResource(ctx, 'native', 'addon')` with `ctx.paths.native?.addon`.
2. Replace `namedResource(ctx, 'preloads', 'shelf', ctx.paths.preload)` with `ctx.paths.preloads?.shelf`.
3. Replace `namedResource(ctx, 'renderers', 'shelf')` with `ctx.paths.renderers?.shelf`.
4. Delete the private `namedResource` helper because no caller remains.
5. Keep the existing `Amove shelf preload resource is missing` guard.
6. Do not add local fallback defaults for native or renderer resources. Preserve the existing asset and data directory defaults; validated feature registration makes them unreachable, and removing them is outside this migration.

Expected result: Amove consumes the same named resources that catalog-driven validation checked.

### Step 3: replace migration-era contract coverage

File: `tests/feature-contract.test.ts`

1. Delete `keeps the legacy main resource fields usable during migration`.
2. Add focused rejection cases for alias-only runtime objects.
3. Construct those objects through a deliberate `unknown` cast to `FeatureContext['paths']`. Add a short comment that the cast models untyped runtime JavaScript rather than supported TypeScript input.
4. Cover each removed fallback independently so an earlier validation failure cannot hide a later one:
   - `preload` does not satisfy `preloads.main`;
   - `rendererUrl` does not satisfy `renderers.main`;
   - `rendererFile` does not satisfy `renderers.main`;
   - `nativeExecutable` does not satisfy `native.executable`.
5. Use an explicit single requirement for each rejection case. For the native case, require `native.executable`. A `native.helper` case already fails before this change and would not prove removal of the actual fallback.
6. Keep existing positive coverage for named preload, renderer, native, worker, and directory resources.
7. Widen the test-local `context` helper's `id` parameter from `'amove' | 'bonded'` to `FeatureContext['id']`; do not weaken any production type.
8. Add one catalog-driven positive case for a Shout standalone context with:
   - `preloads.main`;
   - `renderers.main`;
   - `native.helper`;
   - `native.driver`;
   - `dataDirectory`.
9. Do not pass explicit requirements to the Shout case. Let `validateFeatureResources` use `featureCatalog.get('shout').requirements.standalone` so the test pins default catalog lookup and the only production native map with two required names.
10. Keep invalid-path and disallowed-renderer-scheme coverage unchanged.

Expected result: contract tests describe the supported interface and prove old runtime object shapes do not regain compatibility accidentally.

### Step 4: move renderer-alias regression coverage to the acquisition seam

File: `tests/feature-surface-host.test.ts`

Replace `cleans up if validation passed through a deprecated renderer alias but the named renderer is absent` with compact coverage for both `rendererUrl` and `rendererFile`.

For each alias:

1. Start from the valid Bonded standalone context.
2. Remove `renderers` and add only that scalar alias through an `unknown` cast to `FeatureContext`.
3. Call `acquireFeatureSurface` directly. Do not expect a handle and do not call `ready()`.
4. Assert rejection with the existing `renderers.main` validation error.
5. Assert `FakeWindow.instances` remains empty.
6. Assert appearance registration was not called.
7. Assert the appearance disposer was not called.

Use a table-driven test if it remains clearer than two copied tests.

Keep `validates the context before any window exists`. That case protects general validation ordering. The new cases specifically protect against reintroducing renderer alias fallbacks.

Expected result: a renderer represented only by a removed scalar alias fails at the validation seam before window or appearance side effects.

### Step 5: update the stale runtime fixture

File: `tests/feature-runtime.test.ts`

Replace the three `CONTEXT.paths` scalar fields with their Amove suite named-map counterparts:

- `preloads.shelf`;
- `renderers.shelf`;
- `native.addon`.

Keep this fixture minimal. It does not need `assetsDirectory` or `dataDirectory` because the runtime tests exercise loading and lifecycle only, and one test clones it with a Bonded id. The runtime tests do not call resource validation. This is a type-shape correction, not a catalog-validation or behavioral test change. Do not alter runtime lifecycle assertions or add resource validation to `FeatureRuntime`.

### Step 6: run the migration inventory check

Run:

```sh
rg -uuu -n \
  --glob '!**/.git/**' --glob '!**/node_modules/**' --glob '!**/.venv/**' --glob '!**/vendor/**' \
  --glob '!**/.build/**' --glob '!**/target/**' \
  --glob '!**/out/**' --glob '!**/dist/**' --glob '!**/build/**' --glob '!**/release/**' \
  "rendererFile|rendererUrl|nativeExecutable|paths\\.preload\\b" \
  packages src tests apps
```

Classify every remaining result.

Allowed results include:

- deliberate alias-only regression objects in root tests;
- development-server variables named `rendererUrl`;
- renderer URL parameters used for content security policy;
- Exithibition's separate `nativeExecutable` application resource;
- the root shell's separate `paths.preload()` resolver;
- standalone-only application contracts unrelated to `FeaturePaths`.

Disallowed results include:

- alias declarations in `FeaturePaths`;
- alias fallback reads in `validateFeatureResources`;
- production `FeatureContext` producers emitting scalar aliases;
- feature implementations reading scalar aliases;
- ordinary typed fixtures using the old shape.

## Verification strategy

The interface is the test surface. Verification should prove behavior through `validateFeatureResources` and `acquireFeatureSurface`, not private helpers.

### 1. Focused root tests

Run the directly affected tests first:

```sh
pnpm vitest run \
  tests/feature-contract.test.ts \
  tests/feature-surface-host.test.ts \
  tests/feature-runtime.test.ts
```

The pre-migration baseline is 3 files and 33 passing tests. After the edits, these tests must prove:

- canonical named resources validate;
- alias-only runtime objects fail validation;
- both renderer aliases fail before standalone window creation;
- appearance registration and disposal do not run for invalid alias-only input;
- valid suite and standalone feature surfaces retain acquisition, readiness, activation, and disposal behavior;
- feature runtime lifecycle tests still pass with canonical fixtures.

### 2. Root type check

Run:

```sh
pnpm typecheck
```

The root compiler configurations include desktop-shell, root tests, and integrated main, preload, and shared sources. This catches stale typed `FeaturePaths` consumers and invalid test fixtures.

### 3. Integrated application type checks

Run each linked application's compiler configuration:

```sh
pnpm -C apps/integrated/Amove typecheck
pnpm -C apps/integrated/Bonded typecheck
pnpm -C apps/integrated/Shout typecheck
```

These checks compile each repository's own tests and renderer sources in addition to the linked desktop-shell contract. Together with the root check, they cover every supported `FeatureContext` producer and consumer.

### 4. Root regression suite

Run:

```sh
pnpm test
```

This covers feature catalog lookup, suite context construction, feature runtime behavior, feature surface behavior, and nearby desktop-shell contracts.

### 5. Amove regression suite

Run:

```sh
pnpm -C apps/integrated/Amove test
```

Amove's feature tests mock `AppController`, so this suite does not directly execute the removed fallback expression. The direct guarantees are:

- `FeaturePaths.preload` no longer exists at compile time;
- both Amove context producers provide `preloads.shelf`;
- both Amove catalog tables require `preloads.shelf`;
- contract and surface-host tests prove validation behavior;
- root and Amove type checks compile the direct map reads.

Do not add a mock-heavy `AppController` test for a one-expression deletion.

### 6. Optional broader verification

Bonded and Shout do not need their full native suites for this migration because their production source already uses named maps and no behavior changes there. Their type checks are required.

If broader confidence is needed after all required checks pass, run their JavaScript and native suites through their existing commands:

```sh
pnpm -C apps/integrated/Bonded test
pnpm -C apps/integrated/Shout test
```

Do not make those expensive native checks a prerequisite unless a Bonded or Shout file changes unexpectedly during implementation.

### 7. Repository status and diff review

Because `apps/` contains independent repositories, inspect each status separately:

```sh
git status --short
git -C apps/integrated/Amove status --short
git -C apps/integrated/Bonded status --short
git -C apps/integrated/Shout status --short
```

Review root and Amove diffs separately. Preserve unrelated changes in every repository.

Expected code changes are:

Root repository:

- `packages/desktop-shell/src/feature.ts`;
- `tests/feature-contract.test.ts`;
- `tests/feature-surface-host.test.ts`;
- `tests/feature-runtime.test.ts`;
- `plan.md`, which records this plan.

Nested Amove repository:

- `apps/integrated/Amove/src/main/app-controller.ts`.

Bonded and Shout repositories should remain unchanged.

## Acceptance criteria

- `FeaturePaths` exposes only named resource maps and directory fields.
- `validateFeatureResources` has no scalar alias fallback.
- `validateFeatureResources` keeps its existing interface, catalog lookup, path rules, URL rules, and error text.
- Every production suite and standalone feature context uses named maps.
- Amove has no `ctx.paths.preload` fallback and no `namedResource` pass-through helper.
- Scalar aliases do not satisfy named requirements when passed by untyped runtime JavaScript.
- `rendererUrl`-only and `rendererFile`-only standalone contexts fail before a `BrowserWindow` exists.
- Invalid alias-only standalone input does not register or dispose appearance state.
- Valid suite and standalone feature surfaces retain current behavior.
- Runtime lifecycle behavior remains unchanged.
- The static migration search contains no production alias declaration, read, write, or stale typed fixture.
- Focused root tests pass.
- Root and all three integrated-application type checks pass.
- The full root test suite passes.
- Amove's test suite passes.
- No unrelated standalone contract is renamed merely because it contains `rendererUrl` or `nativeExecutable`.
- No new dependency, module, adapter, domain term, or ADR is introduced.
- Root and nested repository diffs contain no unrelated edits.

## Risks and controls

### Private-package compatibility

Risk: a supported consumer may still construct `FeaturePaths` with scalar fields in a source path missed by a narrow search.

Controls:

- search the full non-generated tree;
- inspect all six production context branches;
- run root and all three integrated-application type checks;
- treat callers outside this private, checked workspace as unsupported.

### Runtime JavaScript input

Risk: removing TypeScript fields alone may leave arbitrary JavaScript objects silently accepted.

Controls:

- remove validator fallbacks, not only type declarations;
- cover all four aliases independently at the validation seam;
- cover both renderer aliases through `acquireFeatureSurface`;
- assert no window or appearance side effects occur.

### Amove shelf startup

Risk: removing the fallback may reveal an incomplete Amove context.

Controls:

- both suite and standalone Amove producers already provide `preloads.shelf`;
- both catalog requirement tables require `preloads.shelf`;
- the old scalar fallback cannot satisfy the catalog's `shelf` requirement and is already unreachable through normal registration;
- validation runs before `AppController` construction;
- preserve the unrelated asset and data directory defaults;
- run root and Amove type checks plus Amove tests.

### False-positive migration search results

Risk: a blanket rename could damage unrelated contracts that use the same words.

Controls:

- classify each lexical match by owning type and module;
- keep development `rendererUrl` variables and content-security-policy parameters;
- keep Exithibition's separate `nativeExecutable` resource;
- keep the root shell's `paths.preload()` resolver;
- change only values typed or consumed as `FeaturePaths`.

### Over-expansion

Risk: the nearby feature resource model invites broader changes to artifact resolution, feature-specific typing, feature surfaces, or lifecycle ownership.

Controls:

- keep one canonical resource representation as the sole goal;
- preserve the feature catalog and feature surface host seams;
- add no abstraction for direct named-map reads;
- record other architecture candidates separately rather than combining them with this migration.

### Nested repository ownership

Risk: root status does not report changes in the ignored integrated application repositories.

Controls:

- inspect Amove, Bonded, and Shout statuses independently before and after implementation;
- expect one Amove source edit only;
- do not stage, commit, or alter nested repository history as part of implementation unless requested separately.

## Completion sequence

1. Narrow `FeaturePaths` and remove validator fallbacks.
2. Remove Amove's fallback and pass-through helper.
3. Replace migration-era contract coverage with alias-rejection cases.
4. Move renderer-alias coverage to rejection-before-side-effects behavior.
5. Convert the runtime fixture to named maps.
6. Run and classify the static migration search.
7. Run focused root tests.
8. Run root and integrated-application type checks.
9. Run the full root suite and Amove suite.
10. Inspect root and nested repository statuses and diffs for exact scope.
11. Confirm every acceptance criterion before declaring the implementation complete.
