# Implementation plan: deepen the catalog-to-resource seam

## Status

This plan finalizes the recommended answer for architecture-review option 1: **Consolidate the catalog-to-resource seam**.

Implementation and final verification are complete through the catalog, resolver, runtime adapters, staging plan, packaging, tests, documentation, macOS staging/package/smoke checks, and diff checks. The verification findings below remain: unrelated Bonded test/typecheck failures and existing Shout product-suite failures. Work spans the root repository and the three independent integrated-product repositories without staging or committing unrelated pre-existing changes.

Current verification note: Amove's focused and full Vitest suites pass. The focused resolver, native-host, staging-plan, catalog, and suite-path checks pass, as does root typecheck. Bonded's full Vitest command still reports failures in pre-existing modified feature/native-feature tests, and its typecheck is blocked by the pre-existing modified Vitest assertion configuration. Shout's full Vitest command still reports five failures in existing audio/controller/native-feature tests with empty error messages; its standalone-context test and typecheck pass. These product-suite failures are retained as final verification findings and are outside the changed standalone-context path.

## Verified baseline

This inventory comes from the current source, not from the earlier plan. It is the baseline the implementation must preserve:

- `packages/desktop-shell/src/feature-catalog.ts` contains exactly three feature entries and five artifact records: Amove has `addon` and `assets`, Bonded has `helper`, and Shout has `helper` and `driver`. The records contain one `native`, one `assets`, two `executable`, and one `bundle` artifact. There are no current `worker` artifact records.
- The runtime artifact consumers are `src/main/features/suite-context.ts`, `apps/integrated/Amove/src/main/standalone.ts`, `apps/integrated/Bonded/src/main/standalone.ts`, `apps/integrated/Shout/src/main/standalone.ts`, and the two native-host arguments assembled in `src/main/index.ts` through `src/main/paths.ts`.
- The current suite context projects all five records. The three standalone contexts project the same five records, with Amove's `assets` path staying under its app root rather than `process.resourcesPath`.
- `scripts/stage-feature-binaries.mjs` has exactly five copy operations. `electron-builder.yml` has exactly five per-artifact feature entries, two for Amove, one for Bonded, and two for Shout.
- `tests/feature-artifacts.test.ts`, `tests/feature-paths.test.ts`, and `tests/feature-catalog.test.ts` cover the catalog and suite path seam. The focused baseline command passes 3 files and 32 tests. `tests/app-presence.test.ts` already asserts the native-host argument shape, including the Shout parent-directory argument. No standalone-context tests or staging-plan tests exist yet.
- The Swift host fallback in `native/moirasia-runtime/Sources/MoirasiaHost/main.swift`, `scripts/debug-host-trace.mjs`, `scripts/smoke-service.sh`, and `scripts/smoke-packaged-lifecycle.mjs` also mention the feature layout. They are separate tooling or native-host adapters, not additional TypeScript resolver consumers, and the plan below names their unchanged compatibility rules explicitly.

If this inventory changes before implementation, stop and refresh the matrices and totals instead of applying the checklist to a different catalog.

## Decision summary

The feature catalog already owns the important artifact facts, but those facts are not yet deep enough. Runtime hosts still repeat artifact lookup and environment branching, the root staging script repeats product-specific paths, and the root package configuration repeats every staged feature directory. The proposed change makes the catalog facts useful through one pure resource-resolution module and one build-time staging adapter.

The recommended decisions are settled as follows:

1. **Scope** — deepen artifact and resource resolution, staging, and suite packaging. Do not redesign feature lifecycle, native transport, product IPC, native build commands, or product-owned standalone packaging.
2. **Source of truth** — keep the existing feature catalog as the owner of feature identity and requirements. Extract only its artifact facet to `feature-artifact-data.json` so both TypeScript hosts and plain Node build scripts consume the same data without importing Electron code or executing TypeScript from a build script.
3. **Deep module** — add a pure `@moirasia/desktop-shell/feature-resources` module. It resolves all catalog-defined artifact paths for a feature and host source from a small set of roots. It does not inspect the filesystem, start builds, or know product controllers.
4. **Adapters** — the suite context, each product standalone context, the native-host path lookup, and the staging script remain thin adapters. The runtime suite and product standalone contexts are two runtime consumer categories of the seam; pure in-memory tests exercise the same interface.
5. **Packaging** — package the clean `native/staged/features` tree as one suite resource. Keep independent product `electron-builder.yml` files product-owned; the root catalog cannot safely import those repositories' build configurations.
6. **Semantics** — preserve every current development, packaged, standalone, suite, native-host, driver-directory, and Amove-asar path. Do not normalize paths merely to make the implementation look uniform.
7. **Failure behavior** — catalog or artifact-name mistakes fail closed with feature/artifact-specific errors. The resolver does not silently fall back. The existing native-host packaged-then-staged existence fallback remains in its host adapter because it is an intentional runtime lookup policy.
8. **Testing** — replace brittle path-string repetition tests with resolver and staging-plan tests at the new seam, then retain focused integration tests for suite context, standalone context, and packaging layout.

## Problem and deletion test

### Current friction

`packages/desktop-shell/src/feature-catalog.ts` contains the artifact facts:

- artifact kind and filename or native-addon base name;
- product build output location;
- suite staging destination;
- suite packaged destination;
- standalone packaged destination;
- development source preference.

Those facts are valuable, but callers still reconstruct the meaning of the table themselves:

