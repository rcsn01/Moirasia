# Moirasia

Moirasia is a macOS controller and feature host for Amove, Exithibition, Bonded, and Orbis, and the controller for standalone Vox. Its Applications menu discovers standalone bundles and opens or focuses them. The sidebar places General and Features under Essentials, then shows each installed and loaded Amove, Exithibition, Bonded, or Orbis feature under Apps. Amove's Shelf remains a floating utility window.

## Development

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

`pnpm dev` also builds the local application agent, so the Applications menu can discover installed bundles during development. The suite build compiles the Amove native addon, the Orbis Rust/N-API metadata addon, the Exithibition Swift helper, the Bonded firewall helper, and VoxNative. It stages those resources plus the Orbis scan worker and packages the unsigned Moirasia app. Because standalone product repositories keep their own locks, install the native app dependencies once before the first suite build:

```sh
pnpm -C apps/integrated/Amove install --ignore-workspace
pnpm -C apps/integrated/Orbis install --ignore-workspace
pnpm -C apps/integrated/Bonded install --ignore-workspace
bun --cwd apps/standalone/Vox install --frozen-lockfile
```

Then package the suite:

```sh
pnpm dist:mac
```

Amove, Exithibition, Bonded, and Orbis remain buildable as standalone apps. Run Amove's commands from its app directory:

```sh
pnpm -C apps/integrated/Amove install --ignore-workspace
pnpm -C apps/integrated/Amove dev
pnpm -C apps/integrated/Amove package:mac
```

Vox keeps its Bun workflow from its own repository under `apps/standalone/Vox`:

```sh
bun --cwd apps/standalone/Vox install --frozen-lockfile
bun --cwd apps/standalone/Vox verify
bun --cwd apps/standalone/Vox package:dir
```

Exithibition's commands are:

```sh
pnpm -C apps/integrated/Exithibition install --ignore-workspace
pnpm -C apps/integrated/Exithibition dev
pnpm -C apps/integrated/Exithibition package:mac
```

Bonded's standalone commands are:

```sh
pnpm -C apps/integrated/Bonded install --ignore-workspace
pnpm -C apps/integrated/Bonded native:build
pnpm -C apps/integrated/Bonded dev
pnpm -C apps/integrated/Bonded verify
pnpm -C apps/integrated/Bonded package:dir
```

The suite build stages its release helper at `Resources/features/bonded/native/BondedFirewallHelper`. Installing that helper still requires administrator approval from Bonded's panel. Standalone packaging keeps the original `Resources/native/BondedFirewallHelper` location.

Orbis's commands are:

```sh
pnpm -C apps/integrated/Orbis install --ignore-workspace
pnpm -C apps/integrated/Orbis dev
pnpm -C apps/integrated/Orbis verify
pnpm -C apps/integrated/Orbis native:test
pnpm -C apps/integrated/Orbis native:mac
pnpm -C apps/integrated/Orbis test:smoke
```

Set `ORBIS_SCAN_ROOT` for a fixture scan during development or automation. Orbis scans read-only and publishes immutable, app-private SQLite indexes under its writable feature data directory. The suite panel stays idle until you click Scan. Standalone Orbis loads its last validated index and refreshes it after the window opens.

Orbis uses progressive exact scanning by default and streams bounded, path-free previews. Full scans checkpoint their private construction database every two seconds or 4,096 processed entries, plus journal drains and lifecycle transitions. Pausing, shutting down, or losing the worker keeps the last checkpoint. A resumed scan retains completed directories and restarts any directory whose enumeration was incomplete. `current.json` remains the only authority for completed indexes, so checkpoint data is never presented as committed.

On macOS, the Rust/N-API addon uses `getattrlistbulk` to accelerate exact traversal and bounded FSEvents history replay to identify dirty subtrees. A resumable scan retains its original FSEvents baseline. Orbis reconciles changes before publication and starts fresh if target identity or history can no longer be trusted. FSEvents supplies invalidation paths only. Refreshed byte counts still come from filesystem traversal, allocated blocks remain `blocks × 512`, and hard links are counted once by device/inode. Orbis does not query Spotlight or run a live watcher.

