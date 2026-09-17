# Deepen the standalone window lifecycle

## Goal

Concentrate the duplicated owned `BrowserWindow` lifecycle in one private module inside `@moirasia/desktop-shell`.

The finished architecture must preserve the two public domain interfaces:

- The Feature surface host continues to accept `FeatureContext`, validate Feature catalog requirements, return the shell surface in suite mode, and create a catalog-configured window in standalone mode.
- The Standalone surface continues to accept app-owned window and appearance facts without importing the Feature catalog.

Both paths will translate their facts into one private owned-window interface. That module will own secure window construction, navigation guards, appearance registration, deferred renderer loading, activation, external-close handling, and teardown.

This is an internal deepening, not a merger of `acquireFeatureSurface` and `acquireStandaloneSurface`. Their public interfaces and package subpath exports remain separate.

## Why this change

`packages/desktop-shell/src/feature-surface-host.ts` and `packages/desktop-shell/src/standalone-surface.ts` currently implement nearly the same standalone window lifecycle:

1. Validate facts.
2. Create a hidden `BrowserWindow` with shared chrome and secure web preferences.
3. Deny `window.open`.
4. Apply a navigation policy.
5. Register product appearance.
6. Return a handle that loads and shows on `ready()`.
7. Restore, show, and focus on `activate()`.
8. Dispose appearance and destroy the window on `dispose()`.
9. Dispose appearance when the window closes externally.

The implementations have already diverged:

- `StandaloneSurface.ready()` memoizes one in-flight promise. `FeatureSurfaceHandle.ready()` uses a `loaded` boolean, so concurrent calls can start more than one renderer load.
- The Standalone surface catches renderer load and `show()` failures in one block. The Feature surface host catches only renderer loading; a throwing `show()` bypasses cleanup.
- The Standalone surface checks both `disposed` and `window.isDestroyed()` before activation and showing. The Feature surface host checks only the window.
- Both attach the `closed` listener after awaiting appearance registration. An external close during registration can escape normal cleanup.
- Synchronous setup failures after window construction can leave the window alive because setup is not covered by one rollback path.

Two adapters prove that the seam is real. The catalog-backed Feature surface host and the catalog-free Standalone surface need different inputs, but they need the same lifecycle implementation.

The deletion test is concrete. After this work, deleting the private module must force BrowserWindow construction, guards, appearance state, renderer readiness, activation, and cleanup back into both adapters. The current lifecycle blocks in both adapters should disappear wholesale.

## Ground-truth inventory

### Duplicated lifecycle sites

The production source has exactly two owned-window lifecycle implementations, one in each public module. Each file contains one `new BrowserWindow`, one `setWindowOpenHandler`, one `will-navigate` listener, one `registerProductAppearance` call, one renderer branch mentioning both `loadURL` and `loadFile`, and one private `isHttpUrl` helper. `standalone-surface.ts` alone also contains generic option validation and a private `isAbsolutePath` helper. No third production implementation exists under `packages/desktop-shell/src`.

`packages/desktop-shell/src/main.ts` owns the appearance implementation and chrome helpers; it is a dependency, not a third window lifecycle. `packages/desktop-shell/src/feature.ts` separately has the Feature resource path and URL predicates. Those validators remain where they are because they validate all Feature resources, not owned-window options.

### Public modules and exports

`packages/desktop-shell/package.json` exports:

- `./feature-surface-host` from `src/feature-surface-host.ts`;
- `./standalone-surface` from `src/standalone-surface.ts`.

Neither module is re-exported by `src/index.ts`.

The new implementation module will be imported by relative path only. Do not add it to the package `exports` map or `src/index.ts`.

### Feature surface host contract

`packages/desktop-shell/src/feature-surface-host.ts` exports:

- `FeatureSurfaceOptions`, with optional `icon` and `devTools`;
- `FeatureSurfaceHandle`, with `mode`, `webContents`, optional `window`, `ready()`, `activate()`, and `dispose()`;
- `acquireFeatureSurface(context, options)`.

Suite mode must remain unchanged:

- no `BrowserWindow` is created;
- `webContents` comes from `context.surface`;
- `ready()` and `dispose()` are no-ops;
- `activate()` calls `surface.activate()` and then `surface.focus()`;
- the shell retains renderer and window ownership.

Standalone Feature mode must retain:

- `validateFeatureResources(context)` before side effects;
- title, dimensions, fullscreen behavior, and navigation policy from `featureCatalog.get(context.id).standaloneWindow`;
- `preloads.main` and `renderers.main` from `FeatureContext.paths`;
- initial background from `defaultProductAppearance(context.productId)`;
- shared appearance registration with no app-local registry path and no legacy seed;
- optional icon and `devTools` overrides;
- `mode: 'standalone'` on the returned handle.

### Standalone surface contract

`packages/desktop-shell/src/standalone-surface.ts` exports:

- `StandaloneSurfaceOptions`;
- `StandaloneSurface`;
- `acquireStandaloneSurface(options)`.

The public option and result types must not change. The module must remain independent of `FeatureContext` and the Feature catalog.

It must retain:

- caller-owned title and dimensions;
- caller-owned preload and renderer;
- caller-owned appearance file and default appearance;
- optional fullscreen, navigation, icon, `devTools`, and spellcheck facts;
- validation before window construction;
- app-local appearance registration using `appearanceFile` and `defaultAppearance` as the legacy seed.

### Direct consumers

There are six production acquisition call sites across five nested application repositories.

The Feature surface host has four calls across three integrated products:

- `apps/integrated/Amove/src/main/feature.ts` acquires the initial surface;
- `apps/integrated/Amove/src/main/app-controller.ts` reacquires it after an external close;
- `apps/integrated/Bonded/src/main/feature.ts` acquires one surface;
- `apps/integrated/Shout/src/main/feature.ts` acquires one surface.

The Standalone surface has two calls:

- `apps/standalone/Exithibition/src/main/application.ts`;
- `apps/standalone/Orbis/src/main/application.ts`.

Type-only consumers also pin the public result types: `apps/integrated/Amove/tests/feature.test.ts`, `apps/standalone/Exithibition/src/main/controller.ts`, and `apps/standalone/Exithibition/tests/exithibition-controller.test.ts`. `apps/standalone/Exithibition/tests/exithibition-application.test.ts` mocks the Standalone acquisition subpath. These sites need no source edits, but their compiler or Vitest suites are part of the consumer checks below.

The applications are independent nested Git repositories. No application source change should be needed because the public package interfaces remain unchanged. Verify each repository separately and do not commit nested repository changes as part of the root implementation unless an unexpected compile failure proves a consumer change is necessary.

### Current test seams

The current adapter suites contain 18 declared tests: 13 in `tests/feature-surface-host.test.ts` and 5 in `tests/standalone-surface.test.ts`. The Feature suite's table-driven alias case expands to two runtime tests. `tests/feature-contract.test.ts` has 5 declarations, including a four-row table, and expands to 8 runtime tests. Together these three files currently run 27 tests; all 27 pass before this refactor.

The retain/remove lists in steps 5 and 6 classify all 18 adapter test declarations. `feature-contract.test.ts` needs no source edit. It stays in the focused command because its existing Feature validation cases prove that malformed standalone Feature resources reject before owned-window acquisition.

`tests/feature-surface-host.test.ts` and `tests/standalone-surface.test.ts` replace Electron and appearance helpers with local Vitest fakes. The new private module can use the same mechanism through direct imports of `electron` and `./main`.

Do not add a dependency object to the production interface. There is one Electron implementation, and the existing module mocks already provide the local substitute used in tests. An extra dependency interface would add a hypothetical seam.

The deep module's interface will become the main lifecycle test surface. Adapter tests will retain only domain translation and public contract coverage. Delete redundant lifecycle assertions from the adapter suites instead of keeping two copies of every test.

## Settled decisions

These decisions use the recommended answer for every design branch.

### Keep both public acquisition interfaces

Do not merge or rename `acquireFeatureSurface` and `acquireStandaloneSurface`.

The Feature surface host owns Feature catalog translation and suite-versus-standalone behavior. The Standalone surface owns its explicit app options and remains catalog-free. These are meaningful domain seams even though their standalone branches share an implementation.

### Add one private deep module

Create:

`packages/desktop-shell/src/owned-window-surface.ts`

The name describes an internal Electron window that the calling host owns. It does not add a new user-facing domain concept, so `CONTEXT.md` does not need a new term.

The module must not import:

- `FeatureContext`;
- `FeatureId`;
- `featureCatalog`;
- feature controllers;
- IPC registration;
- runtime leases;
- application-specific code.

