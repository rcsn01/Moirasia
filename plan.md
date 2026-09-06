# Plan: complete the feature catalog — one owner for artifact facts

The feature catalog (`packages/desktop-shell/src/feature-catalog.ts`) is declared "the single owner of every shared fact about the four embedded features," yet the heaviest facts — artifact filenames, staged paths, packaged resource destinations, and dev build layouts — live in four places outside it. Adding one embedded feature today means editing five files and hoping four of them agree. This plan finishes the catalog: it gains an **artifacts facet** that names every binary, worker, and asset bundle a feature ships, where the build stages it, and where packaged resources land — as pure data. Hosts keep resolving; the facts stop being duplicated.

## Decisions

Grilling was run against the full decision tree; per instruction every fork took the recommended answer. Record below — each decision names the fork, the recommended answer taken, and why it beat the alternative.

### Round 1 — scope and shape

**Q1 · What does the artifacts facet own?**
➡️ **Filenames + build layouts + staged paths + packaged destinations, as pure data templates.** Not resolved paths — the catalog never resolves (no Electron, no fs). Hosts join facts with roots. Filename-only was rejected because staged/destination paths are the facts that actually drift (the Exithibition flat path proves it); full path resolution in the catalog was rejected because it would violate the catalog's documented purity.

**Q2 · Who owns the native-addon platform filename matrix?**
➡️ **A pure function in the catalog: `nativeAddonFileName(base, platform?, arch?)`.** It replaces three verbatim duplicates: `nativeAddonName()` in `runtime.ts`, `nativeAddonName()` in Orbis `standalone.ts`, and `standaloneNativeName()` in Amove `standalone.ts`. Platform/arch become parameters (accept dependencies, don't create them) so the matrix is testable without touching `process`.

**Q3 · Normalize Exithibition's flat staging?**
➡️ **Yes.** `native/staged/features/ExithibitionNative` → `native/staged/features/exithibition/native/ExithibitionNative`, and its packaged destination `native/ExithibitionNative` → `features/exithibition/native/ExithibitionNative`. This removes the one special case so every artifact follows one rule: staged `native/staged/features/<id>/<dir>`, suite destination `features/<id>/<dir>`. Only the suite is affected — Exithibition's own bundle keeps `native/ExithibitionNative`. Nothing in tests or scripts pins the old flat path (verified: only `tests/feature-runtime.test.ts` uses `ExithibitionNative` inside an arbitrary `/tmp` fixture).

**Q4 · Do preload/renderer page facts join the facet?**
➡️ **No.** They are build-config wiring (`electron.vite.config.ts` entries, `paths.ts` maps, per-app build outputs), a different mechanism that the architecture doc deliberately leaves host-explicit. Conflating them would widen the facet without removing a real duplication.

**Q5 · How do non-TS consumers (stage script, `electron-builder.yml`) relate to the catalog?**
➡️ **Contract pins, not imports.** The stage script is a plain `.mjs` (no TS loader available: no `tsx`, `js-yaml` not importable) and the builder config is YAML. Both stay hand-written; a new contract test reads them as text and asserts every catalog fact appears in them. This is the pattern the repo already uses for the Swift application agent (`platform-integration.test.ts` pins `main.swift` strings against `application-catalog`). A JS builder config importing the catalog was rejected as build-system risk for zero test gain.

**Q6 · Keep the per-feature switch in `suiteFeatureContext`?**
➡️ **Keep the switch.** The literal `import()` loaders above it are a rollup requirement (code-splitting, uninstalled features never evaluated); the switch below it becomes a thin join of catalog facts with host roots — 3–6 lines per case. A fully table-driven context builder was rejected: it hides the literal imports that make code-splitting work and would put Electron-specific resolution into the catalog.

**Q7 · Extract the suite context builder into its own module?**
➡️ **Yes.** `suiteFeatureContext` and its helpers are ~100 of `runtime.ts`'s 234 lines. It becomes `src/main/features/suite-context.ts`, leaving `FeatureRuntime` a smaller interface (lifecycle only) and giving the context join its own testable seam that needs no feature loaders.

### Round 2 — data model and consumers (frontier opened by Round 1 answers)

**Q8 · Which additional shared facts join the facet?**
➡️ **Two: `directory` on the entry, and `standaloneResource` on each artifact.**
- `directory` — the app repo directory name (`'Amove'`, `'Exithibition'`, …). Today it is hard-coded in the suite dev paths (`join(app.getAppPath(), 'apps', 'integrated', 'Amove', …)`), the stage script, and `package.json` scripts. Catalog owns it; TS consumers use it; scripts stay text-pinned.
- `standaloneResource` records where each artifact lands in the *app's own* packaged bundle (`native`, `features/orbis/native`, …). It kills the packaged-mode literals in the four `standalone.ts` files. Each app's own `electron-builder.yml` stays app-owned — the yml is the app's packaging decision, the catalog records the fact the resolver needs.

**Q9 · Catalog validation rules for the facet?**
➡️ **Three, enforced in `buildCatalog()` (throw-at-import style, matching existing checks):**
1. Every `native: [...]` requirement name must have an artifact of the same `name` whose kind is `native` or `executable` (both live in the `paths.native` map — Exithibition's `executable` artifact sits in the `native` requirement bucket today, so bucket-name equality with `ArtifactKind` is not the check); every `workers: [...]` requirement name must have an artifact of the same `name` with kind `worker`.
2. Artifact `name`s are unique per feature.
3. `kind: 'native'` artifacts carry a napi base name (validated: no `.node` suffix in `file`); other kinds carry an exact filename with an extension.
Preload/renderer/asset requirement names are exempt (not artifacts).

**Q10 · Do literal path expectations in tests stay, or become catalog-derived?**
➡️ **Literals stay; new pins join them.** The repo's culture is pinning (bundle ids pinned against `main.swift`, `desktop-shell.test.tsx` byte-asserts CSS). `tests/feature-paths.test.ts` extends from one feature to all four × both modes with literal final paths — that pins the join. The catalog data itself is pinned by catalog tests; the contract pins (Q5) tie script and YAML to the catalog. Drift anywhere turns a test red instead of silently re-encoding.

## Current inventory — every site an artifact fact appears

Verified by reading each file; `rg` note: the root repo gitignores `apps/`, so app-repo sites were read directly.

| # | File | Facts hard-coded |
| --- | --- | --- |
| 1 | `src/main/features/runtime.ts:135–233` | `suiteFeatureContext` per-feature switch: packaged `features/<id>/…` and `native/ExithibitionNative` destinations; dev app-root joins (`apps/integrated/<App>`); dev build layouts (`.build/arm64-apple-macosx/debug`, `native/`, staged worker/native for Orbis); `nativeAddonName()` platform matrix for both `amove-native` and `orbis-metadata` |
| 2 | `apps/integrated/Amove/src/main/standalone.ts` | `standaloneNativeName()` matrix (verbatim duplicate of #1); packaged `native/<file>`; dev `<appRoot>/native/<file>` |
| 3 | `apps/integrated/Orbis/src/main/standalone.ts` | `nativeAddonName()` matrix (verbatim duplicate of #1); packaged `features/orbis/{native,worker}`; dev `native/`, `worker-dist/` |
| 4 | `apps/integrated/Exithibition/src/main/standalone.ts` | packaged `native/ExithibitionNative`; dev `.build/arm64-apple-macosx/debug/ExithibitionNative` |
| 5 | `apps/integrated/Bonded/src/main/standalone.ts` | packaged `native/BondedFirewallHelper`; dev `native/.build/arm64-apple-macosx/debug/BondedFirewallHelper` |
| 6 | `scripts/stage-feature-binaries.mjs` | per-feature build commands + source artifact paths (`.build/arm64-apple-macosx/release/…`, `native/*.node`) → staged destinations; builds release where the suite dev build reads debug (#1) — divergence encoded twice |
| 7 | `electron-builder.yml:9–24` | 7 `extraResources` mappings repeating staged paths and destinations, including the Exithibition flat one-off |
| 8 | `package.json:17` | `features:worker --outDir native/staged/features/orbis/worker` (staged worker path) |
| 9 | `apps/integrated/{Amove,Exithibition,Bonded,Orbis}/electron-builder.yml` | each app's own packaged layout (`native/*.node`, `native/ExithibitionNative`, `native/BondedFirewallHelper`, `features/orbis/{native,worker}`) — app-owned, but the *filenames* are shared facts |
| 10 | Orbis app tests (`orbis-bulk-node-parity.test.ts`, `orbis-fsevents-live.test.ts`) | recompute the addon filename locally — app-repo concern, optional follow-up |

Out of scope, recorded so future walks don't re-suggest them: the application-agent staging (`scripts/build-application-agent.mjs`, `paths.ts applicationAgentPath`) is a controller fact, not a feature artifact; preload/renderer pages (Q4); the Swift agent's product table (already pinned by `platform-integration.test.ts`).

## Target design

### Types (in `packages/desktop-shell/src/feature-catalog.ts`)

```ts
/** Artifact roles mirror the requirement tables: a host validates 'native.addon',
 *  the catalog says what that file is and where it lives. */
export type ArtifactKind = 'native' | 'executable' | 'worker' | 'assets'

export interface FeatureArtifact {
  /** Symbolic name matching the per-mode requirements tables ('addon', 'helper', 'executable', 'scan', …). */
  readonly name: string
  readonly kind: ArtifactKind
  /**
   * kind 'native': napi base name — the real filename comes from nativeAddonFileName(base, …).
   * other kinds: exact filename ('ExithibitionNative', 'scan-worker.mjs'); kind 'assets' carries none.
   */
  readonly file?: string
  /** Where the build output lands inside the app repo, relative to the app root. `{configuration}` → 'debug' | 'release'. */
  readonly buildOutput: string
  /** Suite-repo-relative path the staging script places the artifact at (directory for multi-file kinds). */
  readonly staged: string
  /** Suite-packaged destination under Contents/Resources (directory; the filename inside is `file`). */
  readonly suiteResource: string
  /** Which source the suite trusts in development: the app's own build output, or the staged copy. */
  readonly suiteDevSource: 'buildOutput' | 'staged'
  /** Destination under the app's own Contents/Resources in standalone packaging. */
  readonly standaloneResource: string
}
```

`FeatureCatalogEntry` gains `readonly directory: string` (app repo directory name) and `readonly artifacts: readonly FeatureArtifact[]`; the builder freezes entries and artifacts like `requirements`. The existing purity header comment stays true: still no Electron/React/fs/product imports — a pure function for the platform matrix is data-shaped, not resolution.

### The facet table (complete — this is the single source of truth after landing)

| Feature | Artifact | name | kind | file | buildOutput | staged | suiteResource | suiteDevSource | standaloneResource |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Amove | native addon | `addon` | native | `amove-native` | `native` | `native/staged/features/amove/native` | `features/amove/native` | buildOutput | `native` |
| Amove | assets | `assets` | assets | — | `assets` | `native/staged/features/amove/assets` | `features/amove/assets` | buildOutput | `assets`¹ |
| Exithibition | Swift executable | `executable` | executable | `ExithibitionNative` | `.build/arm64-apple-macosx/{configuration}` | `native/staged/features/exithibition/native`² | `features/exithibition/native`² | buildOutput | `native` |
| Bonded | firewall helper | `helper` | native | `BondedFirewallHelper` | `native/.build/arm64-apple-macosx/{configuration}` | `native/staged/features/bonded/native` | `features/bonded/native` | buildOutput | `native` |
| Orbis | metadata addon | `metadata` | native | `orbis-metadata` | `native` | `native/staged/features/orbis/native` | `features/orbis/native` | staged | `features/orbis/native` |
| Orbis | scan worker | `scan` | worker | `scan-worker.mjs` | `worker-dist` | `native/staged/features/orbis/worker` | `features/orbis/worker` | staged | `features/orbis/worker` |

¹ Amove's standalone assets are asar-embedded (`files: assets/**/*`), not an extraResource — the catalog records the app-internal convention, Amove's `standalone.ts` keeps resolving it against `app.getAppPath()`.
² Normalized per Q3 (was flat `native/staged/features/ExithibitionNative`).

The suite dev source asymmetry is real and recorded as data: Amove/Exithibition/Bonded suite dev reads the app repo's build output; Orbis suite dev reads the staged copies (`features:worker`/`features:native` place them there in `predev`). Normalizing Orbis to `buildOutput` would change which artifacts `pnpm dev` requires and is not worth it.

Pure function replacing three duplicates:

```ts
export function nativeAddonFileName(
  base: string,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch
): string {
  const a = arch === 'arm64' ? 'arm64' : 'x64'
  if (platform === 'darwin') return `${base}.darwin-${a}.node`
  if (platform === 'win32') return `${base}.win32-x64-msvc.node`
  return `${base}.linux-x64-gnu.node`
}
```

Behaviour is byte-identical to today's matrices (linux/x64-gnu and win32 ignore arch — preserved deliberately).

### Resolution rules per host

Each rule below joins a *directory* (composed by the caller from a catalog fact) with the artifact's *filename* (which the shared helper resolves, since it depends on `kind`). A single `(root, artifact)` helper cannot do both halves itself — suite-packaged and standalone-packaged both call it with `root = process.resourcesPath` and no configuration, yet must resolve different directory facts (`suiteResource` vs `standaloneResource`); only the caller knows which mode it's in. So the helper's contract is scoped to the part that actually repeats across ~12 call sites — the kind-dependent filename — and callers compose the directory inline (already a one-liner in every case below):

```ts
export function artifactPath(directory: string, artifact: FeatureArtifact): string
// join(directory, artifact.kind === 'native' ? nativeAddonFileName(artifact.file!) : artifact.file!)
```

- **Suite packaged:** `artifactPath(join(process.resourcesPath, suiteResource), artifact)` — one rule for every artifact; the `features/amove/native` filter-based directory mappings in `electron-builder.yml` keep working because destinations stay directories.
- **Suite dev:** `suiteDevSource === 'buildOutput'`
  → `artifactPath(join(app.getAppPath(), 'apps', 'integrated', directory, buildOutput.replace('{configuration}', 'debug')), artifact)`
  else → `artifactPath(join(app.getAppPath(), staged), artifact)`.
- **Standalone packaged:** `artifactPath(join(process.resourcesPath, standaloneResource), artifact)`.
- **Standalone dev:** `artifactPath(join(appDevRoot, buildOutput.replace('{configuration}', 'debug')), artifact)` — `appDevRoot` stays host-owned (Amove's `import.meta.dirname/../..` vs Orbis's `app.getAppPath()` distinction is window-layout, not artifact, knowledge).
- Preload/renderer maps, `dataDirectory`, `legacyDataDirectories`: unchanged, host-owned as before.

Every call site still shrinks to one line (the directory join plus `artifactPath`), but it is a directory-then-artifact call, not a bare-root one — the earlier bare-root framing let the packaged-suite/packaged-standalone ambiguity hide.

## Work items

### Phase A — catalog gains the facet (root repo, `packages/desktop-shell`)

A1. `src/feature-catalog.ts`:
- Add `ArtifactKind`, `FeatureArtifact`, `nativeAddonFileName`, `artifactPath` as above.
- Add `directory` and `artifacts` to each of the four seeds per the facet table; `directory` values: `'Amove'`, `'Exithibition'`, `'Bonded'`, `'Orbis'`.
- Extend `buildCatalog()` validation (Q9 rules) — plus: `assets` kind must not carry `file`; `staged`/`suiteResource`/`standaloneResource` non-empty. (No separate check that `nativeAddonFileName(file)` ends in `.node` — every branch of that function appends `.node` unconditionally, so the check can never fail; the meaningful assertion is Q9 rule 3, that the input `file` doesn't already carry the suffix.)
- Update the header comment: artifacts facts are catalog-owned; hosts resolve them. Export the new names from `src/feature.ts` (re-export block) and `src/index.ts` as needed.

A2. No change to `application-catalog.ts` (Q5 keeps the Swift agent out of scope).

### Phase B — suite consumers (root repo)

B1. New `src/main/features/suite-context.ts`:
- Move `suiteFeatureContext` + `assertNever` out of `runtime.ts`; delete `nativeAddonName()`.
- Each feature case becomes a join: catalog entry + `artifactPath` + host roots (`process.resourcesPath`, `app.getAppPath()`, `paths.preload/renderer` for Amove's shelf — that map stays in `paths.ts`).
- Exithibition case switches to the normalized staged layout (dev unchanged: `.build/…/debug` via `buildOutput`).
- `runtime.ts` re-exports `suiteFeatureContext` for its existing importers/tests so no caller moves.

B2. `scripts/stage-feature-binaries.mjs`: rewrite only the Exithibition staging lines to the normalized path (`native/staged/features/exithibition/native/`); all other literals already match the catalog and stay (they are pinned, not derived — Q5). Keep the bespoke build commands per app; they are toolchain facts, not paths.

B3. `electron-builder.yml`: replace the Exithibition mapping with the uniform one:
```yaml
  - from: native/staged/features/exithibition/native
    to: features/exithibition/native
```
Other mappings unchanged (already catalog-shaped).

B4. `package.json` `features:worker`: no change (the outDir literal is pinned by the contract test, not duplicated in TS).

### Phase C — standalone app consumers (app repos; each app must keep building standalone)

C1. `apps/integrated/Amove/src/main/standalone.ts`: delete `standaloneNativeName()`; import `featureCatalog` + `artifactPath` from `@moirasia/desktop-shell/feature`; native path = `artifactPath(appRoot/native root, addon artifact)`; assets directory = `join(appRoot, 'assets')` (app-internal, stays a literal per facet-table note ¹).

C2. `apps/integrated/Orbis/src/main/standalone.ts`: delete `nativeAddonName()`; derive worker/metadata paths via `artifactPath` + `standaloneResource`/`buildOutput`.

C3. `apps/integrated/Exithibition/src/main/standalone.ts` and `apps/integrated/Bonded/src/main/standalone.ts`: same treatment; dev paths via `buildOutput` with `debug`, packaged via `standaloneResource`.

C4. Optional follow-up (not this change): Orbis app tests (`orbis-bulk-node-parity`, `orbis-fsevents-live`) may import `nativeAddonFileName` instead of recomputing the filename.

### Phase D — tests (root repo)

D1. New `tests/feature-artifacts.test.ts`:
- Facet table pins: per feature, artifact `name`/`kind`/`file`/`staged`/`suiteResource`/`standaloneResource`/`suiteDevSource`/`directory` match the table above.
- Platform matrix: `nativeAddonFileName('amove-native' | 'orbis-metadata')` across darwin arm64/x64, win32, linux — byte-exact.
- Catalog validation: a hostile seed (requirement name without artifact; duplicate artifact name; native artifact with `.node` suffix) throws — tested via a small seed-fixture harness or by asserting on the built catalog's invariants plus a direct `buildCatalog`-style check if the builder is exported; if not exported, pin via the public catalog and keep hostile-seed cases out (builder stays private).
- Requirement↔artifact alignment: for every entry and host mode, each `native`/`workers` requirement name resolves to an artifact.
- Contract pins (text reads, `existsSync`-guarded so app-repo absence fails loudly):
  - `scripts/stage-feature-binaries.mjs` contains every artifact's `staged` path and source layout.
  - `electron-builder.yml` contains `from: <staged>` + `to: <suiteResource>` for every artifact.
  - `package.json` `features:worker` contains the Orbis worker `staged` dir.
  - Each app's `electron-builder.yml` contains its `standaloneResource` and (for single-file kinds) the `file`.

D2. `tests/feature-paths.test.ts`: extend from one Bonded describe-block to all four features × dev/packaged, literal final paths (Q10). Bonded's existing two tests keep their exact strings.

D3. `tests/feature-runtime.test.ts`: unaffected (loader fakes); keep the `ExithibitionNative` fixture string or rename to match the new layout — cosmetic either way.

D4. `tests/feature-catalog.test.ts`: add facet pins (artifact counts per feature: Amove 2, Exithibition 1, Bonded 1, Orbis 2; `directory` values; freeze depth covers `entry.artifacts`).

### Phase E — docs and domain vocabulary

E1. `docs/architecture/standalone-applications.md`: revise the catalog paragraph — the feature catalog additionally owns artifact facts (filenames, staged paths, suite-packaged destinations, dev build layouts, platform `.node` naming); hosts resolve them through `artifactPath`; resource paths are no longer "explicit in each host," they are *facts in the catalog, resolved by each host*. Update the staging/packaging paragraph for the Exithibition normalization.

E2. `README.md`: no build-command changes; nothing user-visible moves except nothing — packaging output layout changes only for Exithibition inside the suite bundle.

E3. `CONTEXT.md` (new, repo root): record the domain terms this plan relies on — controller, feature host, embedded feature, standalone application, feature catalog, application catalog, feature runtime, `FeatureContext`, host mode, **artifact fact** (the new term this deepening introduces), staged resources — with one-line definitions and a pointer to the architecture doc.

## Sequencing

1. **Phase A** lands first (catalog types + data + validation). Green on its own: nothing consumes the facet yet; existing tests pass unchanged.
2. **Phase B** same commit or immediately after (suite resolver + normalizations). `pnpm typecheck && pnpm test` must stay green; the Exithibition path change is invisible until packaging.
3. **Phase C** app repos next — each app `pnpm -C apps/integrated/<App> typecheck && test` after its edit. App repos are gitignored by the root; commit in each app's own git.
4. **Phase D** tests with/after B (root) — the contract pins must exist before anyone edits staging paths again.
5. **Phase E** docs last.

## Verification matrix

Root repo:
- `pnpm typecheck`
- `pnpm test` — new artifacts tests + extended path tests green; no other suite regressions
- `pnpm build` → `release/`-staged `native/staged/features/exithibition/native/ExithibitionNative` exists; `out/` build clean
- `pnpm dist:mac` smoke (optional but recommended once): packaged app contains `Resources/features/exithibition/native/ExithibitionNative` and all four features load (Features page, each tab mounts)
- `rg -n "ExithibitionNative" src scripts electron-builder.yml` → matches only catalog-expected sites
- `rg -n "darwin-.*\.node|win32-x64-msvc|linux-x64-gnu" src apps/integrated/*/src/main` → only the catalog (no matrix duplicates left)

Per app: `pnpm -C apps/integrated/<App> typecheck && pnpm -C apps/integrated/<App> test` (all four), plus `pnpm -C apps/integrated/<App> dev` smoke for Amove and Orbis (native/worker actually loads).

## Risks and mitigations

- **Packaged-layout change for Exithibition (normalization).** Mitigation: verified nothing pins the old path (tests, sign script, agent); `pnpm dist:mac` smoke in the verification matrix; the suite rebuilds its own bundle, so no user-side migration applies.
- **App repos drift from the catalog.** The apps gitignore the root's history and consume the catalog via `file:../../../packages/desktop-shell` — a catalog change lands for them on their next install. Mitigation: the contract pins (D1) run in the root and read the app files as text, so a root-side catalog change that contradicts an app file fails the root suite immediately; app repos' `pnpm install` refreshes the link before their typecheck.
- **The stage script's release-vs-debug divergence.** The script builds release; suite dev reads debug from app `.build` dirs (Amove/Exithibition/Bonded) or staged copies (Orbis). This plan records it as data (`suiteDevSource`) rather than normalizing it — changing when `pnpm dev` builds/stages what is out of scope.
- **Contract pins are string-level.** A reformat of `electron-builder.yml` could break pins without semantic drift. Mitigation: pins match on `from:`/`to:` line pairs, tolerant of ordering; failures point at the catalog table as the reference.

## Out of scope

- Preload/renderer page facts (Q4) and the `electron.vite.config.ts` entry list.
- The application agent's staging and its Swift product table (controller facts, already pinned).
- App-repo `electron-builder.yml` generation (their ymls stay app-owned; filenames are contract-pinned).
- Deriving builder config or scripts from the catalog at build time (Q5 — pins instead).
- Orbis `suiteDevSource` normalization and `pnpm dev` staging-flow changes.
- Orbis app tests switching to `nativeAddonFileName` (optional follow-up, C4).
- The runtime-lease collapse (review candidate #1) and the desktop-shell split (#3) — separate changes.

## Definition of done

- Every artifact filename, staged path, suite-packaged destination, dev build layout, and the platform `.node` matrix exists exactly once, in `feature-catalog.ts`; the three `nativeAddonName`/`standaloneNativeName` duplicates are deleted.
- `suiteFeatureContext` lives in its own module and every path it returns is a catalog fact joined with a host root; `FeatureRuntime`'s module keeps only lifecycle.
- The four `standalone.ts` files resolve paths from the catalog; no packaged-mode filename literals remain in any app repo's context builder.
- The contract test pins stage script, root builder yml, root `package.json` worker outDir, and the four app builder ymls against the catalog — adding a feature's artifacts starts with one catalog entry plus the bespoke build commands, and any drift turns a test red.
- All four apps still build, typecheck, and test green as standalone apps; the suite typechecks, tests, builds, and packages green.
- The architecture doc and new `CONTEXT.md` describe artifacts as catalog-owned facts resolved by hosts.