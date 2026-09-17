# Plan: canonicalize the feature resource interface

## Goal

Make named resource maps the only valid `FeaturePaths` interface. Remove the deprecated scalar aliases that validation still accepts but `acquireFeatureSurface` cannot consume.

The finished seam must have one meaning:

- hosts provide named maps such as `preloads.main`, `renderers.main`, and `native.helper`;
- the feature catalog declares which names each host mode requires;
- `validateFeatureResources` rejects a missing or invalid named resource before the surface host creates a `BrowserWindow` or registers appearance state;
- feature implementations read the same named maps that validation checked.

This deepens the feature resource module by shrinking the interface that every caller must understand. Validation and startup will use the same names, with no scalar representation that only one layer understands.

## Ground-truth inventory

The inventory below excludes generated `out/`, `dist/`, `build/`, `release/`, dependency, and nested `.git` content.

- `FeaturePaths` is declared once, in `packages/desktop-shell/src/feature.ts`. That file contains all four deprecated declarations and all four compatibility reads: `preload` for `preloads.main`, `rendererUrl` then `rendererFile` for `renderers.main`, and `nativeExecutable` for `native.executable`.
- There are six production context branches: three cases in `src/main/features/suite-context.ts` and one `standaloneContext` in each integrated repository. All six emit named maps. The catalog has six mode-specific requirement tables, one suite and one standalone table for each of Amove, Bonded, and Shout.
- Production has one scalar `FeaturePaths` read outside the validator: `apps/integrated/Amove/src/main/app-controller.ts` passes `ctx.paths.preload` as the fallback for `preloads.shelf`. Its other two `namedResource` calls read `native.addon` and `renderers.shelf` without fallbacks.
- Three root test sites still use the old shape: the migration test in `tests/feature-contract.test.ts`, the renderer cleanup case in `tests/feature-surface-host.test.ts`, and the `CONTEXT` fixture in `tests/feature-runtime.test.ts`.
- `acquireFeatureSurface` has one implementation and 14 calls in `tests/feature-surface-host.test.ts`, plus the three production feature callers and Amove's surface-recreation call. It invokes `validateFeatureResources` before selecting suite or standalone handling.
- The current non-generated tree has 5 `rendererFile` matches in 4 files, 10 `nativeExecutable` matches in 7 files, 33 lexical `rendererUrl` matches in 15 files, and 4 `paths.preload` matches in 4 files. Most are not `FeaturePaths`: development-server locals and CSP parameters use `rendererUrl`; Exithibition owns a separate `nativeExecutable` field; and the root shell's `paths` resolver has a `preload()` method. The migration search must classify these matches rather than expect zero.
- `@moirasia/desktop-shell` is private. The root suite and all three integrated feature repositories resolve it locally. Those four are the complete source consumers of `FeatureContext`; the standalone-only applications use separate contracts such as `StandaloneSurfaceOptions`.

## Why this change is ready

The migration to named maps is complete for production context producers:

- `src/main/features/suite-context.ts` emits named maps for Amove, Bonded, and Shout.
- `apps/integrated/Amove/src/main/standalone.ts` emits named maps.
- `apps/integrated/Bonded/src/main/standalone.ts` emits named maps.
- `apps/integrated/Shout/src/main/standalone.ts` emits named maps.
- Bonded and Shout feature implementations read named maps exclusively.
- Amove reads named maps except for one remaining `ctx.paths.preload` fallback in `AppController`.

The aliases have different, incompatible limits:

- In `validateFeatureResources`, `preload` can satisfy only `preloads.main`. Separately, Amove's controller can use it for `preloads.shelf`; Step 2 removes that production fallback. When every other requirement is named and only the main preload uses the scalar alias, validation passes, then standalone handling rejects before constructing a window.
- `rendererUrl` and `rendererFile` can satisfy only `renderers.main`. When every other requirement is named and only the main renderer uses a scalar alias, standalone acquisition creates a window and registers appearance state, then `ready()` rejects because it reads only the named map. Commit `57a26a7` added cleanup for this inconsistent state rather than removing its cause.
- `nativeExecutable` can satisfy only a requirement literally named `native.executable`. None of the six catalog requirement tables uses that name, so this fallback is unreachable through catalog-driven production validation. The migration contract test reaches it by passing explicit requirements.
- Named values take precedence under `??`. An empty or invalid named value does not fall back to a scalar alias; validation rejects it.