- `src/main/features/suite-context.ts` finds artifacts by name, chooses packaged versus development roots, expands `{configuration}` and `{Configuration}`, and maps product ids to native resource keys;
- `apps/integrated/Amove/src/main/standalone.ts`, `Bonded/src/main/standalone.ts`, and `Shout/src/main/standalone.ts` each find artifacts and repeat packaged/development branches;
- `src/main/paths.ts` accepts a free-form relative path for native-host resources and uses a separate packaged-then-staged fallback;
- `src/main/index.ts` knows that Bonded needs the helper file while Shout needs the driver directory;
- `scripts/stage-feature-binaries.mjs` repeats every product build output, staged directory, filename, and copy operation;
- root `electron-builder.yml` repeats each staged feature directory;
- `tests/feature-artifacts.test.ts` keeps those independent strings aligned by reading source files and searching their text;
- `native/moirasia-runtime/Sources/MoirasiaHost/main.swift` has direct-launch defaults for the same two resources, `scripts/debug-host-trace.mjs` launches the host with staged paths, `scripts/smoke-service.sh` launches the service with the staged Bonded helper, and `scripts/smoke-packaged-lifecycle.mjs` checks the packaged argument prefixes. Leave these integration tools unchanged. Their current direct-launch and diagnostic path forms remain compatibility behavior, not catalog consumers.

The problem is not that the catalog lacks facts. The problem is that the interface to those facts is shallow: callers must know the artifact lookup, root selection, filename rules, placeholder expansion, and directory-versus-file distinction.

### Deletion test

Delete the proposed resource-resolution module and its staging plan. The artifact rules immediately reappear in the suite context, three standalone contexts, native-host lookup, and the staging script. That is concentrated complexity, not indirection. The seam earns its place because multiple runtime adapters and a build adapter already vary over the same artifact facts.

The deletion test does **not** justify moving native build commands, product-specific preload paths, renderer paths, legacy data directories, or Amove shelf policy into the catalog. Those facts remain local to their existing owners.

## Domain and architecture constraints

### Preserve

- `FeatureContext` and `FeaturePaths` remain the product-facing resource contract.
- The existing generic `workers` fields and `worker` artifact kind remain valid catalog and context vocabulary, but the current implementation adds no worker record, worker staging command, or worker-specific test case.
- `FeatureResourceRequirements` remains the catalog-owned requirement table.
- `FeatureRuntime` remains the lifecycle orchestrator. This plan does not split or redesign it.
- `FeatureSurfaceHost`, `EmbeddedFeatureHost`, and `ShellWindowLifecycle` remain separate. They own different renderer and window lifecycles.
- `NativeHostClient`, native authentication, framing, reconnect, timeout, revision filtering, and native host arguments remain unchanged in behavior.
- Swift sources, Swift package layouts, the native feature wire protocol, and product native build scripts remain unchanged.
- Local Bonded/Shout IPC, Amove's custom main/shelf IPC, controller validation, renderer bridges, runtime leases, and product state models remain unchanged.
- Independent Git repositories under `apps/integrated` remain independent. Root changes consume their linked package source, but the root catalog does not take ownership of their builder configuration.
- Amove assets remain inside the standalone app's asar path. They must not be redirected to `process.resourcesPath` merely because other artifacts use `extraResources`.
- The production Electron native-host driver argument remains the **driver parent directory**, not `ShoutMic.driver` itself. The direct-launch Swift/debug adapters pass the bundle path and retain that compatibility because `FeatureModules.resolveDriverSource` accepts both forms. The feature context always receives the bundle path.

### Do not expand

- Do not add artifact build commands to the feature catalog. The catalog describes facts and destinations; the staging script owns which existing product commands to run.
- Do not make `electron-builder.yml` dynamically execute TypeScript or import a package. Keep it declarative.
- Do not make the resolver check file existence. Resource validation and filesystem readiness are separate concerns; the existing host adapters decide when an existence fallback is appropriate.
- Do not introduce a generated manifest for all feature metadata. Extract only the artifact facet required by the plain Node staging adapter.
- Do not replace every text contract test with an end-to-end package build. Keep the build test surface fast and deterministic, then run the real build commands as final verification.
- Do not add a worker manifest, worker staging command, or worker-specific resolver abstraction for a worker that does not exist in the current catalog.
- Do not change the public feature catalog facts or resource layout as part of this refactor.

## Settled grilling decisions

### Q1 — How broad should the deepening be?

**Recommended answer:** include runtime artifact resolution, native-host artifact lookup, generic suite staging, and root suite packaging. Leave independent product builder files and product build commands as explicit adapters.

This captures the repeated facts that the root repository controls while respecting repository ownership. It also avoids turning the catalog into a build orchestrator.

### Q2 — Where should the seam live?

**Recommended answer:** add `packages/desktop-shell/src/feature-resources.ts` as a pure package module and export it through `@moirasia/desktop-shell/feature-resources`.

The module uses the catalog and standard path joining only. It does not import Electron, filesystem APIs, product contracts, or root application modules. Suite code and product main code can use it without making the catalog renderer-incompatible.

Use these exact exports and source discriminants:

```ts
export type FeatureResourceSource =
  | { readonly kind: 'suite-development'; readonly suiteRoot: string }
  | { readonly kind: 'suite-staged'; readonly suiteRoot: string }
  | { readonly kind: 'suite-packaged'; readonly resourcesRoot: string }
  | { readonly kind: 'standalone-development'; readonly productRoot: string }
  | { readonly kind: 'standalone-packaged'; readonly appRoot: string; readonly resourcesRoot: string }

export interface ResolvedFeatureResources {
  readonly native: Readonly<Record<string, string>>
  readonly workers: Readonly<Record<string, string>>
  readonly assetsDirectory?: string
}

export function resolveFeatureResources(id: FeatureId, source: FeatureResourceSource): ResolvedFeatureResources
export function resolveFeatureArtifact(id: FeatureId, artifactName: string, source: FeatureResourceSource): string
```

`'suite-development'` uses each artifact's `suiteDevSource`: `buildOutput` is rooted at `suiteRoot/apps/integrated/<directory>`, and `staged` is rooted at `suiteRoot`. `'suite-staged'` always uses the catalog's `staged` destination and exists only for the native-host fallback. The standalone source kinds use the product root or the two packaged roots described in the matrix below. Development resolution always expands `{configuration}` to `debug` and `{Configuration}` to `Debug`.

The resolver must reject an unknown feature, unknown artifact, invalid source kind, or missing/non-absolute required root with an error that names the feature, artifact when known, source kind, and root role. It must not expose catalog mutation, filesystem checks, build execution, or product-specific resource keys.