A private cache of the previous completed scan may provide provisional folder sizes until a full traversal finishes. It never changes exact totals or suppresses traversal. The Pause action saves full-scan progress. "Discard saved scan" removes only the private construction and leaves the last published index intact. Set `ORBIS_DISABLE_INCREMENTAL_SCAN=1` to retain its non-resumable persistent-full behavior, `ORBIS_LEGACY_SCAN=1` to bypass persistence and FSEvents with the Stage 5 scanner, `ORBIS_SCAN_DIAGNOSTICS=1` to collect phase timings, or `ORBIS_DISABLE_BULK_METADATA=1` to exercise Node metadata fallback without disabling resume or FSEvents. The v3 snapshot contract, publication and recovery rules, and performance gates are documented in `apps/integrated/Orbis/docs/architecture/orbis-progressive-scanning.md`.

Independent product repositories are split by suite support: Amove, Exithibition, Bonded, and Orbis live under `apps/integrated/`, while Vox, LiteMaptica, Mini-NSW, and Semiquaver live under `apps/standalone/`. Each keeps its own package manager lock and verification commands. `@moirasia/desktop-shell` provides the shared 36px macOS chrome, adaptive navigation, local embedded appearance scopes, page/content-header layouts, atomic cross-process appearance registry, chrome-only window options, and bundle-owned headless login-item protocol.

## Application control

The packaged AppKit helper uses Launch Services and `NSWorkspace` to resolve fixed bundle identifiers, inspect running applications, launch or activate them, request normal termination, and open Login Items settings. Command+1 through Command+5 open or focus Amove, Vox, Exithibition, Bonded, and Orbis respectively. Command+2 opens the standalone Vox bundle; the Apps sidebar no longer hosts Vox. Command+4 still opens the standalone Bonded bundle; the Apps sidebar opens Bonded inside Moirasia. Only one host can own Bonded's monitor and PF helper at a time.

Each standalone bundle accepts one headless command without creating product windows or starting its runtime:

```text
--moirasia-control=login-item:get
--moirasia-control=login-item:set:on
--moirasia-control=login-item:set:off
```

Appearance is stored in `Application Support/Moirasia/appearance.json`. Values for Moirasia and each app remain independent, update live across running processes, and can be changed together from Moirasia Settings.

In-suite features use the Moirasia bundle's macOS permissions. Microphone, accessibility, and screen-recording grants apply to the suite app, not to an individual product feature. Full Disk Access applies to Moirasia when Orbis runs inside the suite. Standalone builds keep their own bundle identity and permissions, so standalone Orbis needs its own Full Disk Access grant and Vox has always owned its own microphone, accessibility, and shortcut grants.

Vox no longer runs inside Moirasia. On first standalone launch after leaving the suite, Vox reverse-migrates the suite's data: it snapshots `Application Support/Moirasia/features/vox/vox.sqlite`, merges it into `Application Support/Vox/vox.sqlite` (entity rows union by id with the suite row winning the rare collision, daily aggregate counters taking the per-day maximum, settings resolving per key in the suite's favor except launch-at-login), backs up the standalone store first, records the outcome in a marker, and removes the suite copy. A failed merge retries on the next launch and leaves both stores untouched. Downloaded models under `Application Support/Vox/Models` and provider credentials in the `com.moirasia.vox.providers` Keychain service stay shared. A transitional lease keeps the microphone, global shortcuts, and shared model store owned by one Vox host at a time while stale pre-move Moirasia builds that still embed Vox may exist.

Moirasia stores Bonded settings under its own `features/bonded` directory. On first use it can copy valid standalone settings from `Application Support/Bonded`, but the two stores never share later writes.