It may import:

- `BrowserWindow` and Electron types;
- `Appearance` and `ProductId` as types;
- `desktopWindowChromeOptions`;
- `neutralWindowBackground`;
- `registerProductAppearance`.

### Use one normalized options object

The private module should expose one acquisition function and one returned lifecycle type. Use this shape as the implementation target:

```ts
export type OwnedWindowNavigation = 'deny' | 'allow-same-url'

export type OwnedWindowAppearance =
  | {
      readonly initial: Appearance
      readonly registry: 'shared'
    }
  | {
      readonly initial: Appearance
      readonly registry: {
        readonly path: string
      }
    }

export interface OwnedWindowSurfaceOptions {
  readonly productId: ProductId
  readonly title: string
  readonly width: number
  readonly height: number
  readonly minWidth: number
  readonly minHeight: number
  readonly preload: string
  readonly renderer: string
  readonly appearance: OwnedWindowAppearance
  readonly fullscreenable?: boolean
  readonly navigation?: OwnedWindowNavigation
  readonly icon?: string
  readonly devTools?: boolean
  readonly spellcheck?: boolean
}

export interface OwnedWindowSurface {
  readonly webContents: WebContents
  readonly window: BrowserWindow
  ready(): Promise<void>
  activate(): void
  dispose(): void
}

export function acquireOwnedWindowSurface(
  options: OwnedWindowSurfaceOptions
): Promise<OwnedWindowSurface>
```

The interface is normalized rather than accepting `BrowserWindowConstructorOptions`. Callers cannot weaken `contextIsolation`, enable Node integration, disable the sandbox, show before readiness, replace the navigation guard, or bypass appearance cleanup.

The appearance union prevents invalid combinations:

- Feature standalone mode chooses `registry: 'shared'` and supplies the initial product appearance.
- Standalone-only applications supply an app-local registry path. Their `initial` appearance is also the legacy seed passed to `registerProductAppearance`, matching the existing single `defaultAppearance` input.

Do not add a separately variable app-local legacy seed. No caller has separate initial-background and migration-seed values, and allowing them to differ would create an unsupported state. Do not add lifecycle hooks, arbitrary callbacks, renderer target objects, or a general Electron port. No current caller needs them.

### Keep fixed security and ownership policy inside the module

The implementation owns these fixed window facts:

- `show: false`;
- shared platform chrome from `desktopWindowChromeOptions()`;
- `contextIsolation: true`;
- `nodeIntegration: false`;
- `sandbox: true`;
- `spellcheck: false` by default;
- `fullscreenable: true` by default;
- navigation policy `deny` by default;
- `window.open` always denied;
- `applyNativeTheme: true` for appearance registration.

The adapters supply only facts that genuinely vary.

### Validate before constructing a window

Move the generic Standalone window validation into the private module and apply it to both adapters:

- every dimension is a positive safe integer, rejecting zero, negatives, fractions, `NaN`, infinities, and integers outside JavaScript's safe range;
- `minWidth` may equal but must not exceed `width`;
- `minHeight` may equal but must not exceed `height`;
- preload is an absolute path under the existing lexical rule;
- renderer is an absolute path under that rule or a URL whose parsed protocol is exactly HTTP or HTTPS;
- an app-local appearance path is absolute under the same lexical rule.

Preserve the current lexical path predicate rather than replacing it with host-platform `node:path` behavior. It accepts POSIX-rooted paths beginning `/`, UNC paths beginning two backslashes, and drive-rooted paths matching `^[A-Za-z]:[\\/]`. It rejects relative paths, drive-relative paths such as `C:relative`, and a path beginning with only one backslash. This matters because tests and callers may describe Windows resources while running on another host.

Preserve the current URL predicate too: parse with `new URL(value)` and accept only normalized `http:` and `https:` protocols. Both schemes and case-normalized scheme spellings pass; relative strings, malformed URLs, and `file:`, `ftp:`, or other schemes fail. This predicate also accepts URL-parser forms such as `http:localhost`; do not silently tighten it in this refactor.

Preserve the current Standalone surface error text so callers do not see avoidable message changes:

- `Standalone window <dimension> must be a positive integer.`;
- `Standalone window minimum size exceeds its initial size.`;
- `Standalone window preload must be an absolute path.`;
- `Standalone window renderer must be an absolute path or HTTP URL.`;
- `Standalone appearance file must be an absolute path.`.