### Q3 — What is the canonical data source?

**Recommended answer:** add `packages/desktop-shell/src/feature-artifact-data.json` containing the current artifact records keyed by feature id. `feature-catalog.ts` imports that data and continues to validate, freeze, and expose it as `FeatureArtifact` values. The Node staging plan reads the same JSON directly.

This avoids a second artifact manifest and avoids requiring a plain `.mjs` build script to import TypeScript. The JSON is only the artifact facet; labels, groups, window facts, requirements, and product descriptions remain in the typed catalog module.

The current `buildCatalog` checks duplicate names, required destinations, asset filename rules, native base-name rules, and requirement references. It does not yet perform runtime checks for the JSON object shape, feature-id keys, artifact-kind enum values, empty `buildOutput`, invalid `suiteDevSource`, non-filename `file` values, or path traversal. Add those checks before consuming the JSON, with feature/artifact-specific errors, and add mutation tests for each rejected class. Keep these checks renderer-safe without importing `node:path`. The Node staging plan must repeat the artifact-facet checks it needs at its JSON input seam because it cannot rely on TypeScript's static type or on `buildCatalog`; it must reject malformed records before it returns any copy record. Both consumers still read one JSON file, not separate manifests.

### Q4 — Which source matrix must be preserved?

**Recommended answer:** model the source explicitly rather than inferring it from a generic root. The matrix has one row per current artifact, including Amove's standalone assets.

| Consumer and artifact | Development source | Packaged source | Special rule |
| --- | --- | --- | --- |
| Suite Amove `addon` | `apps/integrated/Amove/native/<nativeAddonFileName>` | `Resources/features/amove/native/<nativeAddonFileName>` | native addon filename follows the catalog platform/architecture rule |
| Suite Amove `assets` | `apps/integrated/Amove/assets` | `Resources/features/amove/assets` | directory; suite context receives the directory |
| Suite Bonded `helper` | `apps/integrated/Bonded/native/.build/arm64-apple-macosx/debug/BondedFirewallHelper` | `Resources/features/bonded/native/BondedFirewallHelper` | exact executable file |
| Suite Shout `helper` | `apps/integrated/Shout/native/.build/out/Products/Debug/ShoutAudioHelper` | `Resources/features/shout/native/ShoutAudioHelper` | exact executable file |
| Suite Shout `driver` | `native/staged/features/shout/driver/ShoutMic.driver` | `Resources/features/shout/driver/ShoutMic.driver` | suite feature context receives the bundle path |
| Standalone Amove `addon` | `Amove/native/<nativeAddonFileName>` | `Resources/native/<nativeAddonFileName>` | native resource; development and packaged roots differ |
| Standalone Amove `assets` | `Amove/assets` | `<appRoot>/assets` inside the asar app path | directory; never redirect this artifact to `process.resourcesPath` |
| Standalone Bonded `helper` | `Bonded/native/.build/arm64-apple-macosx/debug/BondedFirewallHelper` | `Resources/native/BondedFirewallHelper` | exact executable file |
| Standalone Shout `helper` | `Shout/native/.build/out/Products/Debug/ShoutAudioHelper` | `Resources/native/ShoutAudioHelper` | exact executable file |
| Standalone Shout `driver` | `Shout/native/driver/dist/ShoutMic.driver` | `Resources/native/ShoutMic.driver` | exact bundle path |

This is the complete ten-row matrix: five suite projections and five standalone projections for the current five artifact records. The native-host lookup below is a separate two-row matrix, not an additional artifact count.

The resolver must expand `{configuration}` to `debug` or `release` and `{Configuration}` to `Debug` or `Release` according to the consumer. Runtime development uses the lower-case/upper-case debug values shown above. Release staging uses the release values shown in the staging section. There is no other current configuration spelling.

The native-host launch matrix is separate from the feature-context matrix:

| Native-host value | Packaged candidate | Development candidate | Projection |
| --- | --- | --- | --- |
| Bonded helper | `Resources/features/bonded/native/BondedFirewallHelper` | `native/staged/features/bonded/native/BondedFirewallHelper` | exact file |
| Shout driver argument assembled by Electron | `Resources/features/shout/driver` | `native/staged/features/shout/driver` | parent directory containing `ShoutMic.driver` |

`src/main/paths.ts` keeps the packaged-first `existsSync` policy for these two candidates, checking the exact file for Bonded and the projected parent directory for Shout. The resolver never performs that check. The Swift host's direct-launch default in `MoirasiaHost/main.swift` and `scripts/debug-host-trace.mjs` passes the Shout bundle path itself; `FeatureModules.resolveDriverSource` accepts both a parent directory and a bundle path. The production Electron `AppPresence` argument remains the parent directory, and `tests/app-presence.test.ts` must continue to assert that distinction.

### Q5 — How should packaging avoid stale files?

**Recommended answer:** the staging command owns a clean `native/staged/features` tree. Before copying, it removes and recreates only that feature staging directory. It then copies exactly the catalog-described artifacts. Root `electron-builder.yml` packages that tree as `features`.

The cleanup must not remove `native/staged/runtime`, `native/staged/application-agent`, or the smoke output files directly under `native/staged`. It removes stale records from the previous staged feature tree, but it does not prune files inside a current product source directory; complete directory copies intentionally preserve the source directory contents. The staging plan must expose its exact source and destination records so tests can assert that no unexpected feature record is packaged.

### Q6 — What should tests replace?

**Recommended answer:** tests cross the new resolver and staging-plan interfaces. Remove only assertions that inspect implementation text or duplicate the same path table. Keep integration tests that prove `FeatureContext` receives the right maps and that the builder still packages the expected top-level feature tree.

The interface is the test surface. Tests must not reach into private path-branch helpers after the seam exists.

## Target architecture

