# Standalone application architecture

Moirasia has two separate relationships with product applications. It controls the installed Amove, Vox, and Bonded bundles through its AppKit application agent. It also hosts Amove and Bonded as embedded features. Exithibition and Orbis are standalone-only applications and have neither relationship with Moirasia.

## Repository ownership

Each product is an independent Git repository under `apps/`. Amove and Bonded live under `apps/integrated` because they implement `MoirasiaFeature`. Vox, Exithibition, Orbis, LiteMaptica, Mini-NSW, Semiquaver, and YN360 live under `apps/standalone`.

The repositories share the visual system through local `@moirasia/desktop-shell` and `@moirasia/ui-react` package links. Shared UI ownership does not imply that Moirasia launches, embeds, configures, or stores settings for every product.

## Controlled applications

The application catalog in `packages/desktop-shell/src/application-catalog.ts` contains Amove, Vox, and Bonded. It supplies the Applications menu, Command+1 through Command+3, controller snapshots, and the AppKit agent contract. Those bundles support the `--moirasia-control` login-item protocol.

Exithibition and Orbis do not appear in the catalog or AppKit agent. Their launchers pass `controlProtocol: 'none'` to `runStandaloneLaunch`, so they use its single-instance, activation, error, and teardown behavior without accepting Moirasia commands.

## Embedded features

The feature catalog in `packages/desktop-shell/src/feature-catalog.ts` contains Amove and Bonded. `FeatureRuntime` loads their backends through literal imports. `EmbeddedFeatureHost` supplies the suite surface, and `suiteFeatureContext` supplies suite-owned resources and data directories.

`acquireFeatureSurface` handles their suite-versus-standalone primary surface. Suite mode uses the shell's window. Standalone mode creates a product window from catalog facts. Moirasia's preload and renderer expose only the Amove and Bonded bridges and panels.

Suite artifacts are staged under `native/staged/features/<id>` and packaged under `Contents/Resources/features/<id>`. Moirasia's build never builds or packages Exithibition or Orbis.

## Standalone-only surfaces

`acquireStandaloneSurface` from `@moirasia/desktop-shell/standalone-surface` creates a guarded, sandboxed primary window without importing either catalog. The application supplies its title, geometry, preload, renderer, default appearance, and appearance file. The returned handle exposes `webContents`, `window`, `ready()`, `activate()`, and `dispose()` so product IPC can be wired before the renderer loads.

Exithibition and Orbis store appearance in their own Electron `userData` directory. They still render `DesktopAppShell` and use the same shared components, tokens, page spacing, and product styling as Moirasia.

The runtime leases shared by Vox, Bonded, and Shout are implemented at `@moirasia/desktop-shell/runtime-lease`; their lock names and legacy owner-record compatibility remain unchanged, while each adapter preserves its app-specific in-use error class. Recovery uses the legacy-compatible `recovery.json` marker.

## Exithibition

`apps/standalone/Exithibition` owns its Electron lifecycle, context-isolated preload, React renderer, and Swift telemetry process. Samples and chart history remain memory-only. The experimental-sensor preference remains in the `com.local.Exithibition` defaults domain. Packaging copies both `ExithibitionNative` and its SwiftPM `Exithibition_Exithibition.bundle` into the standalone app.

## Orbis

`apps/standalone/Orbis` owns its controller, worker protocol, SQLite indexes, preload, and renderer. Development builds the worker at `worker-dist/scan-worker.mjs`; packaged builds place it at `Resources/worker/scan-worker.mjs`, with the optional metadata addon under `Resources/native`.

Standalone Orbis reads and writes only its Electron `userData` directory. It does not import saved locations, completed indexes, estimates, diagnostics, or resumable scans from `Application Support/Moirasia/features/orbis`. That former suite directory is left untouched. `ORBIS_USER_DATA` can select an isolated data directory for tests or development. Full Disk Access belongs to the Orbis bundle.

## Vox and Bonded transitions

Vox retains its existing suite-data merge and transitional runtime lease for stale Moirasia builds that embedded Vox. Bonded remains both controlled and embedded; its runtime lease prevents two hosts from controlling the network monitor and PF session concurrently. These policies do not apply to Exithibition or Orbis.