Feature contexts still pass through `validateFeatureResources` first. That remains the authoritative source of feature-specific missing-resource errors and preserves rejection before side effects.

### Serialize readiness

Use one memoized `readyPromise` in the private implementation.

The contract is:

- acquisition creates a hidden, unloaded window;
- the first `ready()` chooses `loadURL` for HTTP or HTTPS and `loadFile` otherwise;
- concurrent `ready()` calls share the same in-flight promise;
- repeated calls after success do not load or show again;
- the window shows only after loading succeeds;
- disposal during an in-flight load immediately disposes appearance state and destroys the window; the already-started load promise is still allowed to settle, but it must not show the window afterward;
- a load or `show()` error disposes the appearance registration, destroys the window, and rejects with the original error;
- later `ready()` calls after failure or disposal resolve as inert no-ops.

This adopts the stronger existing Standalone surface behavior and fixes the Feature surface host's concurrent-load gap.

### Make acquisition race-safe

Attach the `closed` listener immediately after construction and before awaiting appearance registration.

Use one idempotent disposal state for all paths. The acquisition sequence should be:

1. Validate normalized options.
2. Construct the hidden window.
3. Define idempotent disposal state and attach the `closed` listener.
4. Install the `window.open` denial and navigation guard.
5. Await appearance registration.
6. Store the appearance disposer if the window is still alive.
7. If the window closed while registration was pending, invoke the returned appearance disposer immediately and return an inert surface.
8. Return the surface.

Wrap every post-construction acquisition step in rollback logic. If guard setup or appearance registration throws, destroy the window if it is still alive and rethrow the original error.

Do not invent an error when the user closes the window during appearance registration. Treat it like any external close: acquisition may resolve, but the returned surface is disposed and all methods are inert.

### Keep activation and disposal ordering

`activate()` must:

1. Return without side effects when disposed or destroyed.
2. Restore when minimized.
3. Show.
4. Focus.

`dispose()` must:

1. Mark the lifecycle disposed once.
2. Invoke the appearance disposer once.
3. Clear the stored disposer.
4. Destroy the window only when it is still alive.

The external `closed` event must mark the lifecycle disposed and clean appearance state, but it must never call `destroy()` again.

Appearance cleanup must happen before explicit destruction. This preserves current IPC and native-theme cleanup ordering.

### Preserve domain ownership and documentation

This work does not move Feature catalog facts, FeatureContext validation, controllers, IPC, leases, or presence policy.

`CONTEXT.md` and `docs/architecture/standalone-applications.md` describe public ownership and remain accurate. The public Feature surface host and Standalone surface still own their windows from each caller's perspective. The new module is private implementation. No domain glossary or architecture document change is required.

There is no root `docs/adr/` directory. This plan respects the recorded split rather than revisiting it, so no ADR is needed.

## Detailed implementation steps

### Step 1: add the private owned-window module

Create `packages/desktop-shell/src/owned-window-surface.ts`.

Implement the normalized types and `acquireOwnedWindowSurface` interface described above.

Add private helpers in the same file for:

- option validation;
- absolute-path detection;
- HTTP or HTTPS URL detection;
- navigation guard installation.

Do not extract these helpers into more modules. They are part of one lifecycle implementation and have no independent callers.

Construct `BrowserWindow` with the shared fixed policy and optional facts. Preserve omission behavior for `icon` and `devTools`: add those properties only when callers supplied them.

Translate appearance registration as follows:

- Shared registry: call `registerProductAppearance(productId, window, undefined, { applyNativeTheme: true })`.
- App-local registry: call `registerProductAppearance(productId, window, appearance.initial, { applyNativeTheme: true, registryPath: appearance.registry.path })`.

Implement one closure-backed `OwnedWindowSurface`. Methods must not rely on JavaScript `this`, which keeps delegation safe.

Cover synchronous post-construction failures and asynchronous appearance registration failures with the same rollback path.

### Step 2: reduce the Feature surface host to an adapter

Edit `packages/desktop-shell/src/feature-surface-host.ts`.

Keep:

- exported `FeatureSurfaceOptions`;
- exported `FeatureSurfaceHandle`;
- `acquireFeatureSurface`;
- `validateFeatureResources(context)` before mode selection;
- the suite handle implementation;
- Feature catalog lookup and standalone fact translation;
- feature-specific preload and renderer narrowing errors.