```text
feature-artifact-data.json
          │
          ▼
feature-catalog.ts ── validates/freezes ──► featureCatalog
          │                                      │
          │                                      ▼
          └──────────────────────────────► feature-resources.ts
                                                │
             ┌──────────────────────────────────┼─────────────────────────┐
             ▼                                  ▼                         ▼
      suiteFeatureContext              product standalone          native-host path
             │                                  │                         │
             └─────────────── FeaturePaths ─────┴─────────────── host args ┘

feature-artifact-data.json ─► feature-staging-plan.mjs ─► stage-feature-binaries.mjs
                                                               │
                                                               ▼
                                                    native/staged/features
                                                               │
                                                               ▼
                                                   electron-builder.yml
```

### Deep module: `feature-resources.ts`

The module must provide the exact pure interface defined in Q2. It uses `node:path` for host-side path joining and imports no Electron, filesystem, product contract, or root application module. Do not re-export it through renderer-oriented `feature.ts`; main-process consumers import `@moirasia/desktop-shell/feature-resources` directly.

The implementation must satisfy these facts:

- `id` and `artifactName` are catalog facts, not arbitrary path strings;
- source kind determines which catalog destination is used. `suite-development` selects `buildOutput` or `staged` from `suiteDevSource`, while `suite-staged` always selects `staged`;
- native addons use `nativeAddonFileName` and exact-file artifacts append their filename;
- `worker` artifacts use their exact filename in the `workers` map if one is added later; the current catalog has none, so current resolver outputs keep that map empty;
- `assets` artifacts return directories;
- `bundle` artifacts return the bundle path at runtime. Their staging copy is a directory copy of the complete `buildOutput` directory, as specified in the staging section;
- standalone Amove assets resolve under `appRoot`, including packaged asar builds;
- output maps use catalog artifact names (`addon`, `helper`, `driver`, `assets`) so existing `FeaturePaths` keys do not change;
- no filesystem call or Electron global is required;
- errors identify the feature, artifact, source kind, and missing root role without serializing catalog objects or filesystem payloads.

The native-host adapter does not get a second generic projection interface. It resolves the Shout `driver` bundle through `resolveFeatureArtifact`, then calls `dirname` in `src/main/paths.ts` when it constructs the parent-directory argument. The feature context continues to receive the bundle path.

### Canonical artifact data

Move the three current `artifacts` arrays from `FEATURE_SEEDS` into `feature-artifact-data.json` without changing values:

- Amove `addon` and `assets`;
- Bonded `helper`;
- Shout `helper` and `driver`.

Keep the existing artifact fields:

- `name`;
- `kind`;
- optional `file`;
- `buildOutput`;
- `staged`;
- `suiteResource`;
- `suiteDevSource`;
- `standaloneResource`.

`feature-catalog.ts` must import the data, attach each feature's artifact array to its seed, and let `buildCatalog` perform the existing checks plus the new JSON-input checks for supported kinds, non-empty names and build outputs, relative destinations, and the two supported configuration placeholders. It continues to freeze and expose the catalog. Existing catalog consumers continue importing `featureCatalog` from `@moirasia/desktop-shell/feature`.

Add the new package export:

```json
"./feature-resources": "./src/feature-resources.ts"
```

Do not re-export the resolver through renderer-oriented modules. Product main modules import the explicit `@moirasia/desktop-shell/feature-resources` subpath.

## File-by-file implementation sequence

### Phase 0 — establish the clean implementation point

1. Confirm `plan.md` is the only root plan input and that it has been replaced by this plan before source edits.
2. Record root and nested repository statuses. Preserve any pre-existing dirty files, especially unrelated Bonded work.
3. Confirm the current path matrix from `tests/feature-paths.test.ts`, the three standalone contexts, `src/main/paths.ts`, and the current builder configurations.
4. Do not change Swift, native host contracts, `NativeHostClient`, `FeatureRuntime`, local/custom IPC, or product native build scripts. The Swift host defaults and manual smoke/debug scripts remain explicit integration adapters; preserve their current direct-launch compatibility while changing only the Electron-side typed lookup.

### Phase 1 — extract the artifact facet and add the pure resource module

1. Add `packages/desktop-shell/src/feature-artifact-data.json` with the existing artifact facts.
2. Update `packages/desktop-shell/src/feature-catalog.ts` to consume the data while retaining all existing catalog validation and freezing behavior.
3. Add `packages/desktop-shell/src/feature-resources.ts`.
4. Implement source-specific resolution for:
   - suite development, selecting each artifact's build output or staged destination from `suiteDevSource`;
   - explicit suite-staged lookup for the native-host fallback;
   - suite packaged resources;
   - standalone development build output;
   - standalone packaged resources, with Amove assets rooted at `appRoot` and its addon rooted at `resourcesRoot`;
   - the existing native addon, exact-file, asset-directory, and bundle-path projections.
5. Keep path joining platform-safe and preserve native addon filename rules.
6. Add the package export in `packages/desktop-shell/package.json`.
7. Do not change `FeaturePaths`, `FeatureContext`, `FeatureResourceRequirements`, or `FeatureSurfaceHandle`.

### Phase 2 — migrate suite runtime consumers

#### `src/main/features/suite-context.ts`

1. Replace the local `artifact()` finder and local `resource()` branch with `resolveFeatureResources`. Remove the suite context's artifact/catalog lookup imports and local app-root construction. Pass `{ kind: 'suite-development', suiteRoot: app.getAppPath() }` in development and `{ kind: 'suite-packaged', resourcesRoot: process.resourcesPath }` when packaged.
2. Keep the product switch only for product-owned facts:
   - Amove shelf preload/renderer, data directories, and legacy data directory;
   - Bonded data directory and legacy data directory;
   - Shout data directory and legacy data directory.
