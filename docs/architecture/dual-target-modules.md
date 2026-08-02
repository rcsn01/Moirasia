# Dual-target application modules

## Goal

Every product remains an independently buildable and releasable application.
The same product source can also run inside Moirasia without launching the
standalone application and without copying its UI or business logic into the
Moirasia repository.

This is a dual-target system:

```text
                         canonical feature/runtime code
                                      |
                    +-----------------+-----------------+
                    |                                   |
             standalone adapter                  module adapter
                    |                                   |
            ProductName.app                 ProductName.moirasia-module
                                                        |
                                                  Moirasia.app
```

The `.app` and module are separate build products, not separate
implementations.

## Repository ownership

Application code stays in the application's repository under `apps/`. Moirasia
owns only the host, the module SDK, and generic host services. In particular,
Moirasia must not contain copied trees such as:

- `src/renderer/amove/`
- `src/renderer/vox/`
- `src/renderer/exithibition/`
- `src/modules/amove/`, `src/modules/vox/`, or `src/modules/exithibition/`
- app-specific native implementations under root `native/`

Compiled module artifacts are copied into a packaged Moirasia application, but
generated artifacts are not canonical source and are not committed.

The application repositories should become Git submodules once Vox has a
remote. This preserves their independent histories and lets Moirasia pin an
exact compatible revision. Until then, local development can discover them by
path, but release and CI builds are not reproducible.

## Module artifact

Each application publishes a sealed macOS bundle with one of two payload
types. The outer `Contents/Info.plist` lets the artifact participate in strict
code-signing verification; the module manifest and payload live in
`Contents/Resources`:

```text
Amove.moirasia-module/
  Contents/Info.plist
  Contents/Resources/manifest.json
  Contents/Resources/main/index.mjs
  Contents/Resources/preload/index.cjs
  Contents/Resources/renderer/index.html
  Contents/Resources/renderer/assets/...
  Contents/Resources/native/...

Exithibition.moirasia-module/
  Contents/Info.plist
  Contents/Resources/manifest.json
  Contents/Resources/native/ExithibitionModule.bundle
```

The manifest includes at least:

```json
{
  "apiVersion": 1,
  "id": "amove",
  "name": "Amove",
  "kind": "web",
  "platforms": ["darwin", "win32", "linux"],
  "entry": "main/index.mjs",
  "preload": "preload/index.cjs",
  "renderer": "renderer/index.html",
  "capabilities": ["accessibility", "global-shortcuts", "utility-windows"],
  "dataOwner": "com.opense.Amove"
}
```

Moirasia validates the API version, paths, platform, and declared capabilities
before loading any code. Each standalone application embeds its own artifact
under `Contents/PlugIns/`. These local-only builds use ad-hoc signing: it
provides integrity verification, but no publisher identity or Team ID trust.

## Lifecycle contract

The root module SDK defines a small lifecycle contract. Application adapters
implement it; Moirasia's manager invokes it.

```ts
interface MoirasiaModule {
  readonly manifest: ModuleManifest
  start(context: ModuleContext): Promise<ModuleSurface>
  activate(): Promise<void>
  deactivate(): Promise<void>
  canClose(): Promise<CloseDecision>
  stop(): Promise<void>
}
```

`ModuleContext` supplies scoped host services instead of allowing application
code to depend on Moirasia internals:

- application data and cache locations;
- renderer surface and utility-window creation;
- namespaced renderer IPC;
- global shortcut and menu registration;
- file dialogs, external links, notifications, and secrets;
- permission status and requests;
- a cancellation signal and a resource ledger.

Every registered window, shortcut, IPC handler, helper process, listener, and
lock is recorded in the module's resource ledger. `stop()` performs graceful
application cleanup; the host then closes anything still registered. A module
is stopped only after its renderer, utilities, native helpers, IPC handlers,
and data handles have been released.

The existing shell manager's start, activate, deactivate, warning, and stop
states are a useful basis for this contract. The registry must discover module
artifacts instead of importing app-specific root implementations.

## Web and Electron applications

Amove, Vox, and Mini-NSW use their existing renderer code directly. Their main
process entry points become thin standalone adapters over reusable controllers:

```text
src/
  feature/                 UI, state, and business logic
  platform/                interfaces for host capabilities
  hosts/
    standalone-electron.ts owns Electron app lifecycle
    moirasia.ts            implements MoirasiaModule
```

The standalone adapter creates top-level `BrowserWindow` instances. The module
adapter asks `ModuleContext` for a `WebContentsView` surface. Both use the same
controller, renderer entry, preload API, native helpers, settings schema, and
tests.