For standalone mode:

1. Read the catalog entry.
2. Read and narrow `paths.preloads.main`.
3. Read and narrow `paths.renderers.main`.
4. Call `acquireOwnedWindowSurface` with catalog window facts, FeatureContext resources, default product appearance, shared appearance registry mode, and the two public overrides.
5. Return a `FeatureSurfaceHandle` that adds `mode: 'standalone'` and delegates `webContents`, `window`, `ready()`, `activate()`, and `dispose()` to the owned surface.

Delete from this file:

- runtime `BrowserWindow` construction;
- secure web preference assembly;
- `setWindowOpenHandler` setup;
- `installNavigationGuard`;
- appearance registration and disposal state;
- `loaded` state;
- URL detection;
- renderer loading;
- standalone activation and destruction logic.

Retain Electron imports only as type imports needed by the public interfaces.

Do not change suite-mode behavior or move it into the private module.

### Step 3: reduce the Standalone surface to an adapter

Edit `packages/desktop-shell/src/standalone-surface.ts`.

Keep the public option and result interfaces unchanged.

Replace its implementation with translation to `acquireOwnedWindowSurface`:

- copy product identity, title, dimensions, preload, renderer, and optional window facts;
- use `defaultAppearance` as `appearance.initial`;
- use app-local registry mode with `appearanceFile`; the private module also uses `appearance.initial` as the legacy seed;
- return the owned surface directly because it structurally satisfies `StandaloneSurface`.

Delete from this file:

- `validateOptions` and its private path and URL helpers;
- runtime `BrowserWindow` construction;
- security and chrome assembly;
- navigation guards;
- appearance registration;
- ready state;
- activation and disposal implementation.

Retain Electron imports only as type imports for `StandaloneSurface`.

Do not import the Feature catalog or FeatureContext.

### Step 4: add focused tests for the deep module

Create `tests/owned-window-surface.test.ts`.

Use one Electron fake and one mocked `./main` module for the private interface. The fake must support:

- construction option capture;
- `webContents.setWindowOpenHandler`;
- `will-navigate` listeners and current URL;
- deferred and failing `loadFile` and `loadURL`;
- `show`, `focus`, and `restore` call ordering;
- external `closed` events;
- destroyed and minimized state;
- a deferred appearance registration promise.

Test the private module through `acquireOwnedWindowSurface`.

Required cases:

1. Shared-registry acquisition creates one hidden and unloaded window with exact security defaults, shared chrome, the initial background, and the expected appearance arguments.
2. App-local acquisition forwards registry path, legacy seed, icon, `devTools`, spellcheck, fullscreen, and navigation facts.
3. Invalid dimensions, minimums, preload, renderer, and app-local appearance path each reject before construction with the preserved errors. Exercise the dimension boundaries listed under validation, equality and greater-than minimums, all three accepted path families, the rejected relative, drive-relative, and single-backslash families, both accepted URL schemes, and malformed or disallowed schemes. Table-driven cases are appropriate.
4. `window.open` is always denied.
5. `deny` blocks every navigation.
6. `allow-same-url` permits only exact string equality with `webContents.getURL()`: it blocks a nonempty navigation before loading when the current URL is empty, permits the exact current URL after loading, and blocks a different URL.
7. A file renderer uses `loadFile`; an HTTP or HTTPS renderer uses `loadURL`.
8. Two concurrent `ready()` calls return the same promise object, start one load, share completion, and show once.
9. Repeated `ready()` after success does not reload or show again.
10. Disposal during an in-flight load cleans appearance state and destroys the window immediately, before the deferred load settles; settling that load does not show or clean up a second time.
11. A renderer load failure cleans appearance state, destroys the window, rethrows the original error, and leaves later `ready()` calls inert.
12. A synchronous `show()` failure performs the same rollback.
13. Activation restores a minimized window before show and focus, and becomes inert after disposal.
14. Explicit disposal cleans appearance before destruction and remains idempotent.
15. External close cleans appearance once, never destroys again, and leaves `ready()` and `activate()` inert.
16. Appearance registration failure destroys the window and rethrows the original error.
17. External close while appearance registration is pending invokes the eventual appearance disposer immediately and returns an inert surface without a second destroy.
18. Synchronous failures from either guard call destroy the constructed window and rethrow the original error. Cover `setWindowOpenHandler` itself and `webContents.on('will-navigate', ...)` after the open handler has already been installed, so the later partial-setup boundary is not missed.

