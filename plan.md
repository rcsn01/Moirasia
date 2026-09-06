# Plan: move Vox out of the Moirasia suite into `apps/standalone`

Move the Vox repository from `apps/integrated/Vox` to `apps/standalone/Vox`, remove Vox from the suite's embedded-feature system, and have standalone Vox adopt the data that the embedded feature accumulated.

## Decisions (confirmed)

1. **Full de-integration.** The repo splits product repositories by suite support: `apps/integrated/` holds products embedded in the Moirasia window, `apps/standalone/` holds independent apps (YN360, LiteMaptica, Mini-NSW, Semiquaver). Moving the directory therefore means removing the embedding, not just changing paths. Vox becomes standalone-only, like YN360.
2. **Vox stays in the Applications menu.** Command+2 keeps opening the standalone Vox bundle. The menu, controller, agent, login-item control, and appearance registration keep treating Vox as one of the five family applications; only the embedded panel goes away.
3. **Reverse-migrate suite data.** On first standalone launch after the move, Vox merges `Application Support/Moirasia/features/vox/vox.sqlite` back into `Application Support/Vox/vox.sqlite`, then removes the suite copy.

## Why the panel must go

`docs/architecture/standalone-applications.md` defines the split: "Independent product repositories are split by suite support." Keeping the panel while moving the directory would make `apps/standalone` a lie in the tree layout and would leave two catalogs disagreeing about what Vox is. The embedded panel, the suite overlay hosting, the suite staging of VoxNative, and the suite-side runtime lease all die with the embedding. What survives: the Vox bundle itself, its appearance product, its login-item protocol, and its slot in the Applications menu.

## What Vox integration touches today (inventory)

Verified by search; every path below is referenced from the root repo today.

Suite host (root repo):

| File | Vox coupling |
| --- | --- |
| `packages/desktop-shell/src/feature-catalog.ts` | `'vox'` entry in `FeatureId`, `FEATURE_SEEDS`, `FeatureIconKey` (`mic`), `GROUPS` (`voice`), requirements for both host modes |
| `packages/desktop-shell/src/index.ts` | `PRODUCT_IDS = ['moirasia', ...FEATURE_IDS, 'yn360']` (vox arrives via `FEATURE_IDS`) |
| `src/shared/contracts.ts` | `APPLICATION_IDS = FEATURE_IDS`, `ApplicationId = FeatureId`, `ControllerPage = 'general' \| 'features' \| FeatureId` |
| `src/main/features/runtime.ts` | `LOADERS.vox` literal dynamic import of `apps/integrated/Vox/src/main/feature`; the `'vox'` case in `suiteFeatureContext` (overlay preload/renderer paths, VoxNative path, suite data dir, legacy dir) |
| `src/main/paths.ts` | `feature-vox-overlay` preload and renderer page entries |
| `src/preload/shell.ts` | imports `createVoxBridge` from Vox, exposes `window.vox` |
| `src/renderer/shell/app.tsx` | lazy `VoxPanel` import; `PRIMARY_PANELS.vox` |
| `src/renderer/shell/global.d.ts` | `window.vox: VoxAPI` |
| `src/renderer/shell/styles.css` | `@import "../../../apps/integrated/Vox/src/renderer/styles.css"` |
| `src/renderer/shell/controller.ts` | `EMPTY` snapshot builds `applications` from `featureCatalog.entries`; appearances include `vox` |
| `src/renderer/shell/screens/features.tsx` | Features page renders `featureCatalog.groups` (vox in the `voice` group) |
| `src/renderer/shell/feature-icons.tsx` | `mic` icon entry |
| `src/main/menu.ts` | Applications submenu from `featureCatalog.entries`; Command+2 is Vox |
| `src/main/application-controller.ts` | application list, labels, bundle ids from `featureCatalog` |
| `src/main/ipc.ts` | guards use `isApplicationId` for all handlers including install/uninstall/openFeature |
| `src/main/settings.ts` | v3 settings keyed by `ApplicationId`; `features.vox` flag may exist in stores |
| `electron.vite.config.ts` | `feature-vox-overlay` preload entry; `feature-vox-overlay` renderer entry (`apps/integrated/Vox/overlay.html`) |
| `electron-builder.yml` | `native/staged/features/vox/native` extraResource; `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`, `NSAppleEventsUsageDescription` on the Moirasia bundle |
| `scripts/stage-feature-binaries.mjs` | builds and stages VoxNative from `apps/integrated/Vox/native` |
| `scripts/sign-after-pack.mjs` | ad-hoc codesigns the staged VoxNative |
| `scripts/check-ui-ownership.mjs` | Vox renderer root, `.vox-feature-panel` rules, vox product-color and icon allowlists |
| `package.json` | `predev` builds Vox native debug; `test:dev-ready:all` checks `apps/integrated/Vox`; `ui:verify` runs `bun --cwd apps/integrated/Vox` typecheck and tests |
| `tsconfig.node.json`, `tsconfig.react.json` | include `apps/integrated/Vox/src/**` |
| `native/application-agent/main.swift` | `Product(id: "vox", ... bundleIdentifier: "com.moirasia.vox")` — stays unchanged |
| `tests/*` | see the test section below |
| `README.md`, `docs/architecture/standalone-applications.md` | describe Vox as an embedded feature, suite data import, runtime lease |

