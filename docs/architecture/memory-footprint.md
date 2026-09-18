# Memory footprint and macOS on-demand architecture

## Measurement method

Moirasia's packaged arm64 build is measured with `pnpm memory:benchmark`.

The benchmark uses three complementary measurements:

- `footprint` physical footprint is the primary comparison. It accounts for macOS shared-memory accounting better than adding RSS values.
- `app.getAppMetrics()` working set identifies Electron's browser, GPU, utility, and renderer processes.
- `ps` process-tree RSS identifies non-Electron helpers. It is diagnostic only because summing RSS double-counts shared pages.

The opt-in `--memory-diagnostics=<path>` mode also records every `BrowserWindow` and `WebContents`, including whether it uses `session.defaultSession`. Normal launches do not install the signal handler or write diagnostic files.

Measurements below are single settled samples from the same packaged build on the same machine. Small run-to-run changes are expected.

## Measured results

| Configuration | Visible physical footprint | Idle physical footprint | Idle Electron working set | Idle UI objects |
| --- | ---: | ---: | ---: | --- |
| Electron tray, no installed features | 158.1 MiB | 99.8 MiB | 308.7 MiB | 0 windows, 0 WebContents |
| Electron tray, Amove | 157.6 MiB | 100.3 MiB | 310.5 MiB | 0 windows, 0 WebContents |
| Electron tray, all features | 166.5 MiB | 107.8 MiB | 318.7 MiB | 0 windows, 0 WebContents |
| Native tray, resident Electron, no features | 160.5 MiB | 105.7 MiB | 299.7 MiB | 0 windows, 0 WebContents |
| Native tray, resident Electron, all features | 172.9 MiB | 119.4 MiB | 317.0 MiB | 0 windows, 0 WebContents |
| Native tray, Electron exited, no features | 159.0 MiB | **13.9 MiB** | 0 MiB | Electron not running |

A separate Bonded navigation run measured 165.3 MiB with the Bonded panel active and 165.5 MiB four seconds after navigating away. The 0.2 MiB increase is measurement noise: unmounting promptly releases component/DOM ownership but does not force V8 or macOS to return pages. Destroying the renderer then reduced physical footprint to 117.5 MiB.

Raw results are written outside the repository under `/tmp/moirasia-memory-results/` during local benchmarking. The final native samples are `native-tray-resident-final.json` and `native-idle-final.json`.

The native AppKit host has about 13.9 MiB physical footprint. Adding it while Electron remains resident increases memory, as expected. Its value comes from allowing the 100–108 MiB no-window Electron process group to exit. In the currently safe featureless case, native-only idle reduces physical footprint by about 145.1 MiB from the visible state, 91.8 MiB versus the resident native-tray variant, and 85.9 MiB versus the earlier Electron-tray variant.

## Results by requested strategy

### Correct memory accounting

Implemented. Physical footprint is the primary result; Electron working set and process-tree RSS remain available for attribution. For example, the native host reports roughly 53 MiB RSS but only 13.9 MiB physical footprint, demonstrating why summed RSS is not the primary metric.

### Surviving WebContents audit

Implemented. Suspending the Menu Bar shell leaves zero windows and zero `WebContents` in all measured variants. The diagnostics also confirmed that every shell `WebContents` uses `session.defaultSession`.

### Renderer contents and lifetime

Implemented. Closing the Menu Bar shell destroys its renderer instead of hiding it. Within a visible shell, only the active feature panel remains mounted; changing tabs unmounts the prior panel. The Bonded panel test found no immediate physical-footprint reduction after unmounting (165.3 versus 165.5 MiB, within noise), because loaded module code and V8 heap pages remain cached. This still bounds live UI state and subscriptions. Destroying the visible shell is the effective reclaim boundary and saves approximately 48–58 MiB physical footprint in the measured builds.

### Feature sidecars

