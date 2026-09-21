# Moirasia

Moirasia is a macOS controller for Amove, Vox, Bonded, and Shout, and an embedded feature host for Amove, Bonded, and Shout. Its Applications menu discovers those four standalone bundles and opens or focuses them. On macOS with native artifacts, the feature service owns persistent Bonded, Shout, and Amove background state while Electron owns the UI and Amove shelf. Closing the final shell and shelf window lets Electron exit; reopening reconnects to the native host. Builds without native artifacts keep the existing Electron controllers. Exithibition and Orbis are standalone-only repositories under `apps/standalone`; they share Moirasia's UI packages but have no controller or embedded runtime integration.

## Development

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

`pnpm dev` also builds the local application agent, so the Applications menu can discover installed controlled bundles during development. The suite build compiles and stages the Amove native addon, the Bonded firewall helper, and the Shout audio helper plus Shout Mic driver before packaging Moirasia. Standalone product repositories keep their own locks.

```sh
pnpm -C apps/integrated/Amove install --ignore-workspace
pnpm -C apps/integrated/Bonded install --ignore-workspace
pnpm -C apps/integrated/Shout install --ignore-workspace
bun --cwd apps/standalone/Vox install --frozen-lockfile
```

Then package the suite:

```sh
pnpm package:mac
```

## Publishing a macOS release

Create and publish a release from the local Mac:

```sh
brew install gh
gh auth login
pnpm release:mac
```

The command requires a clean `main` branch and a semantic `package.json` version greater than the latest `v<version>` release. It builds the unsigned ARM64 DMG, writes a SHA-256 checksum, creates the matching tag, atomically pushes `main` and the tag, and uploads both files to a GitHub Release with generated notes. Use `pnpm release:mac --dry-run` to inspect the artifact paths without building, tagging, pushing, or uploading anything.

Moirasia releases are unsigned and unnotarized.

Packaged and development builds can check for a newer GitHub Release from General or **Moirasia > Check for Updates…**. If a newer version is published, Moirasia shows a link to that release page so you can download the DMG there. Replacing the running app still requires dragging the new copy into Applications.

Amove and Bonded remain buildable in standalone mode as well as embedded mode. Run Amove's commands from its app directory:

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

Exithibition is standalone-only:

