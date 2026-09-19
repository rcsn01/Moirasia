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

### Feature service

Implemented for the macOS native-artifact path. `MoirasiaFeatureService.app` owns Bonded monitoring and firewall state, Shout's audio state and helper, and Amove's hotkeys and window movement. Electron owns the UI adapters and Amove's shelf. When the native host and service are available, Electron can exit after its final shell and shelf window closes. When native artifacts are absent, Electron keeps the existing local controllers and remains resident. A present but unusable native runtime fails startup instead of mixing the two owners.

### Lazy implementation loading

Already implemented at the bundle boundary: renderer panels and main feature implementations are literal dynamic-import chunks, and uninstalled features are not evaluated. Installed features still register at launch because they currently own persistent monitoring, audio, and hotkey behavior. The measured difference between no installed features and all features while Electron is suspended is about 8–14 MiB physical footprint across the pre-native and native-tray runs; making those modules lazy before moving their background responsibilities would silently disable product behavior.

### Session reuse

Already optimal for the current shell. Diagnostics found one default session and no custom partitions. There is no duplicate Chromium session to remove.

### Native tray and on-demand Electron

The native feature-service path is implemented for macOS:

- The Swift host owns the AppKit status item, authenticated control socket, Electron launch/activation, and coordinated Quit.
- A locked, user-local host runtime prevents duplicate menu hosts.
- One supervised `MoirasiaFeatureService` process owns the installed Bonded, Shout, and Amove background state. It publishes full snapshots and structured health events and can recover from a service exit.
- Native Shout microphone and Amove Accessibility operations run in the feature-service bundle. Electron displays the returned permission state and sends the existing commands.
- The Electron process owns BrowserWindows, renderer IPC, native UI adapters, and Amove's shelf. Closing the final shell and shelf window lets Electron exit while the host and service remain.
- Missing native artifacts use the existing local controllers. Native bootstrap failure does not fall back to a second local owner.

No all-features native-idle memory sample is recorded here yet. The lifecycle and service smoke tests cover authentication, snapshots, mutations, service startup, and clean shutdown. Benchmark the native feature-enabled combinations before publishing a new memory number.

## Target process architecture

The macOS architecture has three process roles:

1. **Native menu host.** The long-lived AppKit process owns the status item, Electron launch/activation, and coordinated Quit. It does not import Electron or Node.
2. **Native feature service.** One supervised process owns installed-feature background state, runtime leases, and the existing feature data directories. The host forwards authenticated requests and service events.
3. **Electron UI client.** Electron owns BrowserWindows, renderer IPC validation, native UI adapters, and the Amove shelf. It connects to the host when a shell or shelf is needed and can exit after its final UI closes.

Socket directories use mode `0700`, socket files use mode `0600`, messages are length-prefixed and schema-validated, and peers are rejected unless their effective UID matches. Local mode remains an in-process fallback only when native artifacts are absent.

## Implementation sequence and safety gates

The current safety gates are:

1. Select native mode only after authenticated protocol-v1 bootstrap and a complete strict host snapshot.
2. Keep native and local ownership mutually exclusive. Reconnect or restart the native host after a native connection loss; never load a local controller in its place.
3. Keep product persistence, migration, backups, rollback, and snapshot size limits valid in the native modules. Preserve the existing data directories and wire method names.
4. Keep Shout microphone and Amove Accessibility requests in the feature-service process. Local mode retains Electron's existing permission helpers.
5. Verify supervisor restart, stale-client cleanup, explicit Quit, Electron exit/relaunch, and the packaged flow before treating a native memory measurement as final.
6. Benchmark each installed-feature combination again. The existing featureless native sample is not evidence for the all-features case.

## Ranking

1. **Native tray with Electron exited: 13.9 MiB idle physical footprint.** Largest measured reduction; currently production-safe when all integrated features are disabled.
2. **Destroy the final renderer while Electron remains: 99.8–107.8 MiB idle physical footprint before the native host is added.** Largest safe reduction when current in-process feature services must remain alive.
3. **Uninstall/lazy-load feature backends: about 8–14 MiB idle physical reduction across all three features.** Useful, but much smaller than eliminating Electron.
4. **Session changes: no opportunity found.** The application already uses one default session.

The all-features native path is now wired, but this document does not claim a new memory result for it. The service smoke and host end-to-end checks show that feature state survives the native service boundary. Run the packaged benchmark for the installed-feature combinations before changing the measured tables above.
