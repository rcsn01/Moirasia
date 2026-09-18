# Suspend Moirasia's shell renderer in menu bar mode

## Goal

When Moirasia is using Menu Bar presence and the user closes its primary window, destroy the primary `BrowserWindow` and its renderer instead of hiding it. Keep the Electron main process and installed feature backends alive. Recreate a fresh primary window when the user clicks the menu bar item, activates the app, opens a suite feature, or launches a second instance.

Amove's global shortcuts and shelf must continue working while the primary renderer does not exist. A visible shelf remains visible and usable. A hidden shelf window should not remain allocated; Amove recreates it on the next shelf action.

Dock Icon presence keeps the current close-to-hide behavior. Quitting remains a separate full teardown.

## Measurable outcomes

1. In Menu Bar mode, closing the primary window destroys its `BrowserWindow` and `webContents`; it does not merely call `hide()`.
2. No primary renderer process remains after Electron reports the destroyed `webContents`.
3. `FeatureRuntime` does not dispose Amove, Bonded, or Shout when the primary renderer is suspended.
4. Amove's native hotkeys remain registered while the primary renderer is absent.
5. The Amove shelf can be opened, edited, dragged from, closed, and reopened while the primary renderer is absent.
6. A visible Amove shelf is not destroyed when the primary window closes.
7. Reopening Moirasia creates exactly one primary window, binds all shell and feature IPC to its new `webContents`, restores the last selected page when still available, and rejects IPC from the destroyed renderer.
8. Command+Q and Quit Moirasia still dispose every feature, shelf, runtime lease, listener, IPC registration, and window before the process exits.
9. Activity Monitor or `app.getAppMetrics()` shows the primary renderer PID leaving after close. Do not set a fixed megabyte threshold in automated tests because Chromium allocation varies by macOS and Electron version.

## Current constraints

- `src/main/index.ts` creates one `BrowserWindow` and closes over it in IPC, menu navigation, appearance, polling, activation, and feature-host callbacks. There is no window-only lifecycle.
- `src/main/app-presence.ts` owns one fixed window and prevents every non-quit close, then hides that window.
- `src/main/features/embedded-host.ts` stores one fixed window and `webContents`. Its feature surfaces cannot detach from one renderer and attach to another.
- Shell IPC authorization in `src/main/ipc.ts` is correctly tied to one exact sender, but registration also lives for the app lifetime.
- Amove's shelf is already independent. `ShelfController` owns a separate `BrowserWindow`, preload, renderer, store, and IPC sender. `AmoveFeature.dispose()` would destroy it, so renderer suspension must not call `FeatureRuntime.disposeAll()` or uninstall Amove.
- Amove's main IPC resolves its sender through `AppController.getMainWebContents()`, which can become dynamic with a replaceable renderer target.
- Bonded and Shout capture the initial `WebContents` when registering IPC. They must use the current renderer target instead.
- Bonded excludes the initial renderer OS process from monitoring. It must also exclude every replacement renderer process.
- The React shell already fetches fresh snapshots on mount. Renderer-local state may reset, but persisted settings and main-process feature state can be restored.

## Design

### 1. Add a stable renderer target module

Add a small shared interface in `packages/desktop-shell/src/feature.ts` and implement it in the surface adapters:

```ts
export interface RendererTarget {
  current(): WebContents | undefined
  send(channel: string, ...args: unknown[]): boolean
  subscribe(listener: (current: WebContents | undefined) => void): () => void
}
```

The interface hides renderer replacement from feature backends:

- `current()` is the sole sender-authorization source.
- `send()` delegates to the existing guarded `sendToRenderer` behavior and returns `false` while detached, loading, or destroyed.
- `subscribe()` emits the current target immediately, then emits once for each attach and detach. Bonded uses this to exclude replacement renderer PIDs.

Use two adapters at this real seam:

- The standalone/owned-window adapter always points to its one `webContents` until disposal.
- `EmbeddedFeatureHost` owns a replaceable adapter that points to the currently attached shell renderer or `undefined` while suspended.