```sh
pnpm -C apps/standalone/Exithibition install --ignore-workspace
pnpm -C apps/standalone/Exithibition dev
pnpm -C apps/standalone/Exithibition package:mac
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

Shout's standalone commands are:

```sh
pnpm -C apps/integrated/Shout install --ignore-workspace
pnpm -C apps/integrated/Shout native:build
pnpm -C apps/integrated/Shout dev
pnpm -C apps/integrated/Shout verify
pnpm -C apps/integrated/Shout package:dir
```

Shout requires macOS 27 or later. Its suite build stages the release helper at `Resources/features/shout/native/ShoutAudioHelper` and the driver at `Resources/features/shout/driver/ShoutMic.driver`; standalone packaging keeps both under `Resources/native/`. Installing the Shout Mic driver still requires administrator approval from Shout's panel.

Orbis's commands are:

```sh
pnpm -C apps/standalone/Orbis install --ignore-workspace
pnpm -C apps/standalone/Orbis dev
pnpm -C apps/standalone/Orbis verify
pnpm -C apps/standalone/Orbis native:test
pnpm -C apps/standalone/Orbis native:mac
pnpm -C apps/standalone/Orbis test:smoke
```

Set `ORBIS_SCAN_ROOT` for a fixture scan during development or automation. Orbis scans read-only and publishes immutable, app-private SQLite indexes under its Electron data directory. It loads its last validated index and refreshes it after the window opens.

Orbis uses progressive exact scanning by default and streams bounded, path-free previews. Full scans checkpoint their private construction database every two seconds or 4,096 processed entries, plus journal drains and lifecycle transitions. Pausing, shutting down, or losing the worker keeps the last checkpoint. A resumed scan retains completed directories and restarts any directory whose enumeration was incomplete. `current.json` remains the only authority for completed indexes, so checkpoint data is never presented as committed.

On macOS, the Rust/N-API addon uses `getattrlistbulk` to accelerate exact traversal and bounded FSEvents history replay to identify dirty subtrees. A resumable scan retains its original FSEvents baseline. Orbis reconciles changes before publication and starts fresh if target identity or history can no longer be trusted. FSEvents supplies invalidation paths only. Refreshed byte counts still come from filesystem traversal, allocated blocks remain `blocks × 512`, and hard links are counted once by device/inode. Orbis does not query Spotlight or run a live watcher.

Standalone Orbis does not import its former suite indexes or saved scans. Data under `Application Support/Moirasia/features/orbis` is left untouched. A private cache of the previous completed standalone scan may provide provisional folder sizes until a full traversal finishes. It never changes exact totals or suppresses traversal. The Pause action saves full-scan progress. "Discard saved scan" removes only the private construction and leaves the last published index intact. Set `ORBIS_DISABLE_INCREMENTAL_SCAN=1` to retain its non-resumable persistent-full behavior, `ORBIS_SCAN_DIAGNOSTICS=1` to collect phase timings, or `ORBIS_DISABLE_BULK_METADATA=1` to exercise Node metadata fallback without disabling resume or FSEvents. `ORBIS_LEGACY_SCAN=1` remains accepted as a no-op compatibility setting. The v3 snapshot contract, publication and recovery rules, and performance gates are documented in `apps/standalone/Orbis/docs/architecture/orbis-progressive-scanning.md`.

Independent product repositories are split by suite support: Amove and Bonded live under `apps/integrated/`, while Vox, Exithibition, Orbis, LiteMaptica, Mini-NSW, and Semiquaver live under `apps/standalone/`. Each keeps its own package manager lock and verification commands. `@moirasia/desktop-shell` provides the shared 36px macOS chrome, adaptive navigation, local embedded appearance scopes, page/content-header layouts, atomic cross-process appearance registry, chrome-only window options, and bundle-owned headless login-item protocol.

## Application control

The packaged AppKit helper uses Launch Services and `NSWorkspace` to resolve fixed bundle identifiers, inspect running applications, launch or activate them, request normal termination, and open Login Items settings. Command+1 through Command+4 open or focus Amove, Vox, Bonded, and Shout respectively. Vox has no embedded panel. Bonded and Shout remain available both as embedded features and standalone bundles, and each runtime lease ensures only one host owns its sensitive session at a time (Bonded's network monitor and PF helper; Shout's audio helper and default-input ownership).

Each controlled standalone bundle accepts one headless command without creating product windows or starting its runtime:

```text
--moirasia-control=login-item:get
--moirasia-control=login-item:set:on
--moirasia-control=login-item:set:off
```

Moirasia and its controlled applications use `Application Support/Moirasia/appearance.json`. Standalone-only Exithibition and Orbis store appearance in their own Electron data directories. All applications use the same appearance controls and visual tokens from the shared desktop-shell packages.

In native suite mode, `MoirasiaFeatureService.app` owns the microphone and Accessibility operations performed by Shout and Amove. Electron displays the service state and sends the user commands. Local mode keeps the existing Electron permission helpers. Standalone apps keep their own bundle identity and permissions. Orbis therefore owns any Full Disk Access grant, while Vox owns its microphone, accessibility, and shortcut grants.

Vox no longer runs inside Moirasia. On first standalone launch after leaving the suite, Vox reverse-migrates the suite's data: it snapshots `Application Support/Moirasia/features/vox/vox.sqlite`, merges it into `Application Support/Vox/vox.sqlite` (entity rows union by id with the suite row winning the rare collision, daily aggregate counters taking the per-day maximum, settings resolving per key in the suite's favor except launch-at-login), backs up the standalone store first, records the outcome in a marker, and removes the suite copy. A failed merge retries on the next launch and leaves both stores untouched. Downloaded models under `Application Support/Vox/Models` and provider credentials in the `com.moirasia.vox.providers` Keychain service stay shared. A transitional lease keeps the microphone, global shortcuts, and shared model store owned by one Vox host at a time while stale pre-move Moirasia builds that still embed Vox may exist.

Moirasia stores Bonded settings under its own `features/bonded` directory. On first use it can copy valid standalone settings from `Application Support/Bonded`, but the two stores never share later writes. Shout keeps the same isolation for its settings under `features/shout`.