3. Merge resolver output into the existing `paths.native` and `assetsDirectory` fields without changing resource keys. The resolver still returns the existing empty `workers` map for future worker artifacts, but current contexts omit that empty optional field to preserve their existing `FeaturePaths` shapes. The Amove `assetsDirectory` comes from the resolver; only Amove's shelf preload/renderer, data directories, and legacy data policy remain in the product switch. The resolver's catalog/source validation runs before the context is returned; filesystem existence remains the feature validation adapter's responsibility.
4. Preserve the current `ELECTRON_RENDERER_URL` behavior for Amove's shelf renderer.
5. Keep `suiteFeatureContext` as the host adapter that supplies Electron roots and a surface; it must not become a second resolver.

#### `src/main/paths.ts` and `src/main/index.ts`

1. Replace the free-form `moirasiaFeatureResourcePath(relative)` calls used for native-host launch arguments with typed feature/artifact lookup through the resolver. `src/main/paths.ts` must export `moirasiaNativeFeaturePaths(resourcesPath = process.resourcesPath, suiteRoot = join(mainDirectory, '../..'))`, returning `{ bondedHelperPath, shoutDriverPath }`. For Shout, resolve the bundle path, apply `dirname` to both packaged and staged candidates before calling `existsSync`, and return the selected parent directory. This preserves the current policy, which checks `Resources/features/shout/driver` rather than requiring the bundle itself to exist.
2. Preserve packaged-then-staged existence fallback for the native host:
   - packaged Bonded helper file when present, otherwise staged helper file;
   - packaged Shout driver parent directory when present, otherwise staged driver parent directory.
3. Keep `applicationAgentPath`, `moirasiaHostPath`, `moirasiaFeatureServicePath`, and socket-path behavior unchanged.
4. Keep `src/main/index.ts`'s `AppPresence` argument names and native host startup order unchanged. Pass the two fields from `moirasiaNativeFeaturePaths` without changing `AppPresence` or the Swift host contract.
5. Add `tests/native-feature-paths.test.ts`. Create temporary packaged/staged roots, test both fallback branches for the Bonded file and Shout directory, and assert that `moirasiaNativeFeaturePaths(...).shoutDriverPath` is the directory containing `ShoutMic.driver`. Include the fallback edge case where the packaged Shout parent directory exists but the bundle does not; the adapter must still select the packaged parent because that is the current existence check.
6. Leave `native/moirasia-runtime/Sources/MoirasiaHost/main.swift`, `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureModules.swift`, `scripts/debug-host-trace.mjs`, `scripts/smoke-service.sh`, and `scripts/smoke-packaged-lifecycle.mjs` unchanged. Their direct-launch or diagnostic path forms are covered by the compatibility note in the source matrix and by the unchanged package-layout smoke check.

### Phase 3 — migrate product standalone contexts

#### Amove

Update `apps/integrated/Amove/src/main/standalone.ts` to use the resolver for the addon and assets. Preserve:

- the exact `appRoot = app.isPackaged ? app.getAppPath() : join(import.meta.dirname, '../..')` behavior, passed as `productRoot` in standalone development and as `appRoot` alongside `resourcesRoot: process.resourcesPath` in standalone packaged mode;
- addon development output under `native`;
- packaged addon under the standalone native resource root;
- the resolver's runtime platform/architecture selection for Amove remains `nativeAddonFileName`'s existing Darwin, win32, and linux behavior. The fixed Darwin arm64 target applies only to the root suite staging command, not to Amove's standalone Windows/Linux packaging;
- assets under `appRoot/assets` in both development and packaged asar execution;
- preload and renderer URL behavior;
- data directory behavior.

Do not route the Amove shelf or local IPC through this module.

#### Bonded

Update `apps/integrated/Bonded/src/main/standalone.ts` to resolve the `helper` artifact through the resolver. Pass `productRoot: app.getAppPath()` in development and `{ appRoot: app.getAppPath(), resourcesRoot: process.resourcesPath }` in packaged mode. Preserve:

- development debug output expansion;
- packaged `Resources/native/BondedFirewallHelper`;
- existing preload, renderer, and user-data paths.

Do not touch Bonded's controller, local IPC, or standalone feature policy.

#### Shout

Update `apps/integrated/Shout/src/main/standalone.ts` to resolve `helper` and `driver` through the resolver. Pass `productRoot: app.getAppPath()` in development and `{ appRoot: app.getAppPath(), resourcesRoot: process.resourcesPath }` in packaged mode. Preserve:

- development helper configuration expansion;
- development driver bundle path;
- packaged helper and driver under `Resources/native`;
- renderer URL and user-data paths.

Do not confuse the standalone feature context's driver bundle path with the native host's parent-directory argument.

### Phase 4 — make staging consume the same artifact facts

#### `scripts/feature-staging-plan.mjs`

Add a plain Node build adapter that reads `feature-artifact-data.json` and produces a deterministic staging plan. Export exactly `loadFeatureArtifactData()` and `buildFeatureStagingPlan(options, artifactData)`. The production script calls `loadFeatureArtifactData()` and passes the result to `buildFeatureStagingPlan`; tests pass a replacement data object to exercise malformed records. Neither function runs native builds, reads Electron state, or checks source existence.

`buildFeatureStagingPlan` accepts this complete options object:

```js
{
  repoRoot,
  productRoots: {
    amove: join(repoRoot, 'apps/integrated/Amove'),
    bonded: join(repoRoot, 'apps/integrated/Bonded'),
    shout: join(repoRoot, 'apps/integrated/Shout')
  },
  platform: 'darwin',
  arch: 'arm64',
  configuration: 'release'
}
```

The production stage command derives an absolute `repoRoot` from the staging script location, supplies absolute product roots, and always supplies `platform: 'darwin'`, `arch: 'arm64'`, and `configuration: 'release'`. The Amove build command is hard-coded to produce the arm64 Darwin addon and the root builder targets arm64, so the staging adapter must not derive this target from the host's `process.arch`. The non-Darwin early exit remains in `stage-feature-binaries.mjs` before any product command runs.

Each plan record has this shape:

```js
{
  featureId,
  artifactName,
  kind,
  mode: 'file' | 'directory',
  sourcePath,
  destinationPath,
  expectedPath
}
```