No production producer or supported `FeatureContext` consumer emits the aliases. Because the package is private and every supported consumer is in the checked source set, remove the aliases now rather than carry compatibility for unsupported callers.

## Decisions

### 1. Remove all four scalar aliases now

Delete these fields from `FeaturePaths`:

- `preload`
- `rendererUrl`
- `rendererFile`
- `nativeExecutable`

Do not add another deprecation period, translation module, compatibility adapter, or runtime warning. No supported producer needs the old shape, so compatibility code would add behavior with no consumer.

### 2. Keep named maps as the canonical interface

Retain:

- `preloads?: FeatureResourceMap`
- `renderers?: FeatureResourceMap`
- `native?: FeatureResourceMap`
- `workers?: FeatureResourceMap`
- `assetsDirectory?: string`
- `dataDirectory?: string`
- `legacyDataDirectories?: readonly string[]`

The maps remain optional because requirements differ by feature and host mode. Required names continue to come from `featureCatalog.get(context.id).requirements[context.mode]`. Do not make every map globally required or introduce feature-specific path types in this change.

### 3. Preserve the existing validation seam

Keep `validateFeatureResources(context, requirements?)` as the resource validation interface. It is already exported, directly tested, and called by `acquireFeatureSurface` before side effects.

Simplify its implementation so each requirement reads only its matching named map:

- preload requirements read `paths.preloads?.[name]`;
- renderer requirements read `paths.renderers?.[name]`;
- native requirements read `paths.native?.[name]`;
- worker requirements continue to read `paths.workers?.[name]`.

Keep the current URL rule for renderer values and the current absolute-path rule for all other resources. A renderer may be an absolute path or an HTTP(S) URL. Other required resources must be absolute according to the existing POSIX, UNC, or drive-letter checks. Validation checks only names listed in the selected requirements; it also validates every supplied `legacyDataDirectories` entry. Keep directory validation and existing error text unchanged.

Do not add a second validated-resource object or a new accessor module. The mismatch comes from two accepted representations, not from missing abstraction. Removing the aliases is the narrow root-cause fix.

### 4. Reject alias-only input before side effects

Although TypeScript will no longer expose the scalar fields, runtime JavaScript can still pass arbitrary objects. Each of `preload`, `rendererUrl`, `rendererFile`, and `nativeExecutable` must be ignored when the corresponding named map entry is absent.

For standalone renderer acquisition, rejection must happen in `validateFeatureResources` before `BrowserWindow` construction. The old renderer-alias behavior, creating and then destroying a window during `ready()`, must disappear. The contract-level cases must cover all four aliases because preload and native aliases have different name restrictions and failure paths.

### 5. Remove the last production fallback

In Amove's `AppController`, read `native.addon`, `preloads.shelf`, and `renderers.shelf` directly from their maps. Delete the private `namedResource` helper. Once its fallback argument is gone, the helper is only a one-line indexed-property pass-through and no longer hides any policy.

This is safe because both Amove context producers provide `preloads.shelf`, the Amove suite and standalone catalog tables require it, and `AmoveFeature.register` awaits `acquireFeatureSurface` before constructing `AppController`.

### 6. Keep domain and architecture decisions unchanged

No `CONTEXT.md` update is needed. This work does not add or rename a domain concept.

No ADR is needed. There is no `docs/adr/` directory, and the change supports the documented feature catalog and feature surface host split in `docs/architecture/standalone-applications.md`.

Do not merge `acquireFeatureSurface` with `acquireStandaloneSurface`, change feature catalog ownership, redesign artifact resolution, or alter feature lifecycle behavior in this work.

## Implementation steps

### Step 1: narrow `FeaturePaths`

File: `packages/desktop-shell/src/feature.ts`

1. Remove the four deprecated scalar properties and their comments from `FeaturePaths`.
2. Keep the comment that resources are keyed by feature-owned names and renderer entries may be absolute files or HTTP(S) development URLs.
3. Remove every scalar fallback from `validateFeatureResources`.
4. Leave requirement lookup through the feature catalog unchanged.
5. Leave `requireResource` and `requireDirectory` otherwise unchanged. Their unused return values predate this migration and are unrelated cleanup.

Expected result: the public resource interface has one representation, and validation cannot accept a scalar value that downstream code ignores.