Partially implemented. Shout already owns a native audio helper, and the process inventory now reports it separately. Bonded and Shout controllers and Amove's Electron-owned shelf/hotkey coordinator still live in Electron main. Therefore Electron remains resident whenever any integrated feature is installed. Moving these state owners is required before the all-features native-idle mode can be enabled without breaking background behavior.

### Lazy implementation loading

Already implemented at the bundle boundary: renderer panels and main feature implementations are literal dynamic-import chunks, and uninstalled features are not evaluated. Installed features still register at launch because they currently own persistent monitoring, audio, and hotkey behavior. The measured difference between no installed features and all features while Electron is suspended is about 8–14 MiB physical footprint across the pre-native and native-tray runs; making those modules lazy before moving their background responsibilities would silently disable product behavior.

### Session reuse

Already optimal for the current shell. Diagnostics found one default session and no custom partitions. There is no duplicate Chromium session to remove.

### Native tray and on-demand Electron

The first production slice is implemented for macOS:

- The existing signed Swift application agent now owns an AppKit status item.
- A locked, user-local PID file prevents duplicate menu hosts.
- The host launches or activates the Moirasia app and supports coordinated Quit.
- Packaged Menu Bar mode uses this native host; the Electron `Tray` remains a development fallback when the helper is unavailable.
- If no integrated feature is installed, closing the final UI destroys the renderer, shuts down Electron, and deliberately leaves the native host running. Selecting **Show Moirasia** relaunches Electron on demand.
- If any feature is installed, Electron remains resident until that feature's persistent service has moved to a sidecar.

## Target process architecture

The final macOS architecture has three boundaries:

1. **Native menu host** — long-lived AppKit status item, global shortcut registration, Electron launch/activation, and coordinated quit. It must not import Electron or Node.
2. **Feature services** — long-lived, individually restartable processes for installed features that require background work. Bonded owns network monitoring/firewall synchronization; Shout owns audio state and its audio helper; Amove owns hotkeys and window movement. Services expose authenticated user-local Unix sockets and write state only in their existing feature data directories.
3. **Electron UI client** — owns BrowserWindows, renderer IPC validation, TCC prompts that require the app bundle, and the Amove shelf renderer. It connects to services on demand and exits after its final UI closes.

Socket directories must be mode `0700`, socket files mode `0600`, messages length-prefixed and schema-validated, and peers rejected unless their effective UID matches. Each service remains the single owner of its mutable controller state. Electron proxies renderer requests rather than duplicating that state.

## Implementation sequence and safety gates

1. Extract controller interfaces from Bonded and Shout IPC registration so local and RPC-backed controllers implement the same contract.
2. Add the authenticated Unix-socket protocol and lifecycle manager, then move Bonded. Verify monitoring and firewall rollback across Electron exit/relaunch.
3. Move Shout. Keep the microphone permission prompt in Electron and pass only the resulting permission state to the service. Verify audio continuity and helper cleanup.
4. Move Amove's hotkey/window-movement owner to the native host or a native service. Keep the shelf BrowserWindow in on-demand Electron and add a native `show-shelf` launch command.
5. Allow all installed-feature combinations to use final-window Electron exit only after their services pass crash recovery, upgrade, explicit quit, and stale-socket tests.
6. Benchmark every combination again. Do not retain the native host alongside resident Electron as a memory optimization; that measured variant costs about 11–14 MiB more physical memory.

## Ranking

1. **Native tray with Electron exited: 13.9 MiB idle physical footprint.** Largest measured reduction; currently production-safe when all integrated features are disabled.
2. **Destroy the final renderer while Electron remains: 99.8–107.8 MiB idle physical footprint before the native host is added.** Largest safe reduction when current in-process feature services must remain alive.
3. **Uninstall/lazy-load feature backends: about 8–14 MiB idle physical reduction across all three features.** Useful, but much smaller than eliminating Electron.
4. **Session changes: no opportunity found.** The application already uses one default session.

The all-features target cannot honestly be reported as native-only yet. Until the sidecar migration is complete, terminating Electron would terminate Bonded monitoring, Shout control, and Amove hotkey/shelf ownership.