Code below the adapter boundary must not call global Electron lifecycle APIs
such as `app.quit()`, `app.setPath()`, or `Menu.setApplicationMenu()`. It asks
the supplied host services instead. Product-specific utility windows such as
Amove's shelf and Vox's overlay are still created from the product's canonical
code, but in module mode they are owned and cleaned up by Moirasia.

Renderer isolation remains intact: each web module gets a sandboxed
`WebContentsView`, a unique session partition, and a namespaced preload bridge.
Business work that does not need Electron APIs may run in an Electron utility
process for crash isolation. Such a process is an internal helper, not another
macOS application and has no Dock identity.

## Tauri applications

LiteMaptica reuses its React renderer in the same web-module format. Its UI
already routes engine work through a small `rpc()` boundary. That boundary gets
two implementations:

- Tauri `invoke()` for the standalone application;
- Moirasia IPC for module mode.

The existing Rust/Python engine remains owned by LiteMaptica and is packaged as
a module helper. Dialog calls similarly use an injected dialog service instead
of importing Tauri directly from feature components.

## SwiftUI applications

Exithibition cannot be loaded from its standalone executable. Its canonical
views, models, sampling code, and resources become an `ExithibitionFeature`
Swift package with two thin targets:

- `Exithibition.app` supplies the SwiftUI `App` scene;
- `ExithibitionModule.bundle` supplies a plug-in principal class that creates
  an `NSHostingController` for the same `DashboardView`.

Moirasia owns one generic macOS native-view bridge. It loads a signed plug-in
bundle, obtains the module's `NSViewController`, and attaches its view to the
module content region of the Moirasia window. The bridge is infrastructure; it
contains no Exithibition UI or telemetry logic.

This native surface must pass a focused gate covering layout during resize,
focus and keyboard routing, accessibility, appearance changes, module
switching, sampling shutdown, and repeated attach/detach cycles. If Electron
cannot host the native view reliably, Exithibition remains unavailable and its
module is deferred; it is not replaced with a React implementation and the
standalone app is not launched as a substitute.

Semiquaver is currently an iOS application. It can remain standalone, but it
cannot publish a macOS Moirasia module until its feature view and dependencies
support macOS.

## Identity, permissions, and data

Standalone mode runs under the product's bundle identifier. Module mode runs
inside `com.moirasia.desktop`, so macOS privacy permissions belong to Moirasia
in module mode. The application must therefore tolerate separate permission
grants while sharing the same functional code.

The module manifest declares the product's data owner. Both modes use the same
data schema and application-support directory unless a migration explicitly
changes it. A cross-product runtime lock prevents standalone and module modes
from opening the same mutable data simultaneously. Standalone applications must
adopt the same lock protocol; a lock conflict offers the user a choice to close
the other mode rather than risking corruption.

Keychain access groups and signed builds need an explicit migration plan before
module mode shares existing secrets. Secrets must never be copied into Moirasia
configuration files.

## Versioning and distribution

The module SDK and manifest are versioned. Moirasia rejects an incompatible
module with an actionable error before starting it. A Moirasia release pins the
source revision and module artifact version for every bundled product.

Standalone release pipelines remain in the individual repositories. Each app
adds a `module:build` equivalent that produces its module artifact from the same
source. Moirasia's build verifies manifests, hashes artifacts, runs contract
tests, stages them, and signs them as part of the final application.

## Migration order

1. Back out the copied application implementations while retaining the generic
   shell, manager, settings, and lifecycle tests that do not encode a copied UI.
2. Add `packages/module-sdk` and artifact discovery/validation to Moirasia.
3. Convert Amove to dual-target mode as the first web proof. Verify that its
   standalone and module builds render the same UI and pass the same controller
   tests.
4. Convert Vox, including its overlay, native speech helper, permissions, and
   shutdown behavior.
5. Build the native-view spike using Exithibition's real `DashboardView`. Do not
   port the dashboard to React.
6. Convert Mini-NSW and LiteMaptica after the web and helper-process contracts
   are stable.
7. Add Semiquaver only after a macOS-compatible feature target exists.

## Acceptance criteria

- Changing a product UI requires one source edit and appears in both builds.
- Every product still builds and runs as its own standalone application.
- Starting a module creates no additional Dock application or standalone app
  process.
- Closing a module releases all of its views, helpers, shortcuts, IPC handlers,
  locks, and data handles without quitting Moirasia.
- Standalone and module modes cannot mutate the same data concurrently.
- Moirasia contains no copied product UI or business logic.
- A module crash or startup failure is reported without leaving resources or a
  permanent loading state behind.
