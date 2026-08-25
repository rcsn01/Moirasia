# Moirasia

Moirasia is a macOS controller and feature host for Amove, Vox, Exithibition, Bonded, and Orbis. The Apps page discovers standalone bundles, opens or focuses them, reports running state, and requests graceful termination. Installed Amove, Exithibition, and Orbis backends also run in-process behind the Apps · feature · Settings navigation. Their primary panels share the shell window while Amove's Shelf remains floating.

## Development

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

`pnpm dev` also builds the local application agent, so the Apps page can discover installed bundles during development. The suite build compiles the Amove native addon, the Orbis Rust/N-API metadata addon, and the Exithibition Swift helper, stages those resources plus the Orbis scan worker, and packages the unsigned Moirasia app. Because standalone product repositories keep their own locks, install the native app dependencies once before the first suite build:

```sh
pnpm -C apps/Amove install --ignore-workspace
pnpm -C apps/Orbis install --ignore-workspace
```

Then package the suite:

```sh
pnpm dist:mac
```

Amove and Exithibition remain buildable as standalone apps. Run Amove's commands from its app directory:

```sh
pnpm -C apps/Amove install --ignore-workspace
pnpm -C apps/Amove dev
pnpm -C apps/Amove package:mac
```

Exithibition's commands are:

```sh
pnpm -C apps/Exithibition install --ignore-workspace
pnpm -C apps/Exithibition dev
pnpm -C apps/Exithibition package:mac
```

Orbis's commands are:

```sh
pnpm -C apps/Orbis install --ignore-workspace
pnpm -C apps/Orbis dev
pnpm -C apps/Orbis verify
pnpm -C apps/Orbis native:test
pnpm -C apps/Orbis native:mac
pnpm -C apps/Orbis test:smoke
```

Set `ORBIS_SCAN_ROOT` for a fixture scan during development or automation. Orbis scans read-only and publishes immutable, app-private SQLite indexes under its writable feature data directory. The suite panel stays idle until you click Scan. Standalone Orbis loads its last validated index and refreshes it after the window opens.

Orbis uses progressive exact scanning by default and streams bounded, path-free previews while its private SQLite transaction is open. On macOS, the Rust/N-API addon uses `getattrlistbulk` to accelerate exact traversal and bounded FSEvents history replay to identify dirty subtrees. FSEvents supplies invalidation paths only: refreshed byte counts still come from exact filesystem traversal, allocated blocks remain `blocks × 512`, and hard links are counted once by device/inode. Missing, dropped, wrapped, ambiguous, or incompatible history falls back to a full scan. Orbis does not query Spotlight or run a live watcher.

A private cache of the previous completed scan may provide provisional folder sizes until a full traversal finishes; it never changes exact totals or suppresses traversal. Set `ORBIS_DISABLE_INCREMENTAL_SCAN=1` to retain persistent indexes while forcing full progressive refreshes, `ORBIS_LEGACY_SCAN=1` to bypass persistence and FSEvents with the Stage 5 scanner, `ORBIS_SCAN_DIAGNOSTICS=1` to collect phase timings, or `ORBIS_DISABLE_BULK_METADATA=1` to exercise Node metadata fallback without disabling FSEvents. The v3 snapshot contract, publication and recovery rules, and performance gates are documented in `docs/architecture/orbis-progressive-scanning.md`.

The five product repositories live under `apps/` and keep their own package manager locks and verification commands. `@moirasia/desktop-shell` provides the shared 36px macOS chrome, adaptive navigation, local embedded appearance scopes, page/content-header layouts, atomic cross-process appearance registry, chrome-only window options, and bundle-owned headless login-item protocol.

## Application control

The packaged AppKit helper uses Launch Services and `NSWorkspace` to resolve fixed bundle identifiers, inspect running applications, launch or activate them, request normal termination, and open Login Items settings. Command+1 through Command+5 open or focus Amove, Vox, Exithibition, Bonded, and Orbis respectively.

Each standalone bundle accepts one headless command without creating product windows or starting its runtime:

```text
--moirasia-control=login-item:get
--moirasia-control=login-item:set:on
--moirasia-control=login-item:set:off
```

Appearance is stored in `Application Support/Moirasia/appearance.json`. Values for Moirasia and each app remain independent, update live across running processes, and can be changed together from Moirasia Settings.

In-suite features use the Moirasia bundle's macOS permissions. Microphone, accessibility, and screen-recording grants apply to the suite app, not to an individual product feature. Full Disk Access applies to Moirasia when Orbis runs inside the suite. Standalone builds keep their own bundle identity and permissions, so standalone Orbis needs its own Full Disk Access grant.