`sourcePath` and `destinationPath` are the exact copy operands. `expectedPath` is the source path that must exist before copying. For a file record, it equals `sourcePath`; for a directory record, it is the directory itself unless the artifact is a `bundle`, in which case it is `join(sourcePath, file)`.

The plan builder must:

- expand `{configuration}` to `release` and `{Configuration}` to `Release` for release staging;
- apply the native addon suffix rule to `native` artifacts using the explicit `platform` and `arch` options;
- create `file` records for the current exact-file artifacts—Amove's addon, Bonded's helper, and Shout's helper—with the exact filename in both copy operands. The same file mode handles a future worker record without adding a worker-specific staging abstraction;
- create `directory` records for Amove's assets and Shout's driver. The Amove source is `Amove/assets` and the Shout source is `Shout/native/driver/dist`; both copy the complete source directory to the catalog's staged directory. The Shout record's `expectedPath` is `Shout/native/driver/dist/ShoutMic.driver`;
- preserve the current five records, their product roots, release paths, and staged destinations without adding a record for a hypothetical worker;
- reject missing or unknown feature data, non-absolute `repoRoot` or product roots, missing product roots, unsupported `configuration` values, duplicate artifact names, empty or unsupported fields, unsupported kinds, invalid `suiteDevSource`, an assets filename, a missing non-assets filename, unresolved configuration placeholders, absolute or traversal source/file paths, and any destination outside `repoRoot/native/staged/features/<featureId>`;
- return records in catalog-data order and never inspect the filesystem.

The Node adapter cannot import the TypeScript catalog at runtime. `loadFeatureArtifactData()` resolves the JSON relative to its own module URL, not the caller's working directory. Keep one small local implementation of the existing `nativeAddonFileName` suffix rule in this build-only module, with no second artifact table, and test its Darwin arm64 output against the explicit catalog helper result `nativeAddonFileName('amove-native', 'darwin', 'arm64')`, not the test process's platform. Export the pure plan builder so tests can exercise it with temporary-looking roots without running Swift or Electron.

#### `scripts/stage-feature-binaries.mjs`

1. Keep the current product commands and ordering exactly, including Amove's conditional dependency install:
   - run `pnpm install --frozen-lockfile --ignore-workspace --ignore-scripts` in Amove only when `apps/integrated/Amove/node_modules/.bin/napi` is absent;
   - Amove `native:mac`;
   - Bonded `native:release`;
   - Shout `native:release` and `native:driver:release`.
2. Keep the current product repository roots and command ordering, using the absolute roots in the plan options for build output, cleanup, and copy paths.
3. Delete only the repeated artifact path and copy statements.
4. Load the JSON and build the complete five-record plan after native builds complete. Validate every record's `expectedPath`, and validate all source paths before deleting any old staging tree. A missing source stops the command without a partial new copy.
5. Remove and recreate only `native/staged/features`, never `native/staged/runtime`, `native/staged/application-agent`, or the smoke output files directly under `native/staged`.
6. Create each file-record destination parent, execute file records with `copyFileSync`, and execute directory records with `cpSync(..., { recursive: true })`. The bundle record copies `Shout/native/driver/dist` to `native/staged/features/shout/driver`, preserving the `ShoutMic.driver` directory name inside the destination.
7. Fail with feature/artifact/source/destination context when a source is missing or a copy fails.
8. Leave native build output in the product repositories; only the feature staging tree is cleaned.
9. Leave `scripts/debug-host-trace.mjs`, `scripts/smoke-service.sh`, and `scripts/smoke-packaged-lifecycle.mjs` unchanged. Their literals remain intentional diagnostic/package-layout checks and are included in the static-cleanup allowlist.

### Phase 5 — simplify root suite packaging

Update root `electron-builder.yml`:

```yaml
extraResources:
  - from: native/staged/features
    to: features
```

Keep all non-feature resources unchanged. The generic feature entry must package the exact clean tree produced by `features:stage` as `Contents/Resources/features/<id>/...`.

Do not rewrite the independent product `electron-builder.yml` files in this phase. Their native resource layouts are product-owned and remain contract adapters. `tests/feature-artifacts.test.ts` continues to read those three configurations and assert their existing destinations; no root builder import of a product configuration is added.

### Phase 6 — replace shallow tests with seam tests

#### New root resolver tests

Add `tests/feature-resources.test.ts` covering:

1. suite development build-output artifacts;
2. suite development staged artifacts, specifically the Shout driver;
3. explicit suite-staged lookup used by the native-host adapter;
4. suite packaged artifacts;
5. standalone development artifacts;
6. standalone packaged artifacts;
7. Amove addon filename and asar asset directory behavior;
8. Bonded executable file behavior;
9. Shout helper file and driver bundle behavior;
10. configuration placeholder expansion in both casing forms;
11. the catalog `nativeAddonFileName` matrix for Darwin arm64/x64 and the existing win32/linux arch-independent cases;
12. unknown feature and artifact errors;
13. missing and non-absolute root errors;
14. stable output maps keyed by the existing artifact names.

Use temporary-looking absolute roots such as `/workspace`, `/Applications/Moirasia.app/Contents/Resources`, and `/app`. Assert returned paths, not private helper calls. Verify the module imports only the catalog and path utilities, not Electron or filesystem APIs, by keeping that import seam in the source review rather than adding a brittle runtime mock test.

#### Staging-plan tests

Add `scripts/feature-staging-plan.test.mjs`. The root `vitest.config.ts` already includes `scripts/**/*.test.mjs`, so do not widen the include pattern or add another test runner. Cover:

- all five catalog artifacts produce exactly one copy record;
- Amove addon, Bonded helper, and Shout helper are file copies;
- Amove assets and Shout driver are complete directory copies;
- the Shout directory record copies `native/driver/dist` and preserves `ShoutMic.driver` inside the staged destination;
- staged destinations stay under `native/staged/features/<id>`;
- release source paths match the current product build outputs, including the fixed Darwin arm64 addon name;
- the native addon name is derived from the explicit requested platform and architecture, not `process.arch`;
- a malformed artifact record fails before the copy adapter runs;
- a plan contains no record for stale artifacts. The macOS staging verification seeds a sentinel under `native/staged/features`, runs the real stage command through `pnpm package:mac`, and asserts that the sentinel disappears while `native/staged/runtime` and `native/staged/application-agent` remain.