Vox repository (`apps/integrated/Vox`, its own git repo):

| File | Role after the move |
| --- | --- |
| `src/main/feature.ts` | `VoxFeature` implementing `MoirasiaFeature` for the suite loader. Delete. |
| `src/main/runtime-lease.ts` | per-user lease arbitrating standalone vs suite Vox. Keep as a legacy guard through one release (see Risks), then delete. |
| `src/main/data-migration.ts` | one-time standalone-to-suite import. Delete; replaced by the reverse merge. |
| `src/main/standalone.ts` | builds the runtime context. Becomes the only context builder. |
| `src/main/controller.ts` | branches on `context.mode === 'suite'` (surface activation, authorized IPC set, launchAtLogin rejection, event targets). Suite branches go away. |
| `src/main/index.ts` | standalone entry; constructs `VoxFeature`. Constructs the controller directly instead. |
| `src/renderer/App.tsx` | standalone dashboard plus the `VoxPanel` export for the suite panel and an `embedded` flag hiding the launchAtLogin toggle. Panel export and flag go away. |
| `src/renderer/styles.css` | `.vox-feature-panel` suite-panel blocks. Remove those blocks. |
| `electron-builder.yml` | already ships Vox's own mic/speech/AppleEvents usage descriptions at `Resources/native/VoxNative`. Unchanged. |
| `package.json` | deps use `file:../../../packages/desktop-shell` and `file:../../../packages/ui-react`; same depth at the new location, so no changes. `test:dev-ready` uses `../../../scripts/check-electron-install.mjs`; same depth, no change. |
| `bun.lock` | no path-dependent entries; deps unchanged, so the lock stays valid. |

No root workspace change is needed: `pnpm-workspace.yaml` already excludes `apps/**`.

## Target shape

- `applicationCatalog` (new, in `packages/desktop-shell`) owns the facts of the five family applications: `amove`, `vox`, `exithibition`, `bonded`, `orbis`. Fields: `id`, `label`, `executableName`, `bundleId`. Consumers: Applications menu, `ApplicationController`, the agent contract (`main.swift` stays as is), login-item retry, `APPLICATION_IDS`, and the renderer's empty-state application list.
- `featureCatalog` shrinks to the four embedded features: `amove`, `exithibition`, `bonded`, `orbis`. It keeps icon keys, groups, descriptions, and per-host-mode requirements. The `voice` group and the `mic` icon key disappear.
- `ApplicationId` becomes its own union of the five application ids. `FeatureId` shrinks to four. `ControllerPage` drops `'vox'` (there is no Vox page to navigate to; Command+2 calls `open`, not `navigate`).
- `PRODUCT_IDS` becomes `['moirasia', ...FEATURE_IDS, 'vox', 'yn360']`. Vox remains an appearance product; existing `appearance.json` values for `vox` stay valid. `packages/design-system`'s `product-tokens.json` and most of `preset.mjs` list products by string key and need no change, but `preset.mjs`'s `check()` also reads `apps/integrated/Vox/package.json` by literal path to pin the local font dependency version (line ~185); that one path must follow the move or `pnpm ui:preset:check` — the first step of `ui:verify` — throws `ENOENT` instead of failing cleanly.
- The suite no longer builds, stages, signs, or loads anything Vox. Moirasia's bundle loses the mic/speech/AppleEvents usage descriptions; the Vox bundle already carries its own.
- Vox runs only as its own bundle. It keeps the desktop shell chrome, its dashboard, tray, overlay, login-item protocol, and `com.moirasia.vox` identity. On first launch it merges suite data back (spec below).

## Work items

### Phase A: suite host de-integration (one root commit, includes the move)