### Step 2: remove Amove's compatibility read

File: `apps/integrated/Amove/src/main/app-controller.ts`

1. Change the three resource reads to `ctx.paths.native?.addon`, `ctx.paths.preloads?.shelf`, and `ctx.paths.renderers?.shelf`.
2. Delete `namedResource`; no caller remains after those direct reads.
3. Keep the existing missing-shelf-preload guard and do not add local fallback defaults. Missing required resources belong to the host validation seam.

This file belongs to an independent nested Git repository even though the root TypeScript configuration includes it. Review its status separately during implementation.

### Step 3: replace migration-era contract coverage

File: `tests/feature-contract.test.ts`

1. Delete the test named `keeps the legacy main resource fields usable during migration`.
2. Add focused rejection cases that pass alias-only objects through a deliberate `unknown` cast, documenting that the cast models runtime JavaScript rather than the TypeScript interface.
3. Cover each old fallback independently so an earlier validation error cannot hide a later alias:
   - `preload` does not satisfy `preloads.main`;
   - `rendererUrl` does not satisfy `renderers.main`;
   - `rendererFile` does not satisfy `renderers.main`;
   - `nativeExecutable` does not satisfy `native.executable`.

Use `native.executable` in the last case. A `native.helper` case already fails before this change and would not prove removal of the actual fallback.
4. Keep existing positive coverage for named preload, renderer, native, worker, and directory resources.
5. Add one catalog-driven positive case for a Shout standalone context with `preloads.main`, `renderers.main`, `native.helper`, `native.driver`, and `dataDirectory`. Do not pass explicit requirements in this case. This covers the only production resource combination with two required names in one map and pins default catalog lookup.
6. Keep existing invalid-path and disallowed-renderer-scheme coverage.

The regression test should describe runtime behavior, not preserve the old fields as part of the TypeScript interface.

### Step 4: move the surface-host regression to the real seam

File: `tests/feature-surface-host.test.ts`

Replace `cleans up if validation passed through a deprecated renderer alias but the named renderer is absent` with compact cases for both `rendererUrl` and `rendererFile`. Each case must prove:

1. a renderer represented only by that scalar alias does not satisfy the standalone resource requirement;
2. `acquireFeatureSurface` rejects with the existing `renderers.main` validation error;
3. no `BrowserWindow` is created;
4. appearance registration is not invoked, and therefore no appearance disposer is invoked.

Keep the existing `validates the context before any window exists` test. The new case specifically guards against reintroducing alias fallback behavior, while the existing case guards general validation order.

### Step 5: update stale test fixtures

File: `tests/feature-runtime.test.ts`

Replace the `CONTEXT.paths` scalar fields with named maps. Use names that match Amove suite resources so the fixture represents the current contract:

- `preloads.shelf`
- `renderers.shelf`
- `native.addon`

The runtime tests do not call resource validation, so this is a contract-fixture correction rather than a behavioral test change. The complete inventory found no other `FeaturePaths` fixture that needs migration. Do not edit standalone-only application fields that are not `FeaturePaths`, such as Exithibition's own `nativeExecutable` option.

The deprecated comments disappear with the fields, and replacing the migration-era test removes the only other compatibility description in the changed files. No user-facing documentation change is needed because `README.md`, `CONTEXT.md`, and `docs/architecture/standalone-applications.md` describe current host behavior without documenting the aliases.

## Test strategy

The interface is the test surface. Tests should prove observable behavior at `validateFeatureResources` and `acquireFeatureSurface`, not private helper behavior.

### Focused root checks

Run the directly affected tests first:

```sh
pnpm vitest run tests/feature-contract.test.ts tests/feature-surface-host.test.ts tests/feature-runtime.test.ts
```

Expected results:

- canonical named resources validate;
- alias-only objects fail validation;
- invalid standalone input creates no window;
- surface acquisition, readiness, activation, and disposal behavior remain unchanged for valid contexts;
- runtime lifecycle tests still pass with canonical fixtures.

### Static migration check

Search the full non-generated source and test tree:

```sh
rg -uuu -n \
  --glob '!**/.git/**' --glob '!**/node_modules/**' --glob '!**/.build/**' \
  --glob '!**/out/**' --glob '!**/dist/**' --glob '!**/build/**' --glob '!**/release/**' \
  "rendererFile|rendererUrl|nativeExecutable|paths\\.preload\\b" \
  packages src tests apps
```