#### Existing root tests

Rewrite `tests/feature-artifacts.test.ts` to keep high-value catalog invariants and staging/package contract assertions while deleting text-based implementation pinning that merely searches for repeated literal paths. Keep checks that:

- all requirements resolve to catalog artifacts of the correct kind;
- the root builder maps the clean staged feature tree to `features`;
- independent product builder configurations still contain their intended product resource destinations where repository ownership requires that contract. The staging-plan test owns the complete five-artifact plan coverage.

Update `tests/feature-paths.test.ts` to test `suiteFeatureContext` as an adapter over the resolver. Keep exact expected paths for the suite development and packaged matrix, including Amove assets, Bonded helper, Shout helper, and Shout bundle.

Add `tests/native-feature-paths.test.ts` for the packaged/staged native-host lookup and the Shout parent-directory projection. Keep `tests/app-presence.test.ts`'s existing exact spawn assertion unchanged, because it already pins the argument names and parent-directory value passed to `AppPresence`.

Keep `tests/feature-contract.test.ts`, `tests/feature-catalog.test.ts`, feature-surface tests, and shell lifecycle tests. Change them only when the new package export or artifact data source requires an import update. Add catalog mutation cases for every new JSON-input validation rule, and retain the existing worker-resource contract test without adding a worker artifact.

#### Product context tests

In each independent product repository, add focused main-side tests for its standalone context:

- `apps/integrated/Amove/tests/standalone-context.test.ts`;
- `apps/integrated/Bonded/tests/standalone-context.test.ts`;
- `apps/integrated/Shout/tests/standalone-context.test.ts`.

Mock Electron app state and `@moirasia/desktop-shell/feature-resources`, assert that each context calls the shared resolver with the exact standalone source roots, and preserve product-specific preload, renderer, data, asset, helper, addon, and driver paths. These tests do not build native artifacts.

### Phase 7 — documentation and ownership cleanup

Update `CONTEXT.md` with one concise glossary clarification:

- the feature catalog owns artifact facts;
- the feature resource resolver turns those facts into host paths;
- suite and standalone contexts remain host adapters;
- the staging script owns build execution and copies only catalog-described feature artifacts.

Update `docs/architecture/standalone-applications.md` in the embedded-features section to describe:

- the catalog artifact facet as the source of shared feature resource facts;
- the pure resolver as the common runtime path module;
- the root staging/build adapter and clean feature tree;
- independent product packaging ownership;
- the preserved distinction between Amove asar assets and native resources;
- the preserved production Electron Shout driver parent-directory argument for native host startup, plus the unchanged direct-launch Swift/debug acceptance of a bundle path.

Do not add a new ADR. No existing ADR files are present, and this plan preserves the documented catalog, host-mode, and product repository ownership decisions.

## Detailed behavior contract

### Resolver inputs

- A valid `FeatureId`.
- One of the five `FeatureResourceSource` variants: suite development, explicit suite-staged, suite packaged, standalone development, or standalone packaged.
- The absolute root(s) required by that source. The resolver rejects a missing or non-absolute root with the source root role in the error.
- For standalone packaged Amove, both the app root and resource root are meaningful because assets are asar-embedded while the addon is a native resource.

### Resolver outputs

- `native` entries keyed by artifact name for native addons, executables, and bundles.
- `workers` contains exact-file worker artifacts when present and is an empty map for the current catalog because no worker record exists. No worker artifact is added by this change.
- `assetsDirectory` when the feature has an asset artifact.
- No preload, renderer, data, or legacy-data values. Those remain host/product facts outside the artifact resolver.

### Resolver errors

- Unknown feature: identify the feature id.
- Unknown artifact: identify the feature id and requested artifact name.
- Invalid source kind or missing/non-absolute root: identify the source kind and required root role.
- No raw filesystem payloads or serialized catalog object must appear in an error message.

### Staging plan behavior

- The four native build commands and the conditional Amove dependency install run before plan execution.
- The plan is deterministic for a given artifact data file, product roots, explicit `darwin`/`arm64` target, and `release` configuration.
- Every destination is namespaced under `native/staged/features/<id>`.
- The adapter validates every source before it removes the old feature staging tree. A missing source stops staging with no partial new copy.
- The script removes only the old feature staging tree before copying.
- A directory record copies its complete source directory as a directory. A file record copies its exact file. The Shout bundle record copies `native/driver/dist` so the destination contains `ShoutMic.driver` once.
- The non-Darwin early exit remains before any build command.
- No stale top-level feature artifact from a previous feature set remains after a successful staging run; files present inside a current source directory are copied because directory artifacts are intentionally complete copies.

### Packaging behavior

- Root packaging includes `native/staged/features` at `Contents/Resources/features`.
- Runtime suite resolution uses the same catalog destinations as packaging.
- Standalone product packaging remains owned by the product repositories and continues to use their existing `Resources/native` and asar layouts.
- The root builder packages only the staged feature tree for suite feature artifacts. Independent product builders continue to package their own product-owned native outputs.

## Dependency and seam classification

- The resolver is **in-process**: pure data plus path construction. Its direct tests use no adapter or mock; context-adapter tests mock the resolver at the product seam.
- The suite context and standalone contexts are runtime **adapters** over the resolver. They supply Electron/product roots and assemble `FeatureContext`.
- The staging plan is a build-time adapter over the same artifact data. It supplies product build roots and copies artifacts.
- Filesystem existence checks remain in the host/build adapters, not inside the pure module.
- Two runtime consumer categories justify the seam: the suite host and the three standalone product hosts. The staging adapter adds a separate build-time consumer.

## Migration and rollback strategy