Assert observable behavior through the private module interface and fake Electron objects. Do not test private helper functions directly.

### Step 5: narrow Feature surface host tests to adapter behavior

Edit `tests/feature-surface-host.test.ts`.

Retain or reshape coverage for:

- suite mode returning the shell surface and creating no window;
- FeatureContext validation before any window or appearance side effect;
- removed renderer aliases failing before side effects;
- Bonded catalog title, geometry, fullscreen policy, secure defaults, product appearance, and standalone mode;
- Amove icon and `devTools` option translation;
- Bonded `deny` and Amove `allow-same-url` catalog policy translation;
- returned standalone `webContents` and `window` identity.

Move general lifecycle coverage to `owned-window-surface.test.ts` and remove redundant Feature-host cases for:

- repeated readiness;
- generic URL-versus-file loading;
- generic appearance disposal;
- renderer load rollback;
- activation ordering;
- external close cleanup;
- appearance registration rollback.

Keep at least one integration path through the real private module. Do not mock `acquireOwnedWindowSurface` in every adapter test. The adapter suite must prove that catalog translation reaches actual window construction, while the private suite owns the exhaustive state-machine matrix.

Update the fake only as needed to support the retained integration cases. Remove fake fields used solely by deleted duplicate tests.

### Step 6: narrow Standalone surface tests to adapter behavior

Edit `tests/standalone-surface.test.ts`.

Retain or reshape coverage for:

- public options mapping to actual window construction;
- secure defaults and hidden initial state;
- app-local appearance path and legacy/default seed;
- optional fullscreen, navigation, icon, `devTools`, and spellcheck translation;
- invalid public facts rejecting before construction;
- returned `webContents` and `window` identity.

Move generic lifecycle behavior to `owned-window-surface.test.ts` and remove redundant Standalone-surface cases for:

- generic renderer selection and navigation implementation;
- repeated readiness;
- activation ordering and disposal idempotency;
- renderer-load rollback.

Keep one small public integration assertion that `ready()` loads and shows the configured renderer. This protects the adapter-to-private-module seam without repeating the full lifecycle matrix.

### Step 7: confirm the deletion test and exports

Run a focused source inventory after edits:

```sh
rg -n \
  "new BrowserWindow|setWindowOpenHandler|will-navigate|registerProductAppearance|loadURL|loadFile|isHttpUrl|isAbsolutePath|disposeAppearance|isMinimized|window\\.(restore|show|focus|destroy)" \
  packages/desktop-shell/src/owned-window-surface.ts \
  packages/desktop-shell/src/feature-surface-host.ts \
  packages/desktop-shell/src/standalone-surface.ts
```

Expected result:

- owned-window construction, guards, appearance registration, renderer selection, activation, and disposal exist only in `owned-window-surface.ts`;
- `feature-surface-host.ts` contains only suite activation plus catalog and FeatureContext translation;
- `standalone-surface.ts` contains only public option translation and type declarations.

Also verify:

```sh
rg -n "owned-window-surface" packages/desktop-shell/package.json packages/desktop-shell/src/index.ts
```

Expected result: no matches. The module remains private.

Check that the public declarations retain their names:

```sh
rg -n \
  "export interface FeatureSurfaceOptions|export interface FeatureSurfaceHandle|export async function acquireFeatureSurface|export interface StandaloneSurfaceOptions|export interface StandaloneSurface|export async function acquireStandaloneSurface" \
  packages/desktop-shell/src/feature-surface-host.ts \
  packages/desktop-shell/src/standalone-surface.ts
```

That search does not verify fields. Read and compare both declaration blocks against the exact contract inventory above, then inspect their diff. `FeatureSurfaceOptions`, `FeatureSurfaceHandle`, `StandaloneSurfaceOptions`, and `StandaloneSurface` must retain every field, optional marker, and method return type. The two acquisition functions must retain their parameter and return types.

## Test and verification strategy

### Focused root checks

Run the changed test surfaces first:

```sh
pnpm exec vitest run \
  tests/owned-window-surface.test.ts \
  tests/feature-surface-host.test.ts \
  tests/standalone-surface.test.ts \
  tests/feature-contract.test.ts
```

`feature-contract.test.ts` remains relevant because Feature resource validation must still reject before the private module receives standalone facts.

