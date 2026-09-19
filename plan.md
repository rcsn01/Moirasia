# Implementation plan: persistent feature state behind the native feature service

## Status and decision

This plan finalizes architecture-review option 1. It is an implementation plan only. No source implementation changes for this plan have started; the native host, feature service, modules, leases, and UI adapters already exist in the repository.

The decision is to finish the native sidecar path that already exists in the repository. Do not invent a second sidecar design and do not port the three products again from scratch.

After the native host authenticates and passes bootstrap validation, the single native feature service becomes the owner of mutable background state for Bonded, Shout, and Amove. Electron becomes a UI client. It owns BrowserWindows, renderer IPC registration, UI adapters, and Amove's shelf. In native mode, the separate `MoirasiaFeatureService.app` owns Shout microphone and Amove Accessibility authorization because that process performs the TCC-sensitive operations; Electron displays the returned state and initiates the user action through the existing adapter command. When native artifacts are absent, local mode keeps the existing Electron permission helpers and in-process product controllers as the owner. A present but unusable native runtime reports startup failure instead of selecting a local owner.

The seam is the execution-mode boundary in `FeatureRuntime`, not a new product abstraction. Its two adapters are real:

- the local adapter loads the existing product controllers and keeps their current lifecycle;
- the native adapter loads the existing UI-only feature adapters and sends the existing native requests.

That module has enough depth to own the mode decision, installation state, status reconciliation, and adapter lifetime without knowing Bonded's firewall algorithm, Shout's audio engine, or Amove's shelf implementation.

## Verified baseline

The repository baseline is `e0e484a refactor: consolidate feature resource resolution`. The three integrated products remain independent repositories. The existing root plan change and the unstaged Bonded work must be left untouched during implementation.

### What already exists