1. Land artifact data extraction, resolver, and tests without changing path outputs. Retain `nativeAddonFileName` and `artifactPath` as low-level catalog helpers for the resolver and their existing public subpath compatibility; remove only their duplicated caller-side source selection.
2. Migrate suite context and native-host lookup; run root tests and typecheck.
3. Migrate standalone contexts in the three independent repositories; run each product's focused tests and typecheck.
4. Migrate staging and root packaging; run staging-plan tests before any native build.
5. Run full suites, the macOS package build (which includes the root package build), and the packaged lifecycle smoke script.
6. Only after all path matrices pass, remove the old artifact finders, free-form feature resource lookup, repeated staging copy statements, and obsolete text-pinning assertions. Retain `nativeAddonFileName` and `artifactPath` as the low-level catalog helpers used by the resolver and existing package compatibility.

Rollback is straightforward because the resource layout and `FeatureContext` contract remain unchanged: revert the context adapters and restore the explicit staging/package entries while leaving the catalog data extraction isolated. Do not roll back by changing native or product IPC code.

## Verification plan

### Narrow checks

```bash
pnpm exec vitest run tests/feature-resources.test.ts tests/feature-artifacts.test.ts tests/feature-paths.test.ts tests/native-feature-paths.test.ts
pnpm exec vitest run scripts/feature-staging-plan.test.mjs
pnpm -C apps/integrated/Amove exec vitest run tests/standalone-context.test.ts
pnpm -C apps/integrated/Bonded exec vitest run tests/standalone-context.test.ts
pnpm -C apps/integrated/Shout exec vitest run tests/standalone-context.test.ts
```

### Type checks

```bash
pnpm typecheck
pnpm -C apps/integrated/Amove typecheck
pnpm -C apps/integrated/Bonded typecheck
pnpm -C apps/integrated/Shout typecheck
```

### Runtime and product suites

```bash
pnpm test
pnpm -C apps/integrated/Amove test
pnpm -C apps/integrated/Amove test:rust
pnpm -C apps/integrated/Bonded test
pnpm -C apps/integrated/Shout test
```

Bonded and Shout full scripts must continue to include their Swift tests. Shout's driver build must continue to run. These native checks are not replaced by resolver tests.

### Staging and builds

On the supported macOS build environment, run the standalone renderer builds, the complete root build, the actual macOS package, and the existing packaged lifecycle smoke test:

```bash
pnpm -C apps/integrated/Amove build:app
pnpm -C apps/integrated/Bonded build:renderer
pnpm -C apps/integrated/Shout build:renderer
mkdir -p native/staged/features/__stale-check
touch native/staged/features/__stale-check/sentinel
pnpm package:mac
test ! -e native/staged/features/__stale-check/sentinel
test -e native/staged/runtime/MoirasiaHost.app
test -e native/staged/application-agent
node scripts/smoke-packaged-lifecycle.mjs
```

`pnpm package:mac` runs the existing agent build, runtime build, feature staging, root app build, and macOS packaging. `pnpm build:app` alone does not produce a packaged suite bundle. Inspect the resulting `release/mac-arm64/Moirasia.app` at these exact paths:

- `Contents/Resources/features/amove/native/amove-native.darwin-arm64.node`;
- `Contents/Resources/features/amove/assets/...`;
- `Contents/Resources/features/bonded/native/BondedFirewallHelper`;
- `Contents/Resources/features/shout/native/ShoutAudioHelper`;
- `Contents/Resources/features/shout/driver/ShoutMic.driver/...`.

### Static cleanup checks

```bash
rg -n "artifacts\.find|buildOutput\.replace" \
  src/main apps/integrated scripts/stage-feature-binaries.mjs
rg -n "native/staged/features/(amove|bonded|shout)|Resources/features/(amove|bonded|shout)" \
  src/main apps/integrated packages/desktop-shell/src/feature-artifact-data.json \
  scripts/feature-staging-plan.mjs scripts/stage-feature-binaries.mjs electron-builder.yml \
  --glob '!**/README.md'
```

The first command must produce no runtime-context matches. The second command is allowed to produce only the JSON-backed staging/package adapters, the typed native-host adapter and its path-contract tests, unchanged diagnostic/smoke scripts, and intentional product builder adapters. Documentation and independent product README contracts are excluded from this code check. There must be no per-feature `extraResources` entries in the root builder.

Also verify:

- no Swift files changed;
- no `NativeHostClient` or native-host contract changes;
- no `FeatureRuntime` lifecycle changes;
- no local/custom IPC changes;
- `git diff --check` passes in root and all three nested repositories;
- independent repository statuses contain only intended implementation files and preserved pre-existing changes.

## Acceptance criteria

The plan is complete when:

- `feature-artifact-data.json` is the single artifact-fact source consumed by the catalog and staging plan;
- the feature catalog still validates and freezes those facts;
- `@moirasia/desktop-shell/feature-resources` exposes the only common runtime resource-selection implementation; retained `artifactPath` is only its low-level catalog filename formatter;
- suite context, native-host lookup, and all three standalone contexts no longer repeat artifact lookup and source branching;
- the exact suite/standalone path matrix is unchanged;
- Amove assets remain asar-embedded in standalone builds;
- Shout's feature context receives the driver bundle while the production Electron native host receives its parent directory; the unchanged direct-launch Swift/debug adapters pass the bundle path because the native feature service accepts both forms;
- staging executes the same existing product build commands but copies from a catalog-derived deterministic plan;
- stale top-level feature staging files are removed without touching other staged runtime resources; contents of current source directories are preserved by complete directory copies;
- root packaging includes the clean feature tree without repeating per-feature resource entries;
- independent product builder configurations remain product-owned and their existing resource layouts remain valid;
- resolver and staging tests cross the new interfaces and do not test private helper implementation;
- existing feature catalog, feature resource, surface, shell, product, Swift, and build checks pass;
- documentation names the catalog, resolver, staging adapter, and ownership split;
- no native protocol, lifecycle, IPC, renderer, or product build-policy redesign slips into the change.
