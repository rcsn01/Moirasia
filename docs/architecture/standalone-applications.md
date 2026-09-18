# Standalone application architecture

Moirasia has two separate relationships with product applications. It controls the installed Amove, Vox, Bonded, and Shout bundles through its AppKit application agent. It also hosts Amove, Bonded, and Shout as embedded features. Exithibition and Orbis are standalone-only applications and have neither relationship with Moirasia.

## Repository ownership

Each product is an independent Git repository under `apps/`. Amove, Bonded, and Shout live under `apps/integrated` because they implement `MoirasiaFeature`. Vox, Exithibition, Orbis, LiteMaptica, Mini-NSW, Semiquaver, and YN360 live under `apps/standalone`.

The repositories share the visual system through local `@moirasia/desktop-shell` and `@moirasia/ui-react` package links. Shared UI ownership does not imply that Moirasia launches, embeds, configures, or stores settings for every product.

## Controlled applications

The application catalog in `packages/desktop-shell/src/application-catalog.ts` contains Amove, Vox, Bonded, and Shout. It supplies the Applications menu, Command+1 through Command+4, controller snapshots, and the AppKit agent contract. Those bundles support the `--moirasia-control` login-item protocol.

Exithibition and Orbis do not appear in the catalog or AppKit agent. Their launchers pass `controlProtocol: 'none'` to `runStandaloneLaunch`, so they use its single-instance, activation, error, and teardown behavior without accepting Moirasia commands.

## Embedded features

The feature catalog in `packages/desktop-shell/src/feature-catalog.ts` contains Amove, Bonded, and Shout. `FeatureRuntime` loads their backends through literal imports. `EmbeddedFeatureHost` supplies the suite surface, and `suiteFeatureContext` supplies suite-owned resources and data directories.

`acquireFeatureSurface` handles their suite-versus-standalone primary surface. Suite mode uses a stable renderer target supplied by `EmbeddedFeatureHost`; the target detaches when Menu Bar mode destroys the shell window and follows the next shell renderer without restarting feature backends. Standalone mode creates a product window from catalog facts. Moirasia's preload and renderer expose only the Amove, Bonded, and Shout bridges and panels.

`ShellWindowLifecycle` owns each primary-window generation, its shell IPC authorization, polling, navigation guards, and renderer loading. Closing in Menu Bar mode destroys that generation while keeping installed feature controllers and runtime leases alive. A replacement renderer fetches fresh snapshots when Moirasia reopens. Amove's shelf is a separate window: a visible shelf and its global shortcuts continue working while the shell renderer is absent, while hidden shelf windows are destroyed and recreated on demand.

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

## Vox, Bonded, and Shout transitions

Vox retains its existing suite-data merge and transitional runtime lease for stale Moirasia builds that embedded Vox. Bonded remains both controlled and embedded; its runtime lease prevents two hosts from controlling the network monitor and PF session concurrently. Shout is also both controlled and embedded; its runtime lease (`Moirasia/shout-runtime.lock` in the shared application-data root) prevents two hosts from owning the audio helper session, the driver's default-input role, and the restore bookkeeping at the same time. These policies do not apply to Exithibition or Orbis.

## Shout

`apps/integrated/Shout` boosts every application's microphone by 0 to +30 dB with an optional soft limiter, delivered through a virtual `Shout Mic` input device so consumers of the system default input hear the amplified signal. It is macOS 27-only. A Swift helper (`ShoutAudioHelper`) owns the HAL IO and gain/limiter path; an AudioServerPlugIn driver bundle (`ShoutMic.driver`, built from the vendored libASPL library) publishes the virtual input. Installing the driver into `/Library/Audio/Plug-Ins/HAL` and restarting `coreaudiod` requires administrator approval from Shout's panel; while boosting with "Make Shout Mic the default input" enabled, the helper records the previous default input before switching and restores it on shutdown.