Change `EmbeddedFeatureSurface` and `FeatureSurfaceHandle` to expose `renderer: RendererTarget`. Remove direct `webContents` exposure once all in-repo consumers have migrated. This prevents future features from accidentally retaining a stale renderer.

Security invariant: IPC handlers authorize only when `event.sender === renderer.current()` and both values are live. A detached target authorizes nobody.

### 2. Make `EmbeddedFeatureHost` persistent and attachable

Refactor `src/main/features/embedded-host.ts` so its lifetime matches `FeatureRuntime`, not a `BrowserWindow`.

Interface:

```ts
const host = new EmbeddedFeatureHost()
host.attach(window)
host.detach(window)
host.surface(id)
host.dispose()
```

Required behavior:

- `surface(id)` remains stable across any number of primary-window generations.
- `attach(window)` binds focus, blur, and closed listeners and updates the shared renderer target.
- `detach(window)` only detaches if `window` is the current generation, removes listeners, clears focus, and sets the renderer target to `undefined` before the window is destroyed.
- A stale window's later events cannot detach or alter a newer generation.
- Detach sets all surface states to `{ active: false, focused: false }`; the shell window manager separately remembers the last controller page for restoration.
- `activate()` while detached requests shell-window activation through the existing navigation seam instead of throwing or doing nothing.
- `dispose()` detaches the current window, clears target subscribers and navigation listeners, and permanently rejects new surfaces.

Do not put window creation, renderer loading, controller snapshots, or feature disposal in this module. Its job is stable embedded-feature surfaces across replaceable shell renderers.

### 3. Add a deep shell window lifecycle module

Create `src/main/shell-window.ts` with a `ShellWindowLifecycle` module. Move all primary-window-specific work out of `src/main/index.ts` behind this interface:

```ts
interface ShellWindowLifecycle {
  open(page?: ControllerPage): Promise<void>
  suspend(): Promise<void>
  dispose(): Promise<void>
  currentWindow(): BrowserWindow | undefined
}
```

`open()` and `suspend()` must serialize through one internal operation queue so tray clicks, `app.activate`, second-instance events, feature activation, and close events cannot create or destroy overlapping generations.

Each window generation owns:

- the secure `BrowserWindow` options;
- `EmbeddedFeatureHost.attach(window)`;
- controller IPC registration for that exact sender;
- navigation guards;
- focus-triggered application refresh;
- show/hide polling timer;
- native appearance application for that window;
- renderer URL/file loading;
- load-failure cleanup;
- close, closed, and renderer-crash listeners.

`open(page)` behavior:

1. If a current window is live, restore, show, and focus it, then navigate if `page` was supplied.
2. If creation is already in flight, await it and reuse the result.
3. Create and attach one window generation.
4. Register window-bound IPC and listeners before loading the renderer.
5. Load the shell renderer.
6. Refresh the controller snapshot.
7. Show and focus the window.
8. Navigate to the supplied page or the remembered page after `did-finish-load`. If that feature is no longer installed/loaded, navigate to General.
9. On any failure, unregister the generation, detach it, destroy it, leave the tray operational, and allow the next `open()` to retry.

`suspend()` behavior:

1. No-op when no generation exists.
2. Remember the current controller page.
3. Clear the active feature through `FeatureRuntime.setActive(undefined)` so Amove's hotkey policy does not treat a nonexistent panel as focused.
4. Stop polling and remove generation listeners.
5. Unregister shell IPC for that generation.
6. Detach `EmbeddedFeatureHost` before destroying the window.
7. Destroy the primary window and clear the generation reference.
8. Do not dispose features, appearance storage, the application controller, the tray, or a visible Amove shelf.

`dispose()` performs `suspend()` in quitting mode and permanently rejects later `open()` calls. App-wide teardown then disposes features and the persistent host in the existing order.