A1. Catalog split in `packages/desktop-shell`:

- New `src/application-catalog.ts`: five application seeds (copy `label`, `executableName`, `bundleId` from the current feature seeds), the `ApplicationEntry` type, `applicationCatalog` with `ids`, `entries`, `isId`, `get`, built with the same freeze/validation style as `feature-catalog.ts`.
- `src/feature-catalog.ts`: remove the `vox` seed, the `mic` key from `FeatureIconKey`, and the `voice` group. `FeatureId` shrinks to four. Update the header comment ("five embedded features" to four).
- `src/index.ts`: re-export the application catalog; `PRODUCT_IDS = ['moirasia', ...FEATURE_IDS, 'vox', 'yn360']`.
- `src/main.ts`: `DEFAULTS` and `requiredLegacyProducts` already include `vox`; no change.

A2. `src/shared/contracts.ts`: `APPLICATION_IDS = applicationCatalog.ids`; `ApplicationId = 'amove' | 'vox' | 'exithibition' | 'bonded' | 'orbis'` derived from the catalog; `isApplicationId` from the catalog; `ControllerPage = 'general' | 'features' | FeatureId`.

A3. `src/main/features/runtime.ts`: delete `LOADERS.vox`; delete the `'vox'` case in `suiteFeatureContext` (the `assertNever` default keeps the switch exhaustive).

A4. `src/main/paths.ts`: remove the `feature-vox-overlay` entries from `preloadPages` and `rendererPages`.

A5. `src/preload/shell.ts`: remove the `createVoxBridge` import and the `window.vox` exposure. `src/renderer/shell/global.d.ts`: remove the `VoxAPI` import and the `vox` field.

A6. Renderer:

- `app.tsx`: remove the `VoxPanel` lazy import and the `vox` entry in `PRIMARY_PANELS` (the `Record<FeatureId, ...>` stays exhaustive with four keys).
- `controller.ts`: build `EMPTY.applications` from `applicationCatalog.entries`; keep `vox: 'system'` in appearances.
- `feature-icons.tsx`: remove the `mic` entry.
- `styles.css`: remove the Vox styles import.
- `screens/features.tsx` needs no edit; it renders whatever the catalog has.

A7. `src/main/menu.ts`: Applications submenu from `applicationCatalog.entries`. Order stays `amove, vox, exithibition, bonded, orbis`, so Command+2 stays Vox.

A8. `src/main/application-controller.ts`: derive the application list, labels, and bundle ids from `applicationCatalog`. Keep `installFeature`/`openFeature`/`reportPage` feature-scoped.

A9. `src/main/ipc.ts`: tighten `installFeature`, `uninstallFeature`, and `openFeature` to validate `isFeatureId` instead of `isApplicationId`, so `installFeature('vox')` fails at the guard with a clear message rather than a runtime error deeper in `FeatureRuntime`.

A10. Build and packaging:

- `electron.vite.config.ts`: remove both `feature-vox-overlay` entries (preload and renderer).
- `electron-builder.yml`: remove the `features/vox/native` extraResource and the three usage-description strings.
- `scripts/stage-feature-binaries.mjs`: remove the VoxNative block (`voxRoot` through the bundle copy loop).
- `scripts/sign-after-pack.mjs`: remove the VoxNative block.

A11. Scripts and configs:

- `package.json`: `predev` drops `pnpm -C apps/integrated/Vox build:native:debug`; `test:dev-ready:all` drops the Vox leg; `ui:verify` replaces the Vox leg with `bun --cwd apps/standalone/Vox run typecheck && bun --cwd apps/standalone/Vox test`.
- `tsconfig.node.json`: remove the three `apps/integrated/Vox/src/main|preload|shared` includes.
- `tsconfig.react.json`: remove the two Vox includes.
- `scripts/check-ui-ownership.mjs`: this script has six separate literal reads of `apps/integrated/Vox/...` paths, not two, and each throws `ENOENT` (not a clean check failure) once the directory moves: the `rendererRoots` entry (the general renderer scan), the `requiredImports` entry (`styles.css` must import `vox.css` and declare `@source`), the `primaryWindows` entry (`standalone.css`/`App.tsx` must use the shared shell), the `embeddedStyleEntrypoints` entry (the `.vox-feature-panel` selector-scoping rule), the `shellStyles` expected-import line (looks for the same Vox `@import` that A6 removes from `src/renderer/shell/styles.css`), and the per-line `voxStyles` loop that scopes `--vox-color-` usage to the overlay/status selectors. All six go. Leave `allowedTokens.vox` alone — it validates `packages/design-system/product-tokens.json`, which stays in the root repo since Vox stays a product; there is no separate "icon allowlist" for Vox in this script (that check lives in `feature-icons.tsx`, covered by A6). Follow-up: port the still-relevant rules (dashboard and overlay token scoping) into Vox's own test suite.
- `packages/design-system/scripts/preset.mjs`: update the `apps/integrated/Vox/package.json` path in `check()` to `apps/standalone/Vox/package.json`.