Then run root compilation and the full root suite:

```sh
pnpm typecheck
pnpm test
```

### Direct consumer checks

The public interfaces do not change, so no nested application edit is expected. Still verify every direct consumer against the local package source.

Run TypeScript checks:

```sh
pnpm -C apps/integrated/Amove typecheck
pnpm -C apps/integrated/Bonded typecheck
pnpm -C apps/integrated/Shout typecheck
pnpm -C apps/standalone/Exithibition typecheck
pnpm -C apps/standalone/Orbis typecheck
```

Run the JavaScript test suites without invoking unrelated Swift, driver, or native builds:

```sh
pnpm -C apps/integrated/Amove exec vitest run
pnpm -C apps/integrated/Bonded exec vitest run
pnpm -C apps/integrated/Shout exec vitest run
pnpm -C apps/standalone/Exithibition exec vitest run
pnpm -C apps/standalone/Orbis exec vitest run
```

If a consumer check fails, first determine whether the failure exposes a public contract change. Do not edit nested repositories to accommodate an accidental interface break. Fix the root adapter so the existing contract remains valid.

### Build checks

Because package exports point directly to TypeScript source and the new private module sits behind two exported modules, build at least one consumer of each public path:

```sh
pnpm -C apps/integrated/Amove build:app
pnpm -C apps/standalone/Exithibition build:renderer
```

These Electron Vite builds verify that the bundler follows the relative private import from both package subpaths. Do not use Orbis's `build:app` for this check: its `prebuild:app` lifecycle script builds a worker and native Rust artifact, which is outside this refactor.

### Manual behavior assessment

This change has no renderer or visual layout change. Browser testing does not exercise Electron main-process window ownership. The focused Electron fakes cover the lifecycle state machine and error paths that are difficult to trigger manually.

If an Electron runtime is available, perform a short smoke check after automated verification:

1. Launch Amove in standalone mode; it is the integrated consumer with an existing surface-recreation path.
2. Confirm its window remains hidden until renderer readiness completes.
3. Exercise activation while the window exists, then close and reopen it through Amove's existing flow.
4. Launch Orbis or Exithibition, confirm readiness and activation while its window exists, then close it normally. These applications quit on the last closed window and do not recreate a surface in-process.
5. Confirm no duplicate appearance IPC handler error appears in logs during Amove's recreation or after relaunching the standalone-only application.

Do not make packaging or release work part of this refactor.

## Acceptance criteria

The implementation is complete when all of the following are true:

- One private module owns the standalone `BrowserWindow` lifecycle used by both public adapters.
- `acquireFeatureSurface` and `acquireStandaloneSurface` keep their existing public names, parameters, result types, and package subpaths.
- Suite-mode Feature surface behavior is unchanged.
- The Standalone surface remains independent of FeatureContext and the Feature catalog.
- Feature catalog facts remain in the Feature surface host adapter.
- Standalone app facts remain in the Standalone surface adapter.
- Secure Electron settings cannot be overridden through the private options interface.
- Both paths validate invalid resources before constructing a window.
- `ready()` coalesces concurrent calls and loads once.
- Renderer load and `show()` failures clean appearance state and destroy the window.
- External close during appearance registration cannot leak the eventual disposer.
- Activation performs no window action after disposal or destruction; disposal performs appearance cleanup at most once and never destroys an already-destroyed window.
- Appearance cleanup runs once and before explicit window destruction.
- Adapter tests cover domain translation; private-module tests cover lifecycle behavior.
- The old duplicate lifecycle blocks and helpers are deleted from both adapters.
- The private module is absent from package exports.
- Root tests, root type checks, direct-consumer type checks, direct-consumer Vitest suites, and one build per public path pass.
- Root and nested worktree status is reviewed before any later commit so unrelated changes remain untouched.

## Out of scope

Do not:

- merge the two public surface interfaces;
- export the private owned-window module;
- change FeatureContext or Feature resource maps;
- move or redesign Feature catalog facts;
- move controllers, IPC, runtime leases, presence policy, or renderer ownership;
- change appearance persistence formats or registry semantics;
- add lifecycle hooks or a general window framework;
- add a dependency-injection interface solely for tests;
- alter standalone launch behavior;
- edit standalone-only application contracts;
- change renderer UI, styling, or preload bridges;
- update unrelated documentation;
- build native artifacts, package applications, publish, or release.