- `native/moirasia-runtime/Sources/MoirasiaHost/HostApplication.swift` owns the long-lived AppKit host, authenticated Unix socket, Electron launch/activation, coordinated quit, settings forwarding, and UI-state reset after Electron exits.
- `native/moirasia-runtime/Sources/MoirasiaHost/FeatureServiceSupervisor.swift` launches `MoirasiaFeatureService` as a child of the host, forwards requests, publishes service events, and attempts bounded restarts.
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureRuntime.swift` owns installed feature state, native modules, runtime leases, snapshots, start/stop, and retry behavior.
- `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureModules.swift` already wires all three persistent modules:
  - `BondedModule` owns `BondedRuntime`, network monitoring, learned destinations, firewall state, and Bonded settings;
  - `ShoutModule` owns `ShoutRuntime`, the audio engine, driver installer, settings, and microphone permission state;
  - `AmoveModule` owns `AmoveRuntime`, Carbon hotkeys, window movement, shortcut settings, and accessibility state.
- The native modules use the existing `features/<id>` data directories. They do not use Electron's product controllers.
- `src/main/features/runtime.ts` already has separate local and native branches. In native mode it loads `apps/integrated/*/src/main/native-feature.ts`; it does not load the legacy product feature implementation.
- The native product adapters register renderer IPC and subscribe to snapshots. Their `dispose()` methods remove IPC, surface, and shelf state. They do not stop the native service or release its lease.
- `apps/integrated/Amove/src/main/shelf-controller.ts` still owns the shelf `BrowserWindow`, staged files, thumbnails, drag handling, and shelf renderer. The native Amove runtime owns the persistent hotkey and window-movement state.
- `src/main/app-presence.ts` can spawn the native host in packaged macOS mode and can use the Electron tray or the legacy application-agent host as a fallback; the current ownership inference is not reliable after a failed native bootstrap.
- `NativeHostClient` authenticates to the host, preserves the revision-ordered event stream, rejects pending requests on disconnect, and retries a read-only snapshot request once after reconnecting.
- `scripts/smoke-packaged-lifecycle.mjs` contains basic packaged host/service lifecycle checks, but the repository contains no recorded pass output. The current script logs `nativeEndpoint`, `loginItemsHost`, `resourcesService`, `featureArgs`, `authenticated`, `quitSuiteStopsSuite`, `relaunchEndpoint`, `suiteSurvivesElectronDeath`, and `hostSigtermStopsSuite` without failing on every false result; it uses the default settings and does not query feature snapshots after Electron exits.
- Existing Swift tests cover native Amove geometry and shortcuts, Bonded parsing, Shout audio-core behavior, protocol framing, and safe I/O across the three files in `native/moirasia-runtime/Tests/MoirasiaProtocolTests/`.
- Existing TypeScript tests cover native adapter loading, native snapshot subscriptions, install/uninstall, serialization, and disposal.

### What the existing smoke does not prove

The current smoke only exercises process survival and basic protocol access; because it does not fail on every false result, it does not establish any of the following:

- a feature-enabled Electron process exits after its last UI closes;
- Bonded monitoring and firewall state remain correct after Electron death;
- Shout audio and default-input recovery remain correct after Electron death;
- Amove hotkeys still move windows or relaunch the shelf after Electron death;
- local fallback keeps in-process controllers alive when the native runtime is missing;
- a feature-service crash becomes visible in the Electron status model;
- a host crash reconnects without creating a local second owner;
- native settings migration and defaults match the local controllers.

### Current gaps

1. `UiLifetime` invokes its final-window callback whenever Menu Bar mode has no visible shell or shelf. It does not know whether a connected native host can retain the background runtime.
2. `src/main/index.ts` always sets `preserveNativeMenuHost = true` in that callback. If native startup failed and local controllers were selected, the callback can still dispose them while preserving the wrong host. The comment above `window-all-closed` describes a distinction that the callback does not implement.
3. `AppPresence` infers native ownership from the presence of native-host options. A failed native bootstrap can therefore leave the presence object in native mode even after the feature runtime fell back locally.
4. A feature-service crash currently produces a partial `host.snapshotChanged` payload containing `featureService: "error"`. `FeatureRuntime.#applyNativeSnapshot()` ignores any payload without a `features` array, so the UI can continue to report stale `running` state.
5. `FeatureServiceSupervisor.restartCount` is not reset after a healthy restart, and a service that has recovered three times can stop receiving restart attempts later in the same host session. Its termination handler and decoder path can also report one process generation more than once and schedule duplicate restarts.
6. Supervisor restart failures and service health transitions are not represented as a stable status contract. Pending requests fail, but the UI has no authoritative degraded state or recovery transition.
7. `NativeHostClient` has no connection-state subscription for the host-crash case. It can reject requests, but `FeatureRuntime` cannot distinguish a disconnected host from an ordinary feature command failure. It also retains revision state across host generations, and the Electron `before-quit` path does not call `close()`.
8. Native and local settings behavior has not been brought to parity:
   - local Bonded settings migrate versions 1 and 2, import legacy standalone data, preserve backups, and expose a migration notice; native Bonded settings currently decode only version 3 and do not implement that import or migration path;
   - local Shout defaults are `gainDb: 0` and `makeDefaultInput: false`, while `ShoutRuntimeSnapshot` defaults are `gainDb: 12.0` and `makeDefaultInput: true`;
   - native Shout persists a broader runtime snapshot directly, has no validated backup store matching the local store, and lets the first helper state overwrite persisted control settings during startup;
   - native Amove's legacy UserDefaults migration replaces the current settings instead of applying the local merge precedence, does not carry the local warning state, and its first save can fail when no settings file exists;
   - native Bonded backup recovery can replace a valid backup with an invalid primary file, and its `setBlocking` rollback captures the previous value after mutating it;
   - native snapshots must retain Bonded's `migrationNotice`, Amove's `migrationWarning`, and Shout's driver-source and helper-error fields because the existing product decoders expose them to users;
9. Native Shout and Amove TCC calls run in the separate `MoirasiaFeatureService.app` bundle. An Electron `systemPreferences` prompt authorizes the Electron bundle and does not establish authorization for that service process. Native mode must keep microphone and Accessibility request ownership in the service, whose usage descriptions are emitted by `scripts/build-moirasia-runtime.mjs`; the Electron adapters display the service result and initiate the existing commands. Local mode keeps the Electron permission helpers.
10. `docs/architecture/memory-footprint.md`, `docs/architecture/standalone-applications.md`, `CONTEXT.md`, and the top-level `README.md` still describe Electron-owned integrated-feature background state or Electron-bundle permissions. Their current native service and fallback descriptions must be updated after the ownership decision is implemented; no native-idle measurement is recorded in the repository for the feature-enabled cases.
11. `scripts/smoke-host-e2e.mjs` and `scripts/debug-host-trace.mjs` still use `runtime/host.sock`. `scripts/smoke-packaged-lifecycle.mjs` already computes the hashed endpoint, but the three scripts must share the same resolved-user-data and first-16-hex-SHA-256 rule. The old path must not become a second endpoint rule.
12. The existing `nativeHostSnapshotSchema` requires an `appearances` field that `HostApplication` does not send, and its `z.custom` product fields do not validate a bootstrap invariant. Native selection therefore cannot reuse that schema unchanged: the bootstrap check must validate the actual host response's version, revision, settings, and complete known-feature status list without requiring appearances, while product decoders remain responsible for product snapshots.
13. `ControlServer.ClientConnection.send()` closes on a write failure without notifying `ControlServer`, so a stale authenticated client can remain in the client table. `ParentConnection.stop()` stops runtime modules on host-pipe EOF but leaves `MoirasiaFeatureService`'s AppKit run loop alive, orphaning a stopped child after a host crash. `ShellWindowLifecycle` also releases a renderer after `render-process-gone` without notifying `UiLifetime`, leaving the final-window state latched as visible.
14. The current bootstrap constructs a native `AppPresence` before authentication and keeps that object when development falls back to local `FeatureRuntime`, so local controllers can run while presence still suppresses the tray and preserves the native host. Native mode must be selected only after a validated snapshot, and a bootstrap failure after a native endpoint exists must not select a local owner.
15. The current smoke and memory helpers identify native processes by global executable-name matches and use `pkill -f` cleanup. They can kill an unrelated Moirasia host or service; lifecycle and memory checks must scope process discovery and cleanup to the temporary user-data directory and the process IDs created by that run.

## Goals

- Make native feature-service ownership explicit and correct for Bonded, Shout, and Amove.
- Let Electron exit after the last Menu Bar shell or shelf window closes when a connected native host is retaining the runtime.
- Keep native host and feature-service state alive across Electron exit and reconnect it on the next launch.
- Keep the local product controllers intact for development, non-macOS, and missing-native-artifact cases.
- Keep the local and native paths mutually exclusive for a feature. Never run a local controller beside its native module for the same data directory.
- Preserve the `MoirasiaFeature` contract, product IPC channels, feature data directories, runtime leases, native wire method names, native event names, and protocol version except for the minimal lifecycle-status correction described below.
- Preserve Amove's Electron shelf and its renderer behavior. Only persistent hotkey, window-movement, and related background state move behind the native service boundary.
- Make service and host failure visible without silently falling back to a second state owner.
- Make native/local defaults, validation, migration, backup, and user-visible permission results match before each feature is declared sidecar-safe; keep TCC request ownership with the process that performs the native operation.
- Verify the result with interface tests, feature behavior tests, packaged lifecycle tests, and memory measurements.

## Non-goals

- Do not redesign the Unix-socket framing, authentication, request IDs, or revision ordering.
- Do not rename existing native methods such as `bonded.setMonitoring`, `shout.setBoost`, or `amove.performAction`.
- Do not move the Amove shelf `BrowserWindow` into Swift.
- Do not merge the independent integrated-product repositories.
- Do not remove the local `BondedController`, `ShoutController`, or Amove `AppController` (`apps/integrated/Amove/src/main/app-controller.ts`). Standalone applications and fallback mode still need them.
- Do not change unrelated Bonded work already present in its repository.
- Do not combine this work with a broad cross-language contract rewrite or a resource-layout refactor.
- Do not add an Electron renderer-side cache that becomes a second owner of feature state.
- Do not make Electron stay resident merely because a feature is installed after the native service has been selected.
- Do not add an ADR. No ADRs currently exist under `docs/adr/`; the architecture decision belongs in this plan and the existing architecture documentation.

## Execution-mode decision tree

The mode decision must happen before `FeatureRuntime` loads a product implementation. The decision is latched for the Electron process lifetime.

| Startup condition | Feature owner | Final UI behavior | Failure policy |
| --- | --- | --- | --- |
| Non-macOS | Existing in-process product controllers | Electron remains resident | Never attempt native host startup |
| macOS development or packaged build without the native host/service artifacts | Existing in-process product controllers | Electron remains resident | Use the existing tray or application-agent presence path |
| Native artifacts exist, host starts, authentication succeeds, and a strict `host.getSnapshot` bootstrap response succeeds | Native feature service | Electron exits when Menu Bar has no shell or shelf; host and service remain | Latch native mode only after the validated response |
| Native runtime artifacts are present but host startup, authentication, or bootstrap validation fails | No mixed mode | Report the startup error in development and packaged builds | Close the client; do not select local controllers because a native endpoint can own the data |
| Native feature service crashes while the host socket remains connected | Native feature service remains the only owner | Electron exits after its last UI closes because the authenticated host still owns recovery | Host reports error, retries with bounded backoff, and reports recovery |
| Native host connection is lost after native mode was selected | No local replacement owner | Keep Electron alive while a visible UI exists; if no UI exists, wait for reconnect or the next launch | Reconnect or restart the host through the native path; never load local controllers |
| Explicit Quit | Native host and feature service in native mode; local controllers and Electron host in local mode | Coordinated teardown | Stop the feature service and release leases before host exit |

The failure rule is intentional. Missing native capability is a supported fallback. A build that contains native runtime binaries but cannot authenticate or validate its snapshot has a packaging or runtime defect and must not silently claim the lower-memory mode while using a different owner. Development uses the local path only when the native host or feature-service artifact is absent.

Expose a typed testable bootstrap result from the startup helper; do not add a user-facing setting. The result must distinguish `local-capability-missing`, `native-selected`, and `native-startup-failed`. Construct the final `AppPresence` with native options only for `native-selected`; construct a separate local presence for `local-capability-missing`. `nativeClient` being constructed is never sufficient to select native ownership. Selection requires a live authenticated client and a strict initial snapshot.

## Ownership matrix

| State or responsibility | Native mode owner | Local fallback owner | Electron role |
| --- | --- | --- | --- |
| Installed feature flags | Host settings plus native `FeatureRuntime` | `ShellSettingsStore` plus local `FeatureRuntime` | Reads status and sends install/uninstall commands |
| Bonded monitoring, flow history, learned addresses, firewall state, and Bonded settings | `BondedModule` and `BondedRuntime` | `BondedController` | Validates renderer input through the native or local adapter and displays snapshots |
| Shout audio engine, driver state, boost state, source selection, default-input recovery, and Shout settings | `ShoutModule` and `ShoutRuntime` plus its audio helper | `ShoutController` plus its audio helper | Sends the user-initiated command to the selected owner, validates commands, and displays snapshots |
| Amove hotkeys, window movement, shortcut settings, accessibility query, and background status | `AmoveModule` and `AmoveRuntime` | Local Amove controller | Sends commands and displays snapshots |
| Amove shelf window, shelf store, drag state, file thumbnails, and shelf renderer | Not applicable | Electron `ShelfController` in either mode | Sole owner in both modes |
| Renderer IPC handlers and snapshot subscriptions | Native product adapter in Electron | Local product feature in Electron | Registers and removes handlers at the current renderer boundary |
| Runtime lease for a feature | Native `FeatureRuntimeLease` | Existing local lease/controller path | Never acquires a second lease for the same feature |
| Host status item and Electron launch | `MoirasiaHost` | Electron tray or application-agent host | Requests shell/shelf presentation through the host when native |
| TCC authorization and prompt | `MoirasiaFeatureService.app` for native Shout/Amove; Electron product process for local mode | Electron product process | Displays native permission state and sends the user-initiated native command; local adapters keep their existing Electron helpers |
| Feature data files | `userData/features/<id>` | Same suite directory in local mode | Does not duplicate or migrate data on every launch |
| Explicit stop | Host shutdown path | Existing Electron teardown | Distinguishes UI disappearance from explicit Quit |

The native feature service is the single mutable-state owner only after native mode selection. `FeatureRuntime` retains decoded status and the adapters retain UI-specific state, but neither becomes an alternate monitor, audio engine, hotkey registry, settings writer, or lease holder.

## Lifecycle state machine

### States

1. `local-resident`
   - `FeatureRuntime` uses the existing local feature loaders.
   - Installed product controllers run in Electron.
   - Closing the last Menu Bar UI does not call `app.quit`.

2. `native-connecting`
   - `AppPresence` has started or found the native host.
   - `NativeHostClient` is authenticating or waiting for the first valid snapshot.
   - No local product loader runs during this state.

3. `native-ui-attached`
   - The authenticated native host and feature service own background state.
   - Electron has native UI adapters registered for installed and running features.
   - The shell or shelf is visible when the user has opened one.

4. `native-ui-detached`
   - No shell or shelf window is visible.
   - When the host is connected, Electron performs UI and adapter teardown, then exits.
   - The host remains the owner; the feature service, leases, settings, monitors, audio, and hotkeys remain alive or recover under its supervisor.

5. `native-degraded`
   - The host is connected but the feature service is restarting or a feature is in `error` state, or the host connection was lost.
   - Installed state is retained.
   - Electron reports the error, uses the existing feature Retry action for feature restarts, and uses one native host restart/reconnect operation for host loss. It never loads a local controller for the affected feature.

6. `coordinated-quit`
   - Explicit Quit has been requested.
   - The host emits `host.willQuit` before stopping the feature service and terminating Electron.
   - Electron disposes adapters and exits without preserving the host.

### Startup transition

1. Resolve the platform and the presence of both native runtime artifacts.
2. If the artifacts are absent or the platform is not macOS, construct local presence and select `local-resident`.
3. If the artifacts exist, construct a bootstrap presence candidate and start or find the native host.
4. Authenticate `NativeHostClient` and fetch `host.getSnapshot`.
5. Validate the actual response with the strict bootstrap schema: protocol version 1, nonnegative revision, valid shell settings, exactly one status for each known feature ID, and no required `appearances` field.
6. Select native mode only after step 5 succeeds. Pass the selected client and mode into `FeatureRuntime`, `AppPresence`, and `UiLifetime`; close the client and report the startup error for every failed native bootstrap.
7. Hydrate installed and service states, then register native UI adapters before opening a feature page. A bootstrap failure after native artifacts were detected never selects a local owner.

### Final-window transition

`UiLifetime` must receive a `canExitToNativeHost()` predicate in addition to the current presence mode and callback.

- In Dock mode, retain the current behavior and do not exit because the last window closed.
- In Menu Bar mode with a visible shell or shelf, do nothing.
- In Menu Bar mode with no visible shell or shelf and a connected native host, call the final-window callback once.
- In Menu Bar mode with local controllers, do not call the final-window callback. Keep Electron alive so monitoring, audio, and hotkeys do not stop.
- In native mode with a disconnected host, do not exit until the host reconnects. This keeps a visible Electron process available to report recovery while preventing a silent local fallback.

The final-window callback must set the preservation flag only for native mode, close UI adapters, and allow the normal `before-quit` cleanup to run. It must not call `host.quitSuite`. `UiLifetime` must re-evaluate the predicate when the native client reconnects, so a window close that occurred during a disconnect exits exactly once after recovery.

### Electron teardown after UI disappearance

The `before-quit` path must:

1. stop memory diagnostics and UI event subscriptions;
2. stop navigation and native UI event subscriptions;
3. call `presence.preserveNativeHost()` only when native mode was selected and the host is connected;
4. dispose shell windows and the Electron shelf;
5. call `ApplicationController.close()`;
6. call `FeatureRuntime.disposeAll()`, which disposes adapters only in native mode and disposes controllers in local mode;
7. dispose the embedded host;
8. close the client transport as Electron exits;
9. call `app.quit()` without sending `host.quitSuite` when the exit was caused by final UI disappearance.

The native adapter disposal contract is important. `disposeAll()` must remove renderer IPC handlers and subscriptions but must not call `host.setFeatureInstalled(false)`, stop a native module, release a native lease, or delete feature data.

### Explicit Quit transition

- Native status-item Quit calls `HostApplication.shutdown()`.
- The host broadcasts `host.willQuit` and Electron marks the quit as coordinated.
- The host stops the feature service, which stops Bonded monitoring, restores Shout's default input, unregisters Amove hotkeys, and releases leases.
- The host terminates Electron and then exits itself.
- Electron disposes its UI adapters and does not preserve the native host.

If an Electron-side Quit request arrives first, Electron sends `host.quitSuite`, waits for the host response or a bounded failure path, and then completes local cleanup. A failure to contact a host must not cause a local controller to start during teardown.

### Relaunch transition

1. The native host sees that Electron exited and sends `host.setUiState` with `mainFocused: false` and `shelfVisible: false` through the service.
2. A later Electron launch finds the existing authenticated endpoint rather than spawning a second host.
3. `FeatureRuntime.syncAtLaunch()` reads `host.getSnapshot` before opening a feature page.
4. Native adapters are registered for installed features. The adapters read the service snapshots, not local settings files.
5. Amove hotkeys continue to work during the Electron gap. A shelf hotkey launches Electron with `--moirasia-open=shelf`; the shelf remains an Electron `BrowserWindow`.
6. The restored page comes from the host/UI state and the existing `restorablePage()` rules. It must not mark a feature installed merely because a renderer was last open.

## Failure and recovery policy

### Feature-service crash

The host remains the supervisor and the Unix socket remains valid.

- Reject pending feature requests with a stable `feature_service_crashed` or `feature_service_unavailable` error.
- Publish `host.snapshotChanged` with a service-health status that Electron understands.
- Keep each feature's installed flag. Mark installed features `error` with the service error while the service is down. Do not mark them uninstalled and do not load local controllers.
- Retry the service with bounded backoff. Reset the restart counter after a successful launch and a valid initial snapshot. Do not stop retrying because of historical crashes after a healthy restart.
- On recovery, publish a full snapshot. `FeatureRuntime` replaces its native status map from that snapshot, clears the service error, and loads any adapter that failed before the service reached `running`.
- Existing adapters remain registered while the service restarts. Requests can fail during the gap, but the adapter receives later feature snapshots and never creates a second controller.
- If the service reaches its terminal restart limit, keep native mode selected and report a persistent error. The Features screen's native Retry action uses the existing `host.retryFeature` method. When the service is terminally unavailable, the host asks the supervisor to reset its bounded restart state and launch one generation, waits for a bounded time for a valid full snapshot, and then forwards the feature retry. When a generation is already starting or in bounded backoff, the host joins that recovery instead of launching another one or resetting its budget. When the service is running, it forwards the retry directly. It never starts a local controller.

### Host crash or disconnect

- `NativeHostClient` must publish one local connection-state transition when the authenticated socket closes and reject pending requests. A new authenticated socket is a new host generation: reset revision filtering and require a full snapshot before applying later events.
- `FeatureRuntime` marks installed native features `error` with a host-disconnected error and keeps native mode latched.
- If Electron is still running, `AppPresence` performs one bounded native-host restart/reconnect sequence at a time. Under the native host lock, it verifies and clears only an endpoint proven stale for the failed generation, then asks the lock to arbitrate a new spawn; it never spawns duplicates.
- A successful reconnect always begins with a full snapshot. It does not call local feature loaders. If the final UI disappeared during the disconnect, `UiLifetime` exits only after this reconnect succeeds.
- If reconnect fails, keep the error visible and keep Electron resident when it has no UI; the next app launch can retry the native bootstrap. No local owner is created.
- If Electron exits normally, the native host remains the feature service's parent and the service continues running. If the host itself crashes, `ParentConnection` receives pipe EOF, stops all modules, and terminates the feature-service process. The next Electron launch starts or finds the host and the service reloads persistent settings from the existing data directories.

### Renderer or adapter failure

A native adapter registration failure is a UI failure, not permission to start the local controller. Keep the native status installed, retain the adapter load error, and let the Features screen's existing Retry action or an app relaunch re-register the adapter. Product IPC registration must continue to validate sender identity and remove every handler on failure or disposal.

### Service status payload

Keep the `host.snapshotChanged` event name and protocol version. Make the smallest lifecycle correction needed to formalize the existing partial event:

```json
{
  "featureService": {
    "state": "error",
    "error": "feature service exited",
    "restartCount": 1
  }
}
```

Every non-health `host.snapshotChanged` payload is a full snapshot containing the current `features` array, product snapshots, and the current shell `settings` envelope. `HostApplication` must replace its current settings-only broadcasts with a full service snapshot and inject current shell settings before broadcasting; it must not emit `settings.snapshot()` as a feature snapshot. A degraded event contains only `featureService`. During the transition, Electron accepts the current string form `{"featureService":"error"}` and normalizes it to the structured status; the corrected native host emits the structured form. `state: "error"` always includes a bounded `error` string, while `starting`, `running`, and `stopped` omit it. No request method, feature method, event name, framing rule, authentication rule, or protocol version changes.

`FeatureRuntime` must treat a full snapshot as authoritative for the three known feature IDs, rather than merging stale entries forever. A service-health event with `state: "error"` changes installed features to `error` state without changing `installed`; `starting`, `running`, and `stopped` health events update service health only and never change the installation map. A service recovery full snapshot replaces the status map and clears the service error. A feature-start failure publishes a full snapshot with that feature's complete `error` status instead of a feature-only fragment.

## Settings, data, and permission parity

### Shared data rules

- Keep `userData/features/amove`, `userData/features/bonded`, and `userData/features/shout` unchanged.
- Keep existing standalone directories and legacy import locations unchanged.
- Use mode `0700` directories and mode `0600` settings, token, and backup files.
- Preserve atomic temporary-file writes and the exact backup names in each local store: Bonded `settings.backup.json`, `settings.v1.json`, and `settings.v2.json`; Shout and Amove `settings.json.backup`.
- Never delete standalone data during import. Copy or merge it once, record completion, and show the existing warning or migration notice.
- Do not make a migration run once in the local path and again in the native path. The persisted migration marker is the authority.

### Bonded parity work

Before Bonded is declared native-safe:

1. Bring native `BondedSettingsStore` to the local store's supported version behavior.
   - Accept current version 3 with the same field validation and rule limits.
   - Migrate version 1 and version 2 to version 3 using the same safe-clearing behavior.
   - Preserve the local `settings.v1.json`, `settings.v2.json`, and `settings.backup.json` backup semantics exactly.
   - Import the legacy standalone `Bonded` settings directory when the suite directory is absent, and force `blockingEnabled` off on import.
2. Match local rule identity and duplicate handling. Do not let malformed or duplicate rules enter the native blocker.
3. Include the same migration notice in the native Bonded snapshot so the existing renderer can explain an import or safe reset.
4. Verify startup clears stale active blocking state before monitoring resumes, and verify the firewall rollback path remains the same on command failure. Capture the previous blocking value before mutating native settings so a failed helper operation restores the actual prior state.
5. Keep the local `BondedController` unchanged.

### Shout parity work

1. Set native defaults to the local defaults: `gainDb: 0`, `limiterEnabled: true`, `makeDefaultInput: false`, `sourceMode: follow-default`, and boost disabled.
2. Load only the persisted settings fields as settings. Treat meter, active source, capture, device, and current default-input fields as runtime state.
3. Add validated load, backup recovery, and atomic write behavior matching the local `SettingsStore`. Preserve the current `features/shout/settings.json` path.
4. Verify startup recovery never leaves Shout Mic as the default input after an interrupted session. Verify explicit stop disables boost and restores the prior physical input.
5. Keep native microphone authorization in `MoirasiaFeatureService.app`, because `AVCaptureDevice` and the audio helper run there:
   - the native Shout adapter sends the existing `shout.setBoost` command after the user toggles Boost;
   - the native module requests the service bundle's microphone permission on first enable when its state is `not-determined`, using the usage description emitted by `scripts/build-moirasia-runtime.mjs`;
   - the native snapshot reports `granted`, `denied`, or `not-determined`, and a denial returns the existing product error without enabling boost;
   - startup resume restores boost only when the service's native permission state is already `granted`.
6. Keep local `ShoutController` permission behavior unchanged for local mode and standalone products.
7. Verify the native snapshot still decodes through the existing product contract, including driver, permission, source, and helper error fields.

### Amove parity work

1. Keep `AmoveRuntime` as the owner of settings, hotkey registration, window movement, and status while native mode is active.
2. Match the local settings merge and warning behavior for pending macOS UserDefaults migration. Reuse `AmoveLegacyMigration`, merge imported values only into fields still at local defaults, preserve explicit suite settings, persist `migrationWarning`, and mark the migration completed or completed-with-warnings.
3. Keep Accessibility authorization in `MoirasiaFeatureService.app`, because `AXIsProcessTrustedWithOptions` and the global hotkey registry run there. The Electron adapter sends the existing `amove.requestAccessibility` command; the service prompts its own bundle and returns the resulting state. Do not rename the command.
4. Keep the native snapshot's `shelfVisible` false. Shelf visibility belongs to `ShelfController` and is reported to the host with `host.setUiState`.
5. On Electron exit, the host must reset `mainFocused` and `shelfVisible` so a later hotkey is not suppressed by stale UI state.
6. Verify a hotkey while Electron is absent launches the shelf, and a hotkey while the shelf is visible toggles it without creating another window.

## Exact file-by-file change list

The following list is the implementation boundary. Files not listed remain unchanged; all required lifecycle, persistence, permission, socket, and documentation changes are listed explicitly.

### Root Electron runtime

- `src/main/index.ts`
  - Implement the typed bootstrap result and construct the final native or local `AppPresence` only after that result is known.
  - Select native ownership only after authentication and an initial strict snapshot; report every failure after artifact detection instead of selecting a local owner.
  - Pass the selected ownership mode into `FeatureRuntime` and `UiLifetime`.
  - Make the final-window callback preserve the host only in native mode and explicitly close the client transport during Electron teardown.
  - Keep explicit Quit separate from final-window UI disappearance.
  - Subscribe to host connection and feature-service health, restart only through the native path, and prevent local loader selection after native mode has latched.
  - Route the existing `installFeature(id)` Retry action to `host.retryFeature` when native status is installed/error; use `host.setFeatureInstalled` only for a true install or uninstall.
  - Keep the existing native resource arguments and feature contexts unchanged.

- `src/main/ui-lifetime.ts`
  - Add a `canExitToNativeHost()` decision and a `nativeHostAvailabilityChanged()` recheck to the constructor interface.
  - Keep shell/shelf tracking and the once-only exit guard.
  - Add tests for native connected exit, local fallback retention, disconnected-host retention followed by reconnect, shelf-only transitions, and render-process loss.

- `src/main/app-presence.ts`
  - Keep native ownership truthful by using a native-configured instance only after successful bootstrap and a local-configured instance for the capability-missing fallback.
  - Add an abort operation that terminates only a native host child spawned for a failed bootstrap; do not kill a pre-existing locked host.
  - Add a bounded host restart/reconnect operation for an already selected native mode. Under the native host lock, verify the failed generation's child/lock identity is stale before unlinking its endpoint, then ask the lock to arbitrate a new spawn; never unlink a live host endpoint.
  - Preserve PID locking, hashed host endpoint lookup, native feature arguments, and existing tray/application-agent fallback behavior.

- `src/main/shell-window.ts`
  - Notify `UiLifetime` after a renderer-process loss releases the shell generation, so the final-window decision cannot retain a destroyed shell as visible.
  - Preserve the existing close, suspend, navigation-guard, and renderer recreation behavior.

- `src/main/paths.ts`
  - Keep the current hashed temp-directory endpoint implementation and correct its comments to remove the obsolete `runtime/host.sock` rule.

- `src/main/ipc.ts`
  - Keep native settings mutations on the host methods and local settings mutations on the local path; validate and cache only the actual host snapshot settings envelope.

- `src/main/memory-diagnostics.ts`
  - Keep the existing opt-in diagnostics and native-idle `closeWindow` callback. The process-scoped checks belong in the benchmark script, not in the diagnostics collector.

- `src/main/features/runtime.ts`
  - Keep the local and native adapters behind the current `MoirasiaFeature` interface.
  - Latch native mode after successful bootstrap and forbid a local fallback after that point.
  - Reconcile full snapshots authoritatively and ignore settings-only lifecycle payloads from an uncorrected host without changing feature status.
  - Consume structured and transitional feature-service health payloads separately; health events update the service-error overlay without replacing authoritative feature entries or loading adapters.
  - Preserve installed state across service errors and trigger adapter loading only after a recovered full snapshot.
  - Route installed-feature retries through `host.retryFeature`, make retry idempotent for an already-running module, and keep native `disposeAll()` UI-only.
  - Keep local disposal behavior unchanged.
  - Preserve install/uninstall sequencing and runtime lease ownership.

- `src/main/native-host/client.ts`
  - Add a connection-state subscription for authenticated connect, disconnect, and reconnect, emitting each transition once and never emitting after `close()`.
  - Preserve the current read-only retry behavior and do not automatically replay mutations.
  - Keep pending-request rejection, authentication, message limits, and revision ordering.
  - Reset the decoder, buffer, authentication flag, pending requests, and revision gate safely between host generations.

- `src/shared/native-host-contracts.ts`
  - Add the typed feature-service health payload and connection-state types.
  - Replace the bootstrap snapshot schema with a strict envelope matching the actual host response: version, revision, shell settings, and exactly one status for each known feature; validate lifecycle health as its separate `host.snapshotChanged` event payload and do not require `appearances`.
  - Decode `host.snapshotChanged` as either a full snapshot or a feature-service health event, accepting only the transitional string health form in addition; reject settings-only and feature-only payloads as malformed lifecycle events.
  - Keep product snapshot validation at each product adapter decoder, keep protocol version 1 and existing method/event names, and reject malformed lifecycle payloads without exposing filesystem paths in errors.

- `src/main/application-controller.ts`
  - No ownership change. Confirm that it reads the reconciled `FeatureRuntime` status and does not start or stop product controllers itself.

- `packages/desktop-shell/src/native-feature-adapter.ts`
  - Make no state-owner change. Keep the existing command suffix validation, payload decoders, renderer authorization, rollback, and idempotent disposal.
  - Keep lifecycle transport failures in the root client and assert in `tests/native-feature-adapter.test.ts` that disposal never sends an ownership-changing method.

### Integrated product adapters and local paths

These files live in independent product repositories. Make changes only in the product repository that owns each file, and do not overwrite existing unrelated Bonded changes.

- `apps/integrated/Bonded/src/main/native-feature.ts`
  - Keep this as an IPC and snapshot adapter.
  - Decode the native `migrationNotice` field through the existing product contract.
  - Add a disposal test proving it never sends a native stop or uninstall command.

- `apps/integrated/Bonded/src/main/settings-store.ts`
  - Treat current behavior as the local reference implementation for native parity.
  - Do not remove legacy import, version migration, backups, or safe blocking reset.

- `apps/integrated/Bonded/src/main/controller.ts`
  - No migration to Electron-side background ownership is planned. Keep it for local and standalone execution.

- `apps/integrated/Shout/src/main/native-feature.ts`
  - Keep the existing native method names and product validation; the service owns the native microphone prompt and returns its permission state.
  - Add a disposal and denied-permission-result test without adding an Electron-side TCC owner.

- `apps/integrated/Shout/src/main/settings-store.ts`
  - Remain the local settings reference. Add explicit parity tests for defaults, backup recovery, and invalid data.

- `apps/integrated/Shout/src/main/controller.ts`
  - No native ownership change is planned for this local controller.

- `apps/integrated/Amove/src/main/native-feature.ts`
  - Keep the native service as the Accessibility prompt owner and return its authorization result through the existing command.
  - Keep `SuiteAmoveController` as the owner of shelf windows and UI-state reporting only.
  - Add tests for shelf disposal, UI-state reset, permission-result propagation, and hotkey-triggered shelf launch.

- `apps/integrated/Amove/src/main/app-controller.ts`
  - Keep `AppController` as the local fallback and standalone owner. Do not load it for native suite ownership.

- `apps/integrated/Amove/src/main/shelf-controller.ts`
  - Keep the `BrowserWindow`, shelf data, drag lifecycle, thumbnails, and renderer exactly in Electron.
  - Change only what is required to make disposal and relaunch behavior observable in lifecycle tests.

- `apps/integrated/Amove/src/main/settings-store.ts` and `apps/integrated/Amove/src/main/legacy-migration.ts`
  - Use the local merge and warning behavior as the parity reference for the native implementation.
  - Do not change standalone app data ownership.

### Native host and feature service

- `native/moirasia-runtime/Sources/MoirasiaHost/HostApplication.swift`
  - Track the single feature-service process health and publish structured `host.snapshotChanged` lifecycle payloads.
  - Publish `starting` when a generation launches, `running` after its first valid full snapshot, and `error` on crash, failed restart, or terminal restart exhaustion; publish `stopped` only during coordinated host shutdown.
  - Replace settings-only lifecycle broadcasts with a service full snapshot plus injected shell settings.
  - Route `host.retryFeature` through the supervisor's explicit retry when the service is terminally unavailable, join an existing starting/backoff recovery, and forward it after a bounded wait for a valid recovery snapshot.
  - Keep installed flags unchanged in health events.
  - Keep host UI-state reset, Electron launch arguments, authentication, and coordinated quit behavior.
  - Guard shutdown, health, and restart callbacks against races with explicit Quit.

- `native/moirasia-runtime/Sources/MoirasiaHost/FeatureServiceSupervisor.swift`
  - Make each launched process generation explicit so one termination or decoder failure cannot schedule duplicate restarts.
  - Reset the restart count after the generation emits a valid full snapshot; count launch failures against the same bounded limit.
  - Reset the line decoder and pending request state for each generation.
  - Report `starting`, bounded backoff, terminal failure, and recovery through the host callback.
  - Expose an explicit retry for `host.retryFeature` that joins an existing starting/backoff generation, or resets terminal restart accounting and launches one service generation under the host lock, then waits for its valid full snapshot before forwarding the request; bound the wait and never launch a duplicate generation.
  - Preserve the existing request forwarding and error codes; add only the lifecycle health callback.

- `native/moirasia-runtime/Sources/MoirasiaHost/ControlServer.swift`
  - Invoke the disconnect callback exactly once when EOF, protocol failure, server shutdown, or a send/write failure closes a client.
  - Remove failed authenticated clients from the table so stale clients cannot suppress Electron relaunch.
  - Preserve authentication, framing, and request authorization.

- `native/moirasia-runtime/Sources/MoirasiaHost/ElectronLauncher.swift`
  - Keep Electron activation and termination observation.
  - Ensure the application-exit callback is emitted once per Electron generation and remains responsible only for resetting Amove UI policy; suppress that callback after coordinated host shutdown.

- `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureRuntime.swift`
  - Keep native modules, installed settings, leases, snapshots, and retry operations as the service owner.
  - Stop a partially started module and release its lease when feature start throws.
  - Ensure feature-start failures publish a complete snapshot with the affected feature's `error` status.
  - Ensure a successful retry clears the module error and publishes a complete snapshot; if the module is already running, return its current status without starting it a second time.
  - Preserve `features/<id>` data paths and existing feature method dispatch.

- `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureModules.swift`
  - Preserve the existing Bonded, Shout, and Amove module names and wire methods.
  - Keep microphone and Accessibility prompt calls in the feature service bundle, retain service-side status and command validation, and return denial through the existing product result.
  - Keep Amove shelf state out of the native snapshot owner.

- `native/moirasia-runtime/Sources/MoirasiaFeatureService/ParentConnection.swift`
  - On parent-pipe EOF, stop all modules, release leases, close the reader, and terminate the feature-service process so a crashed host cannot leave an orphaned stopped service.
  - Keep explicit coordinated shutdown idempotent and preserve protocol-error handling.

- `native/moirasia-runtime/Sources/MoirasiaFeatureService/FeatureModule.swift`
  - Keep the module interface small: start, stop, snapshot, command handling, and event hooks.
  - Add no product-specific Electron dependency.

- `scripts/build-moirasia-runtime.mjs`
  - Keep `NSMicrophoneUsageDescription` and `NSAccessibilityUsageDescription` on the separate `MoirasiaFeatureService.app` bundle because native Shout and Amove request those permissions there.
  - Keep the host bundle free of feature-service TCC ownership.

- `native/moirasia-runtime/Sources/BondedRuntime/SettingsStore.swift`
  - Implement the local Bonded version, import, validation, migration notices, and backup semantics described above.
  - Recover a valid backup without copying an invalid primary over it, preserve the v1/v2 backup files, and keep atomic writes and file permissions.

- `native/moirasia-runtime/Sources/BondedRuntime/BondedRuntime.swift`
  - Add `migrationNotice` to the native snapshot.
  - Capture the previous blocking value before mutation so firewall rollback restores the actual prior state.
  - Preserve monitor, firewall rollback, and shutdown behavior.

- `native/moirasia-runtime/Sources/ShoutRuntime/ShoutRuntime.swift`
  - Correct defaults, separate persisted control fields from transient fields, and align validated backup/recovery behavior.
  - Apply persisted gain, limiter, source, default-input, and boost settings after the helper has initialized so its default first state cannot overwrite the persisted control values.
  - Keep microphone authorization in the feature-service bundle and return denied/not-determined state through the existing service command.

- `native/moirasia-runtime/Sources/ShoutRuntime/SettingsStore.swift`
  - Replace the directory-only helper with the validated settings/backup store for the persisted Shout fields at `features/shout/settings.json`.

- `native/moirasia-runtime/Sources/ShoutRuntime/AudioEngine/ShoutEngine.swift` and `native/moirasia-runtime/Sources/ShoutAudioCore/HelperProtocol.swift`
  - Preserve the realtime algorithm and helper wire shape.
  - Keep helper defaults at `0 dB`, limiter enabled, and default-input switching disabled; expose the control-plane initialization needed for `ShoutRuntime` to apply persisted settings after helper startup.

- `native/moirasia-runtime/Sources/AmoveRuntime/AmoveRuntime.swift`
  - Keep hotkey registration, window movement, settings, and status in the native runtime.
  - Merge legacy values into explicit suite settings without replacing them, persist migration warning/completion state, and keep the existing service-side Accessibility prompt behavior.

- `native/moirasia-runtime/Sources/AmoveRuntime/SettingsStore.swift` and `native/moirasia-runtime/Sources/AmoveRuntime/LegacyMigration.swift`
  - Match the local merge, pending marker, warning, backup recovery, and atomic-save behavior without deleting legacy preferences.
  - Make first save succeed when no primary file exists and preserve a valid backup during recovery.

- `native/moirasia-runtime/Sources/MoirasiaProtocol/Protocol.swift`
  - Update the endpoint comment to the hashed temp-directory path used by both implementations.
  - Keep the JSONValue payload envelope, framing, size limits, strict envelopes, authentication assumptions, and protocol version 1 unchanged; the health payload does not require a new Codable type.

### Tests and scripts

- `tests/ui-lifetime.test.ts`
  - Cover native connected exit, local fallback retention, disconnected-host retention followed by reconnect, shelf-only close, and once-only callback behavior.

- `tests/shell-window.test.ts`
  - Cover renderer-process loss notifying the final-window callback after the shell generation is released.

- `tests/app-presence.test.ts`
  - Cover capability-missing local construction, failed-bootstrap child cleanup without killing a pre-existing host, native host preservation, bounded host restart, stale-endpoint handling, and no duplicate spawn.

- `tests/feature-runtime.test.ts`
  - Cover native mode latching, structured and transitional service-error payloads, connection loss, full recovery snapshots, authoritative status replacement, no local fallback, adapter-only disposal, and Retry after service startup failure.

- `tests/native-host-client.test.ts` (new)
  - Cover authentication, one-shot connection transitions, disconnect notifications, pending rejection, read-only reconnect, mutation non-replay, revision reset between host generations, message limits, and close idempotence.

- `tests/native-host-contracts.test.ts`
  - Add strict bootstrap-snapshot cases with no `appearances` field, complete known-feature status validation, structured health decoding, backward-compatible string health normalization, and rejection of settings-only payloads as full snapshots.

- `tests/native-feature-adapter.test.ts`
  - Keep current transport and IPC seam tests. Assert that native adapter disposal does not invoke an ownership-changing method.

- `tests/native-host-client.test.ts` is new root boundary coverage; `tests/native-host-contracts.test.ts` is expanded. Preserve all existing root tests, including `tests/shell-window.test.ts`.

- Product settings and adapter tests in each integrated repository
  - Bonded: add version 1/2 migration, legacy import, backup recovery, duplicate identity, previous-blocking-value rollback, migration-notice, and native adapter disposal tests.
  - Shout: add default/persistence-order, backup recovery, invalid-data, service permission-result, and native adapter disposal tests.
  - Amove: add merge-precedence, warning/backup recovery, service Accessibility-result, shelf disposal, UI-state reset, and hotkey-triggered shelf-launch tests in the existing `app-controller`, `settings-store`, `native-feature`, and `shelf-controller` test files.
  - Preserve all pre-existing tests and changes in those repositories, especially the six unstaged Bonded files.

- `native/moirasia-runtime/Tests/MoirasiaProtocolTests/NativeRuntimeTests.swift`
  - Add Bonded settings migration, legacy import, backup recovery, blocking rollback, and migration-notice tests.
  - Add Shout default, service permission-result, backup, persisted-settings application order, and default-input recovery tests.
  - Add Amove migration merge, warning, first-save, Accessibility, and UI-state behavior tests.
  - Keep tests at runtime/module interfaces rather than private helpers.

- `native/moirasia-runtime/Tests/MoirasiaProtocolTests/ProtocolTests.swift`
  - Keep protocol framing/version tests and add structured lifecycle-status payload cases.

- `native/moirasia-runtime/Tests/MoirasiaProtocolTests/SafeIOTests.swift`
  - Preserve the existing safe-I/O coverage unchanged; host client removal and write-failure callback behavior is covered by the host smoke and `native/moirasia-runtime/Sources/MoirasiaHost/ControlServer.swift` integration path.

- `scripts/smoke-host-e2e.mjs`
  - Derive the hashed socket path using the same resolved-user-data rule as the packaged smoke: temp directory plus the first 16 hexadecimal SHA-256 characters of resolved user data.
  - Write explicit settings for the all-three case, verify Bonded, Shout, and Amove statuses and snapshots, and scope all child-process discovery to the temporary user-data path.
  - Kill the direct child `MoirasiaFeatureService` process by PID, assert a structured service `error`, assert bounded recovery and a full `running` snapshot, exercise install off/on and the existing Retry request, then perform coordinated shutdown.

- `scripts/debug-host-trace.mjs`
  - Use the same hashed endpoint derivation as the other host clients instead of `runtime/host.sock`.
  - Keep its authenticated snapshot trace and terminate only the host process created by the script.

- `scripts/smoke-packaged-lifecycle.mjs`
  - Run representative explicit settings cases: no installed feature, Amove only, Bonded only, Shout only, and all three; do not expand every crash scenario across all eight flag combinations.
  - Assert every logged condition instead of only printing booleans, and identify host/service/helper processes by the temporary user-data path and captured PIDs.
  - After Electron exits, query the authenticated host for the full snapshot and each installed feature snapshot to prove state remains available; assert that uninstalled features are absent from the installed set.
  - Keep explicit `host.quitSuite`, Electron-termination survival, and host `SIGTERM` coverage.

- `scripts/smoke-packaged-panels.mjs`
  - Keep the packaged renderer smoke for the three feature panels, write all three feature flags explicitly, and scope polling and cleanup to its temporary user-data directory and captured process IDs.
  - Assert that each panel loads its existing marker without a missing-handler error before cleanup.

- `scripts/benchmark-electron-memory.mjs`
  - Measure native-idle cases for no features, Amove, Bonded, Shout, and all three features.
  - Record Electron process count, native process count, BrowserWindows, WebContents, physical footprint, working set, and process-tree RSS.
  - Scope native process discovery and cleanup to the benchmark's temporary user-data directory, and fail if native-idle claims success while any Electron process or renderer remains alive.

- `docs/architecture/memory-footprint.md`
  - Replace the stale statement that integrated feature state still lives in Electron.
  - Distinguish historical resident-Electron measurements from verified native-idle measurements.
  - Document the one shared feature-service process, ownership matrix, fallback mode, crash policy, service-bundle TCC ownership, and the fact that the shelf remains Electron-owned.
  - Add representative native-idle measurements only after the packaged smoke and memory benchmark pass; do not claim unmeasured configurations.

- `docs/architecture/standalone-applications.md`
  - Distinguish local/standalone product controllers from native suite UI adapters and the shared native feature service.
  - State that native runtime leases and persistent background state belong to the service in native mode, while the Electron product controllers remain for local and standalone paths.
  - Keep the shelf and renderer-surface ownership description accurate.

- `CONTEXT.md` and `README.md`
  - Update the glossary and top-level architecture/permission statements to distinguish the native service bundle from Electron permissions and to describe native-idle versus local-resident behavior.

## Rollout sequence and gates

The native modules already exist, but implementation must still roll out by feature so parity failures stay local and diagnosable.

### Phase 0: execution-mode seam and lifecycle correction

- Add the typed native bootstrap result and select local mode only when native capability is absent; never mix a native endpoint with local controllers.
- Fix `UiLifetime`, `ShellWindowLifecycle`, and `preserveNativeMenuHost` so local fallback never loses its Electron owner and a destroyed renderer cannot keep the final-window state latched.
- Add connection-state and feature-service health handling, host-generation revision reset, and native-only reconnect.
- Fix supervisor generation races, stale ControlServer clients, parent-EOF orphan cleanup, and failed-start lease release.
- Keep all three existing native modules behind the same interface, but do not declare the features complete yet.

Gate:

- Local development and non-macOS tests prove controllers remain alive.
- Native mode tests prove no local loader runs.
- Final-window tests distinguish UI disappearance from explicit Quit.
- Service error and recovery tests prove installed state does not become uninstalled.

### Phase 1: Bonded

- Complete native Bonded settings migration and snapshot parity.
- Verify network monitor, observed applications, firewall helper operations, blocking rollback, and lease ownership.
- Run a packaged case with only Bonded installed.

Gate:

- Kill Electron while the monitor is active. Query Bonded through the host and confirm monitoring state and rules remain available.
- Relaunch Electron and confirm the same snapshot and renderer behavior.
- Kill and restart the feature service. Confirm the UI reports error then recovery without starting `BondedController`.

### Phase 2: Shout

- Correct native defaults and persistence, including applying persisted control settings after helper initialization.
- Keep microphone authorization in the feature-service bundle while the Electron adapter initiates the user-visible command and displays the returned state.
- Verify default-input recovery, helper shutdown, driver status, source selection, and permission-denied behavior.
- Run the packaged Shout-only case and verify the combined Bonded/Shout ownership through the native runtime and adapter tests.

Gate:

- Boost and default-input state survive Electron exit while the service remains alive.
- Explicit Quit restores the physical default input and stops the audio path.
- A denied service-bundle microphone permission produces a user-visible error and leaves boost disabled.
- Service restart does not leave Shout Mic selected as the default input.

### Phase 3: Amove

- Complete native settings merge and accessibility prompt ownership.
- Verify hotkeys and window movement with no Electron process.
- Verify the shelf remains an Electron window and uses the existing renderer/preload resource paths.

Gate:

- A global shelf hotkey launches Electron on demand.
- A second hotkey while the shelf is visible toggles the existing shelf rather than creating a duplicate.
- Window movement continues while Electron is absent.
- Electron exit resets the native UI policy.

### Phase 4: representative matrix and release hardening

Run the native packaged lifecycle matrix for no installed feature, Amove only, Bonded only, Shout only, and all three features. Run the local-capability-missing fallback separately. Unit and native runtime tests cover the pairwise status/install combinations; do not repeat every crash scenario for all eight flag combinations. For each native packaged case verify:

- launch and authenticated strict snapshot;
- installed/running/error status;
- final-window Electron exit;
- native host, service, and required helper survival;
- direct post-Electron-exit snapshots;
- relaunch and UI hydration;
- explicit Quit;
- service crash and bounded recovery;
- host crash and reconnect behavior;
- no duplicate leases or local controllers;
- settings persistence and migration behavior.

For the separate local-capability-missing case verify local controllers load, the final Menu Bar UI does not quit Electron, and no native host or feature-service owner is created.

Call the architecture complete for all-features native idle only after the representative matrix and memory measurements pass.

## Verification commands

Run the narrowest relevant checks after each phase, then the broader suite.

1. Root TypeScript unit and type checks:
   - `pnpm typecheck`
   - `pnpm test -- tests/ui-lifetime.test.ts tests/shell-window.test.ts tests/app-presence.test.ts tests/feature-runtime.test.ts tests/native-host-client.test.ts tests/native-host-contracts.test.ts tests/native-feature-adapter.test.ts`
   - `pnpm test`
2. Native runtime checks:
   - `swift test --package-path native/moirasia-runtime`
   - `pnpm runtime:build`
3. Product repository checks:
   - Amove: `pnpm -C apps/integrated/Amove typecheck`, `pnpm -C apps/integrated/Amove test`, and `pnpm -C apps/integrated/Amove test:rust`;
   - Bonded: `pnpm -C apps/integrated/Bonded typecheck` and `pnpm -C apps/integrated/Bonded test`;
   - Shout: `pnpm -C apps/integrated/Shout typecheck` and `pnpm -C apps/integrated/Shout test`.
4. Staged protocol smoke:
   - `pnpm runtime:build`
   - `node scripts/smoke-host-e2e.mjs`
   - `node scripts/debug-host-trace.mjs`
5. Packaged lifecycle and panel smoke:
   - `pnpm package:mac`
   - `node scripts/smoke-packaged-lifecycle.mjs`
   - `node scripts/smoke-packaged-panels.mjs`
6. Memory checks:
   - `pnpm memory:benchmark --features= --native-idle`
   - `pnpm memory:benchmark --features=amove --native-idle`
   - `pnpm memory:benchmark --features=bonded --native-idle`
   - `pnpm memory:benchmark --features=shout --native-idle`
   - `pnpm memory:benchmark --features=amove,bonded,shout --native-idle`
   - capture each report outside the repository and update the architecture document with measured values only after the process-scope and UI-object assertions pass.
7. Browser or packaged UI verification for the same five native cases:
   - open every installed feature in that case;
   - close the shell and shelf;
   - confirm Electron exits only in native mode and remains resident in the capability-missing local case;
   - relaunch through the host and confirm the last valid page and feature snapshot;
   - exercise Bonded, Shout, and Amove primary commands in the cases where they are installed;
   - verify no duplicate shelf window, renderer, host, or feature-service owner remains.

A passing typecheck or unit suite is not enough for the Electron-exit claim. The packaged lifecycle smoke and a real macOS UI run are required.

## Acceptance criteria

The implementation is complete only when all of these are true:

1. In authenticated native mode, no Electron product controller owns Bonded monitoring, Shout audio, or Amove hotkeys/window movement.
2. `FeatureRuntime` still presents the existing `MoirasiaFeature` contract to the shell and renderer.
3. Native adapter disposal removes Electron UI and IPC state without stopping the native feature service.
4. Closing the last Menu Bar shell or shelf window exits Electron when the host is connected, while the host, feature service, installed feature state, leases, and background work continue.
5. In local fallback mode, closing the last Menu Bar UI does not exit Electron or stop local feature controllers.
6. An Electron relaunch reconnects to the existing host, reads the native snapshot, and restores adapters without restarting feature state or creating a duplicate host.
7. Explicit Quit stops the feature service and host and performs Bonded firewall, Shout default-input, and Amove hotkey cleanup.
8. Feature-service crashes produce visible native `error` status, preserve installed state, retry with bounded backoff, and return to `running` after recovery. A healthy restart resets the restart counter.
9. Host disconnects do not trigger local fallback after native mode selection. Reconnect starts from a full snapshot.
10. Native and local settings use the same defaults, accepted versions, migrations, backups, data directories, and user-visible permission results; the TCC prompt owner is the process that performs the operation in each mode.
11. The native service and Electron adapters retain all existing product wire method and event names, resource paths, authentication, framing, and protocol version.
12. Amove's shelf remains an Electron `BrowserWindow`, and shelf hotkeys work across Electron absence and relaunch.
13. The representative packaged matrix (no feature, each individual feature, and all three) passes, including direct post-Electron-exit feature snapshot checks; unit coverage exercises the remaining install combinations.
14. Native-idle memory reports show no Electron process, no shell or shelf `BrowserWindow`, and no surviving `WebContents`; the report records the single native host, shared feature service, and Shout helper footprint separately.
15. `docs/architecture/memory-footprint.md`, `docs/architecture/standalone-applications.md`, `CONTEXT.md`, and `README.md` describe the verified architecture rather than the pre-sidecar state.

## Rollback and safety

- Keep the local product controllers, settings stores, data paths, and standalone behavior in every release. They are the fallback and the recovery path for a prior build.
- Do not run a local and native owner for the same feature simultaneously. Runtime leases and the native-mode latch must prevent that condition.
- If a native feature fails its phase gate, stop rollout at that feature. Keep the prior release or disable native capability before startup so the missing-artifact rule selects the local path. Do not select a local owner after native artifacts have been detected, and do not add a silent per-feature local fallback after native selection.
- If packaged native startup is broken, disable the native capability in the release build or ship the previous package. Do not delete or rewrite `features/<id>` data.
- Native settings migrations must create backups before changing data and must remain readable by the local implementation. A rollback must therefore preserve user settings even if the next build returns to local mode.
- Keep service-health handling backward-compatible with the existing partial `featureService` error event while the host and client are upgraded together.
- Do not stage, commit, or rewrite unrelated nested-repository changes while implementing this plan.

## Deletion test for the seam

Removing the native feature-service seam would put Bonded's monitor and firewall state, Shout's audio and default-input recovery, Amove's hotkeys and window movement, runtime leases, and crash recovery back into Electron product modules. Electron could no longer exit while those behaviors continue. The resulting module would have to know every product's persistent lifecycle and every UI boundary.

Keeping the seam gives the system two honest adapters with one ownership rule. The native service owns persistent state in native mode. The existing controllers own it in fallback mode. That locality is the reason the interface has useful depth rather than being a thin RPC wrapper.