Keep `src/main/index.ts` as composition and app-event wiring only: load persistent settings/appearance, create the host, load features once, create the application controller and shell-window lifecycle, create presence, then route app events to those modules.

### 4. Separate app presence from window ownership

Refactor `src/main/app-presence.ts` so it no longer stores a `BrowserWindow` or installs a close handler. Give it callbacks to the shell-window lifecycle:

```ts
new AppPresence({
  menuBarIconPath,
  open: () => shellWindow.open(),
  quit: () => app.quit()
})
```

It continues to own only:

- the persisted `dock | menu-bar` mode;
- Dock show/hide behavior;
- tray creation, menu, and disposal;
- Show Moirasia and Quit Moirasia actions.

The shell window generation's close handler reads current presence mode:

- Menu Bar: prevent default and call `suspend()`.
- Dock Icon: prevent default and hide the live window, preserving current behavior.
- Quitting: allow the close to continue.

Changing to Menu Bar mode hides the Dock immediately but does not destroy an open window. The next close suspends it. Changing to Dock mode restores the Dock; if no primary window exists, `app.activate` or clicking the Dock icon calls `open()`.

### 5. Rebind shell-global navigation and appearance

Refactor `src/main/menu.ts` to accept `navigate(page)` rather than a concrete window. Install the application menu once. Navigation calls `shellWindow.open(page)`, so Settings and Features work whether the primary renderer exists or not.

Replace closures over the initial window in `src/main/index.ts`:

- `second-instance` calls `shellWindow.open()`.
- `activate` calls `shellWindow.open()`.
- feature-host navigation calls `shellWindow.open(featureId)`.
- native-theme updates ask the lifecycle to apply background color to only its current window.
- shell appearance changes update the registry and apply to only the current generation.

The lifecycle, not callers, decides whether to navigate an existing renderer or create a new one.

### 6. Keep feature backends alive while replacing their renderer target

Update integrated features to consume `FeatureSurfaceHandle.renderer`.

#### Amove

Files:

- `apps/integrated/Amove/src/main/app-controller.ts`
- `apps/integrated/Amove/src/main/ipc.ts`
- relevant Amove tests

Changes:

- `getMainWebContents()` returns `surface.renderer.current()`.
- Main-panel broadcasts use `surface.renderer.send(...)`; they safely disappear while detached.
- Main IPC authorization resolves `renderer.current()` at invocation time.
- `embedded.subscribe(...)` continues to update hotkey policy on attach, focus, active-page changes, and detach.
- Do not dispose `AppController`, `NativeBackend`, hotkey registrations, `ShelfController`, or `ShelfStore` during shell suspension.
- Calling `showMainWindow()` while detached activates the stable embedded surface, which requests `shellWindow.open('amove')`.

#### Bonded

Files:

- `apps/integrated/Bonded/src/main/feature.ts`
- `apps/integrated/Bonded/src/main/ipc.ts`
- relevant Bonded tests

Changes:

- IPC registration accepts `RendererTarget`, not a captured `WebContents`.
- Authorization and snapshot sends resolve the current renderer for each operation.
- Subscribe to renderer changes and call `controller.excludeProcess(current.getOSProcessId())` for every attached generation.
- Keep the monitor, firewall state, runtime lease, and controller alive while detached.

#### Shout

Files:

- `apps/integrated/Shout/src/main/feature.ts`
- `apps/integrated/Shout/src/main/ipc.ts`
- relevant Shout tests

Changes:

- IPC registration accepts `RendererTarget`.
- Authorization and snapshots use the current renderer.
- Keep the audio helper, runtime lease, source/default-input bookkeeping, and controller alive while detached.

A replacement renderer always fetches a full initial state through its existing `getState`/`getSnapshot` call. Events emitted while detached are intentionally not queued.

### 7. Preserve Amove shelves while releasing hidden shelf renderers

Update `apps/integrated/Amove/src/main/shelf-controller.ts`:

- A visible shelf window is independent of the shell window and survives shell suspension unchanged.
- `hideAndClearItems()` and `cancelAndClear()` destroy the shelf `BrowserWindow` after updating the main-process store instead of retaining a hidden shelf renderer.
- `show()` continues to call `ensureWindow()`, so the next hotkey recreates the shelf renderer and reads current state from `ShelfStore` through `shelfGetState`.
- If a shelf window closes unexpectedly, clear only the window reference; do not dispose Amove's backend or unregister shelf IPC.
- Keep thumbnail cache policy unchanged initially. Its main-process memory can be measured separately after the primary renderer work lands.

Do not destroy a visible shelf merely because the primary shell renderer closes. This is the central product requirement.

### 8. Preserve page state deliberately

Add current-page ownership to the main process, preferably `ApplicationController` because it already receives `reportPage(page)` and knows feature availability.

- `reportPage` records the selected `ControllerPage` and updates feature active state.
- Expose a read-only current page or a `restorablePage()` method to `ShellWindowLifecycle`.
- On suspend, clear feature active state without erasing the remembered page.
- On reopen, validate the remembered feature against current status. Fall back to `general` if unavailable.
- The React renderer receives one navigation event after load and then reports the selected page normally.

Do not attempt to serialize arbitrary React-local state. Forms or transient UI state may reset when the renderer is destroyed; persisted settings and backend state remain authoritative.

## Failure and race rules

- All open/suspend/dispose transitions are serialized.
- A close event schedules suspension once; repeated close events are ignored for that generation.
- A tray click during suspension waits, then creates one new generation.
- A stale generation cannot detach a newer host attachment or clear its timers.
- Old renderer IPC is rejected immediately after host detach, even before `webContents.destroyed` fires.
- New renderer IPC is rejected until the new target is attached.
- Renderer load failure leaves no window-bound IPC handlers or host attachment behind.
- Renderer crash uses the same cleanup as suspension. Keep the tray and features alive and permit manual reopen; do not automatically spin in a crash loop.
- App quit marks presence and lifecycle as quitting before closing windows. It never recreates a primary window during teardown.
- Feature uninstall remains full feature disposal. If Amove is uninstalled while its shelf is visible, its existing disposal destroys the shelf.

## Implementation order

1. Add `RendererTarget` and adapters in `@moirasia/desktop-shell`; migrate `FeatureSurfaceHandle` and its focused tests.
2. Refactor `EmbeddedFeatureHost` to attach/detach while preserving stable feature surfaces and renderer target identity.
3. Migrate Amove, Bonded, and Shout IPC and broadcasts to the renderer target. Add replacement-sender tests before changing the shell lifecycle.
4. Add `ShellWindowLifecycle` and move the primary-window generation out of `src/main/index.ts`.
5. Refactor `AppPresence` and `installApplicationMenu` to call the lifecycle rather than capture a window.
6. Add main-process page restoration.
7. Change hidden Amove shelf windows to destroy-on-hide while preserving visible shelves.
8. Update architecture documentation and run the full verification matrix.
9. Build a packaged macOS app with `pnpm package:mac`, run that packaged build outside the development server, and verify with Activity Monitor plus `app.getAppMetrics()` that closing/destroying the primary window removes its renderer process and lowers Moirasia's total resident memory. Record before-close, after-close, shelf-visible, and after-reopen measurements in the implementation summary.

This order keeps the existing one-window application working through steps 1 to 3. The shell starts destroying renderers only after every feature can follow a replacement target.

## Automated verification

### Shared surface and host tests

Extend:

- `tests/feature-surface-host.test.ts`
- `tests/standalone-surface.test.ts`
- `tests/embedded-feature-host.test.ts`
- `tests/renderer-sender.test.ts`

Cover:

- static standalone renderer target;
- stable embedded target across attach, detach, and reattach;
- immediate subscription values;
- sends suppressed while detached/loading/destroyed;
- old sender rejected after detach;
- stale-window events cannot detach the current generation;
- activation while detached requests navigation/open.

### Shell lifecycle tests