A12. Move the directory: `mv apps/integrated/Vox apps/standalone/Vox`. The root repo does not track `apps/` (gitignored), and Vox has its own `.git`, so the move carries the history with no root git surgery. Vox's dependency paths (`file:../../../packages/...`) stay valid at the same depth.

A13. `native/application-agent/main.swift`: no change. The agent keeps resolving `com.moirasia.vox`.

### Phase B: Vox repository de-integration (Vox's own git)

B1. Delete `src/main/feature.ts`. `src/main/index.ts` constructs `VoxController` directly with `standaloneContext()` and keeps the single-instance lock, login-item control, and quit policy. `feature.ts` is today the only caller of `acquireVoxRuntimeLease`/`lease.release()` (`VoxController` itself has no lease code), so deleting it silently drops the lease guard unless that call moves too: move the `acquireVoxRuntimeLease(...)` call into `VoxController.start()` (before it touches the database) and `lease.release()` into `stop()` (see B3), so `index.ts`'s existing catch around startup still sees `VoxRuntimeInUseError` and shows the "Vox is already running" dialog. `feature.ts` also called `validateFeatureResources(context)`, which reads `featureCatalog.get(context.id)` and would throw once `vox` leaves the catalog (A1) — that call does not need a new home: it's suite-oriented plumbing (every other standalone app, e.g. YN360, skips it too), so it's dropped along with `feature.ts`, not relocated.

B2. Keep `src/main/runtime-lease.ts` for one release as a legacy guard against stale pre-move Moirasia builds, which still embed Vox and would contend for the lease. Standalone Vox already shows the "Vox is already running" dialog in that case. Delete the module and its test in a follow-up release once stale builds are gone.

B3. `src/main/controller.ts`: remove the suite branches. The authorized-IPC set and `surface` activation go away; `mutable` becomes always true; the launchAtLogin getter/setter drops its suite rejection path; the event-targets list drops the suite `webContents` leg; `activate()` focuses the dashboard only. Replace the standalone-to-suite `prepareVoxDataDirectory` call with the reverse merge (B5). `start()` also gains the lease acquisition moved from `feature.ts` (B1) as its first step, wrapped so a thrown `VoxRuntimeInUseError` propagates out of `start()` unchanged; `stop()` releases the lease alongside the database close.

B4. `src/main/standalone.ts`: stays the single context builder. It may keep using the `FeatureContext` type from `@moirasia/desktop-shell/feature` (that module remains exported for the other four apps) or move to a local type; prefer the local type to stop implying a suite mode. Delete `src/main/data-migration.ts`.

B5. New `src/main/suite-merge.ts` implementing the reverse migration (spec below), wired into startup before the controller opens its database.

B6. Renderer:

- `App.tsx`: remove the `VoxPanel` export, its props, and the `embedded` flag; the launchAtLogin toggle becomes unconditional.
- `styles.css`: remove the `.vox-feature-panel` blocks.

B7. Vox `package.json`: no dependency changes. Optionally add a `verify` leg running the new merge tests (they are part of `bun test` anyway).

B8. Vox docs (`README.md`, `ARCHITECTURE.md`, `CAPABILITIES.md`): rewrite the suite-mode sections. State that Vox is standalone-only, describe the one-time suite merge, and note that the lease guard is transitional.

### Phase C: tests

Root repo:

- `tests/contracts.test.ts`: `APPLICATION_IDS` keeps five ids; `FEATURE_IDS` pins four; `isControllerPage('vox')` flips to `false`; add a pin of the application catalog order.
- `tests/feature-catalog.test.ts`: drop the vox expectations; the requirements, bundle-id, and group pins lose their vox lines.
- New `tests/application-catalog.test.ts`: pin the five application ids and order, the `com.moirasia.vox` bundle id, executable names, and freeze behavior, mirroring the feature-catalog tests.
- `tests/feature-contract.test.ts`: remove the vox cases.
- `tests/feature-paths.test.ts`: remove the "Vox suite paths" describe block.
- `tests/feature-runtime.test.ts`: loader-key expectations shrink to four; the `'Vox is already using Vox.'` fixture string is arbitrary and may stay or be renamed.
- `tests/platform-integration.test.ts`: the Command+2 test should keep passing unchanged once the menu reads `applicationCatalog`.
- `tests/shell-renderer.test.tsx`: remove the Vox panel mock, the vox feature fixtures, and vox-specific assertions; keep `vox` in the appearances fixture (still a product).
- `tests/embedded-panel-chrome.test.tsx`: remove the `VoxPanel` import and its cases; keep the other panels' cases.
- `tests/desktop-shell.test.tsx`: the `product="Vox"` chrome test and the `tokens.vox` test stay; the assertions that read `apps/integrated/Vox/src/renderer/styles.css` for `.vox-feature-panel` padding move into Vox's repo or die with the panel.
- `tests/vox-workspace.test.tsx`: the panel is gone, so port these cases (model download progress, engine choices) into Vox's repo against the dashboard UI, then delete the file.
- `tests/appearance-registry.test.ts`, `tests/shell-settings.test.ts`: unaffected.

Vox repo:

- `tests/runtime-lease.test.ts` stays while the lease guard exists.
- Rewrite the `data-migration` tests as `suite-merge` tests: no suite store; suite store with no standalone store; both stores merged per the policy below; failure leaves both stores untouched; marker written; login-item setting preserved; suite directory removed after success.
- Update `ipc` and controller tests that used suite-mode fixtures.

### Phase D: docs

- Root `README.md`: intro keeps Vox in the family but as a standalone app ("controller and feature host for Amove, Exithibition, Bonded, and Orbis; controller for Vox"). Move the Vox development commands into the standalone-apps section like YN360's, with the `apps/standalone/Vox` path. The `bun --cwd apps/integrated/Vox install` line moves to `apps/standalone/Vox`. Update the Applications-menu paragraph: Command+2 opens the standalone Vox bundle; the Apps sidebar no longer has a Vox tab. Replace the suite Vox data and lease paragraphs with the reverse-merge description.
- `docs/architecture/standalone-applications.md`: rewrite the Vox paragraphs. The catalog is now "the four embedded features plus the application catalog that also owns Vox"; describe Vox as a standalone-only family app, the retired suite lease, and the reverse merge.
- `docs/design-system/README.md`: the "YN360 is the first standalone app" line stays true; add a line noting Vox adopted the same standalone setup.

### Phase E: reverse migration spec (`src/main/suite-merge.ts`)

Trigger: standalone Vox startup, before the controller opens its database, once per data directory, gated by a marker file `.vox-suite-merge-v1.json` in `Application Support/Vox`.

Inputs:

- Suite store: `<appData>/Moirasia/features/vox/vox.sqlite` plus `-wal`/`-shm` and the old import marker.
- Standalone store: `<appData>/Vox/vox.sqlite`.

Steps:

1. Marker present: no-op.
2. Snapshot the suite store to a temp copy using the same technique as the current `data-migration.ts` (copy db plus WAL/SHM; never open the original with writes).
3. No standalone store: install the snapshot as the standalone store. Caveat to document: the suite store's `launchAtLogin` was force-cleared on import, so the copied value is the last suite state, not the pre-suite preference.
4. Both stores exist: merge on the snapshot plus the live store.
   - Schema check: both stores must report the same schema version; otherwise skip the merge, surface a non-blocking notice, and keep both stores.
   - Entity tables (profiles, custom modes, dictionary terms, correction rules, snippets, workflows) and meeting-schema tables (meetings, speakers, meeting_segments): union by id, suite row wins on an id collision. This is verified against `src/main/database.ts`, not deferred to the executor: none of the eleven tables in `VOX_PERSISTENT_TABLES` carries an `updated_at` or other last-modified column, and every id in these tables is an app-generated `crypto.randomUUID()` (see the profile/custom-mode/snippet/dictionary-term creators in `App.tsx`), so a same-id collision between two independently-run databases isn't a realistic merge case — it would require two calls to `randomUUID()` to collide. A timestamp-based tie-break has no data to act on and guards against a scenario that doesn't occur; a flat "suite wins the rare collision" rule is both correct and simpler. Implementation is the same shape as the existing fresh-install path: attach the snapshot and run `INSERT OR IGNORE INTO main.<table> SELECT * FROM legacy.<table>` per table inside one transaction (mirroring `VoxDatabase.importFrom`'s attach/`quick_check`/table-list validation), then re-run with source and destination swapped for the columns where the suite should overwrite an existing standalone row — or, simpler still, delete-then-reinsert the colliding id from the suite side. Either is a few lines of SQL, not a per-table policy table.
   - Settings: suite value wins per key, except `launchAtLogin`, which the standalone store keeps (the suite copy was force-cleared by design).
   - Daily aggregates: per day take the max of each counter. A sum would double-count days when both hosts ran.
5. Before any write to the standalone store, copy it once to `vox.pre-merge-backup.sqlite` in the standalone data directory.
6. On success: delete `Application Support/Moirasia/features/vox` entirely (store, WAL/SHM, old marker), write the standalone marker with the outcome, and re-apply the stored `launchAtLogin` value to the macOS login item so the standalone preference wins over the suite's forced-off value.
7. On failure: leave both stores untouched, write the marker with the error, show a non-blocking notice in the dashboard, and retry on the next launch.
8. Credentials and models need no migration: provider secrets live in the shared `com.moirasia.vox.providers` Keychain service and models in the shared `Application Support/Vox/Models`.

Re-run safety: a stale Moirasia could later re-create the suite store by importing from standalone again. The standalone marker prevents a second merge; document rather than automate.

## Sequencing and git notes

1. Prepare the Vox repo changes on a branch in Vox's own git first, but merge only after the root commit lands (the old root build still imports `feature.ts` until the flip).
2. Land Phase A as a single root commit: the move plus every root-side reference change together, because the root build breaks between the `mv` and the edits otherwise.
3. Merge the Vox branch.
4. Docs and follow-up cleanups can land after.

## Verification matrix

Root:

- `pnpm ui:preset:check` (preset lock and ownership checks)
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`, then confirm `out/` contains no `feature-vox-overlay` chunks and `release/` staging contains no `features/vox`
- `pnpm dev` smoke: Applications menu lists the five apps; Command+2 opens or focuses an installed standalone Vox; Features page shows four features in two groups; no Vox entry in the Apps sidebar; appearance picker still offers Vox

Vox:

- `cd apps/standalone/Vox && bun install --frozen-lockfile && bun run typecheck && bun test && bun run build:renderer && bun run test:swift`
- `bun run package:dir`, install the bundle, launch Moirasia, and confirm the agent snapshot reports Vox installed and Command+2 works
- Reverse-migration smoke: seed fixture stores in both locations, launch dev Vox with `VOX_OFFLINE=1`, verify merged rows, the marker, the backup file, and the removed suite directory; relaunch to confirm the no-op path

Cross-checks:

- `rg -i "apps/integrated/Vox"` over the root repo returns nothing
- `rg -i "vox" out/ release/` after a clean build returns nothing suite-side

## Risks and mitigations

- **Stale Moirasia builds.** A pre-move Moirasia.app still embeds Vox and grabs the runtime lease. Mitigation: keep the lease guard in Vox for one release; ship both apps in the same release cycle and say so in the notes.
- **Bad merge.** A wrong policy could corrupt the standalone store. Mitigation: pre-merge backup copy, failure keeps both stores, merge runs on a snapshot, marker records the outcome.
- **Permission re-grants.** macOS mic and Accessibility grants are per bundle. Suite grants on Moirasia become unused; users who only used embedded Vox grant mic and Accessibility to the Vox bundle once. Document in the release notes.
- **bun.lock validity.** Dependencies and relative paths are unchanged, so the lock should hold; if Bun rejects it, regenerate with `bun install` and commit the new lock in Vox's repo.

## Out of scope

- Deleting inert `features.vox` keys from existing v3 shell settings stores.
- Porting the full UI-ownership rule set into Vox's repo (only the still-relevant token-scoping rules).
- Removing the runtime lease (follow-up after the transition release).
- Adding a Vox status card or any Vox UI back to the Features page.
- YN360, LiteMaptica, Mini-NSW, Semiquaver changes.

## Definition of done

- Vox lives at `apps/standalone/Vox`, builds and tests green with its own Bun workflow, and packages a working bundle.
- The root suite builds, typechecks, and tests green with zero references to `apps/integrated/Vox`; the Features page lists four features; the Applications menu keeps five entries with Command+2 on Vox.
- Existing suite Vox data is merged into the standalone store on first standalone launch, the suite store directory is removed, and the outcome is recorded in a marker.
- Root and Vox docs describe the new split, the reverse migration, and the transitional lease.