Classify every match. Expected `FeaturePaths` alias matches are limited to the deliberate cast-based regression tests. There must be no alias declaration, validator fallback, production producer, production consumer, or stale runtime fixture. Keep unrelated matches, including development `rendererUrl` locals and CSP parameters, Exithibition's separate `nativeExecutable` contract, and the root shell path resolver's `preload()` calls.

### Type checks

Run the root type check, which includes desktop-shell and integrated feature main-process sources:

```sh
pnpm typecheck
```

Then run each linked application's own compiler configuration:

```sh
pnpm -C apps/integrated/Amove typecheck
pnpm -C apps/integrated/Bonded typecheck
pnpm -C apps/integrated/Shout typecheck
```

The root check compiles desktop-shell, root tests, and integrated main/preload/shared sources. The three app checks also compile each repository's own tests and renderer sources. Together they verify every supported `FeatureContext` consumer.

### Behavioral regression checks

Run the root suite:

```sh
pnpm test
```

Run Amove's suite for nearby feature and shelf regressions:

```sh
pnpm -C apps/integrated/Amove test
```

Amove's `feature.test.ts` mocks `AppController`, so this suite does not directly execute the changed fallback line. The direct guarantees are the compiler error after removing `FeaturePaths.preload`, the verified producer/catalog inventory, and the contract and surface-host regressions. Do not add a mock-heavy `AppController` test for a one-expression deletion.

Bonded and Shout need type checks but not full native test suites because their source already uses named maps and no runtime behavior changes there.

### Worktree checks

Because `apps/` contains ignored independent repositories, inspect statuses separately:

```sh
git status --short
git -C apps/integrated/Amove status --short
git -C apps/integrated/Bonded status --short
git -C apps/integrated/Shout status --short
```

Expected changes are exactly these five files:

- `packages/desktop-shell/src/feature.ts`;
- `tests/feature-contract.test.ts`;
- `tests/feature-surface-host.test.ts`;
- `tests/feature-runtime.test.ts`;
- `apps/integrated/Amove/src/main/app-controller.ts` in the nested Amove repository.

Preserve unrelated changes in every repository.

## Acceptance criteria

- `FeaturePaths` exposes only named resource maps and directory fields.
- `validateFeatureResources` has no scalar alias fallback.
- Amove has no `ctx.paths.preload` fallback.
- Every production suite and standalone feature context uses named maps.
- Scalar aliases do not satisfy named requirements, and renderers represented only by either scalar alias fail before a standalone window or appearance state is created.
- Valid suite and standalone feature surfaces retain their current behavior.
- Root and integrated-app type checks pass.
- Focused tests and the full root test suite pass.
- Amove's test suite passes.
- No unrelated standalone contract is renamed merely because it uses a similar field name.
- No new module, adapter, dependency, domain term, or ADR is introduced.

## Risks and controls

### Private-package compatibility

Risk: one of the supported consumers may still construct `FeaturePaths` with scalar fields in a source path missed by a narrow search.

Control: search the full non-generated tree, then type-check the root and all three integrated repositories. The package is private; callers outside this checked set are unsupported.

### Runtime JavaScript input

Risk: removing TypeScript fields alone may leave runtime alias objects silently accepted.

Control: remove validator fallbacks, cover all four aliases at the validation seam, and cover the renderer aliases through `acquireFeatureSurface` to prove rejection precedes side effects.

### Amove shelf startup

Risk: removing the fallback may reveal an incomplete Amove context.

Control: both suite and standalone context producers already provide `preloads.shelf`; run Amove type checks and feature tests after the change.

### Over-expansion

Risk: the nearby resource model invites broader changes to artifact resolution, feature-specific typing, or surface ownership.

Control: keep this implementation to one canonical resource representation. Record other architecture candidates separately rather than combining them with this change.

## Completion sequence

1. Narrow `FeaturePaths` and validator reads.
2. Remove Amove's final compatibility read.
3. Replace migration tests with rejection-before-side-effects coverage.
4. Convert stale runtime fixtures to named maps.
5. Run the static migration search.
6. Run focused tests.
7. Run root and linked-app type checks.
8. Run the full root and Amove test suites.
9. Inspect root and nested repository diffs for scope and unrelated changes.