Add `tests/shell-window.test.ts` with Electron fakes. Cover:

- Menu Bar close detaches and destroys the primary window;
- Dock close hides without destruction;
- feature instances are untouched by suspension;
- suspend unregisters shell IPC and stops polling;
- reopen creates one generation and restores the page;
- concurrent opens create one window;
- open during suspend waits;
- load failure cleans up and a later open retries;
- renderer crash cleans up without quitting;
- quit prevents recreation and allows final window destruction.

Update `tests/app-presence.test.ts` and `tests/platform-integration.test.ts` for callback-based presence and packaged tray assets.

### Feature tests

Amove:

- shell target detach does not call feature/controller disposal;
- global toggle-shelf action creates and operates the shelf with no shell renderer;
- a visible shelf survives detach and remains authorized;
- hidden shelf close destroys its renderer and hotkey reopen creates a new one;
- main-panel IPC rejects the old renderer and accepts the replacement;
- broadcasts while detached do not throw.

Bonded and Shout:

- old renderer rejected after replacement;
- new renderer receives snapshots and can invoke actions;
- controllers and leases are not stopped on detach;
- Bonded excludes each new renderer OS PID.

### Commands

```bash
pnpm typecheck
pnpm test
pnpm build:app
pnpm -C apps/integrated/Amove typecheck
pnpm -C apps/integrated/Amove test
pnpm -C apps/integrated/Bonded typecheck
pnpm -C apps/integrated/Bonded test
pnpm -C apps/integrated/Shout typecheck
pnpm -C apps/integrated/Shout test
pnpm ui:preset:check
pnpm package:mac
git diff --check
```

Run narrower suites after each implementation stage, then the full matrix above.

## Manual macOS verification

1. Start Moirasia in Menu Bar mode and record `app.getAppMetrics()` plus Activity Monitor process rows.
2. Open Amove and show its shelf with the global shortcut.
3. Close Moirasia's primary window. Confirm its renderer PID exits while the menu bar item and visible shelf remain.
4. Use every configured Amove shelf/window shortcut with no primary renderer. Add files, expand/edit, drag items out, close the shelf, and reopen it.
5. Confirm closing a hidden shelf removed its renderer process and reopening created a new one.
6. Click the Moirasia menu bar item. Confirm one primary window returns on the prior page with current feature state.
7. Repeat close/open rapidly and through macOS app activation. Confirm no duplicate windows or IPC-handler errors.
8. While suspended, exercise Bonded monitoring and Shout audio, then reopen their pages and confirm current snapshots.
9. Change to Dock Icon mode. Confirm close hides rather than destroys and Dock activation restores the same window.
10. Switch back to Menu Bar mode, suspend, then quit from the tray. Confirm the shelf, helpers, leases, and Electron process all exit.
11. Force a renderer crash in development. Confirm the tray and Amove shelf survive and the next Show action recreates the shell.
12. Launch the packaged app, record total resident memory and per-process metrics with the primary window open, close it in Menu Bar mode, wait for the old renderer PID to exit, then record the new totals. Repeat with the Amove shelf visible and after reopening Moirasia. Treat the change as verified only if the primary renderer disappears and total resident memory drops after close; report the observed values rather than imposing a fixed threshold.

## Documentation updates

Update:

- `CONTEXT.md`: define the persistent feature host, replaceable shell renderer, and independent Amove shelf lifetime.
- `docs/architecture/standalone-applications.md`: document that suite feature registration outlives individual shell renderer generations and that renderer targets are replaceable.
- `README.md`: state that Menu Bar close suspends the primary UI while background features continue running, so users understand why memory does not fall to zero.

## Out of scope

- Quitting or unloading installed feature backends when the shell renderer closes.
- Persisting arbitrary React-local view state.
- Destroying a visible Amove shelf to save memory.
- Moving feature backends into utility processes.
- Replacing Electron or disabling Chromium/GPU features.
- Setting a fixed RAM target without process-level measurements.
