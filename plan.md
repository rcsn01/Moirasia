# Plan: Deepen the feature surface host — `acquireFeatureSurface`

**Status:** Approved for implementation · **Date:** 2026-09-07
**Source:** Architecture review candidate 1 (`Strong`). Vocabulary: `CONTEXT.md` (domain) and the codebase-design glossary (module, interface, implementation, seam, adapter, leverage, locality).

---

## 1. Problem and evidence

Every embedded feature re-implements the host-mode surface: in suite mode, use the shell's `EmbeddedFeatureSurface` (never own a window); in standalone mode, create, guard, theme, load, show, activate, and destroy a private `BrowserWindow`. The interface each feature must know is nearly as complex as the implementation — four shallow copies of one deep concern, with drift:

| | Amove | Exithibition | Bonded | Orbis |
|---|---|---|---|---|
| Window creation | `app-controller.ts` `createMainWindow` | `controller.ts` `createView` | inline in `feature.ts` | `createWindow` helper |
| Guards | deny + allow-same-url | **none** (drift) | **none** (drift) | deny-all |
| Appearance | standalone-only, `applyNativeTheme: true` | standalone-only, `true` | standalone-only, default `true` | standalone-only, `true` |
| Initial background | `neutralWindowBackground('system')` | `neutralWindowBackground('dark')` | `'system'` | `'system'` |
| `spellcheck` | unset (on) | unset (on) | **`false`** (drift) | unset (on) |
| Show timing | after load | `ready-to-show` | `did-finish-load` | after load |
| URL detection | `isRendererUrl` | `isRendererUrl` | `/^https?:\/\//` | `startsWith('http')` |
| activate() standalone | show + focus | show + focus | **restore** + show + focus | show + focus |
| activate() suite | `surface.activate()` | `surface.activate()` | activate + **focus** | activate only |
| dispose() | appearance → destroy | appearance → destroy | IPC → appearance → stop → destroy | IPC → appearance → close → destroy |

Files (the duplicated implementation):

```
apps/integrated/Amove/src/main/app-controller.ts        (createMainWindow, ~35 lines of the 337)
apps/integrated/Amove/src/main/feature.ts                (42 lines, thin today)
apps/integrated/Bonded/src/main/feature.ts               (105 lines, ~80% window lifecycle)
apps/integrated/Exithibition/src/main/controller.ts     (createView in a 149-line file)
apps/integrated/Exithibition/src/main/feature.ts        (33 lines, thin today)
apps/integrated/Orbis/src/main/feature.ts               (155 lines; createWindow/loadRenderer/installWindowGuards helpers)
packages/desktop-shell/src/feature.ts                   (contracts + validateFeatureResources)
packages/desktop-shell/src/main.ts                       (desktopWindowChromeOptions, neutralWindowBackground, registerProductAppearance, DEFAULTS)
packages/desktop-shell/src/feature-catalog.ts            (pure-data single owner of feature facts)
```

Deletion test: delete a shared module and the window lifecycle reappears in four callers, with the drift above re-seeded. Test coverage today: only Bonded (`tests/feature.test.ts`) and Orbis (`tests/orbis-feature.test.ts`) have feature-level lifecycle tests; Amove and Exithibition lifecycles have none; every existing test must re-mock `electron` and re-state the window double. The lifecycle is tested nowhere once, as one interface.

---

## 2. Decisions (design tree, recommended answers adopted)

### Round 1 — shape of the deep module

**Q1 What does the module own — the standalone window, or the whole host-mode surface?**
➡️ The whole host-mode surface. The suite/standalone discrimination (`surface.webContents` vs a private window, and the mode-branched `activate()`/`dispose()` bodies) is half the duplication; owning only the window would leave four callers still branching. The module resolves a feature's *primary surface* in either mode: suite → the shell surface, standalone → a host-owned window. Suite mode never creates, loads, shows, or destroys anything — the shell window belongs to `EmbeddedFeatureHost`, untouched.

**Q2 Where does the seam live?**
➡️ New file `packages/desktop-shell/src/feature-surface-host.ts`, new export `@moirasia/desktop-shell/feature-surface-host` (one `package.json` `exports` entry). Not folded into `./feature` (it stays type-only and renderer-bundlable; the host imports the `BrowserWindow` runtime value) and not re-exported through `./main` (the host imports `./main`'s appearance helpers — re-exporting through `./main` would make a cycle). No existing export changes.

**Q3 One-shot acquire, a hook bag, or a staged interface?**
➡️ Staged: `acquireFeatureSurface(ctx)` returns a handle with a live `webContents` and an **unloaded, hidden** standalone window; the feature then wires its own controllers/IPC; then `await handle.ready()` loads the renderer and shows. The feature's own code between acquire and ready *is* the wire step — no `beforeLoad`/`wire`/`onDispose` callbacks, no LIFO disposer stack, no template-method inversion. This preserves the strongest ordering invariant (Bonded/Orbis/Exithibition register IPC **before** the renderer loads) while leaving each feature's exact sequence visible in the feature. A one-shot acquire would load before wiring (IPC race, or a hook parameter to work around it); a hook bag would make the interface as complex as the implementation with the logic moved behind it — the shallow-module trap, inverted.

**Q4 What's in the handle — is `window` exposed?**
➡️ Six members: `mode`, `webContents`, `window`, `ready()`, `activate()`, `dispose()`. `window` is exposed read-only, standalone-only (`undefined` in suite): Orbis parents `dialog.showOpenDialog` to it and Amove attaches its presence listeners to it. The host owns the lifecycle (creation, load, show, appearance, destroy); products may observe and act on the window, never create or destroy it. No `state`/`subscribe` on the standalone handle — Amove's hotkey policy is the only consumer and it already reads `ctx.surface` in suite mode and window focus events in standalone; mirroring surface state onto the window would be implementation without a second caller.

### Round 2 — facts and policies

**Q5 Who owns the window facts (title, geometry, fullscreenable, navigation policy)?**
➡️ The feature catalog — `standaloneWindow` facts per entry, still pure data (numbers and strings, no Electron import, renderer-bundlable). The title comes from the existing `label`. `buildCatalog` validates them at import time. This keeps the catalog the single owner of shared feature facts, as its charter already claims. Amove's icon stays product wiring (`options.icon`) because Amove's tray and dock reuse the same computed path.

**Q6 Who owns the default appearance (Exithibition's 'dark' background)?**
➡️ `main.ts` `DEFAULTS` already owns it. Export `defaultProductAppearance(productId)` from `main.ts`; the host backgrounds the window with `neutralWindowBackground(defaultProductAppearance(id))`. Exithibition keeps its dark window; no new fact owner.

**Q7 Who validates the context?**
➡️ The host calls `validateFeatureResources(ctx)` first, in both modes, before any side effect. All four features call it today; the fifth feature cannot forget it. Orbis's manual "resources are incomplete" re-check dies (the catalog's per-mode requirement tables already cover `workers.scan` and `dataDirectory`).

**Q8 Appearance registration policy?**
➡️ Verified uniform in all four sources: standalone-only, `registerProductAppearance(productId, window, undefined, { applyNativeTheme: true })`, disposer paired with destroy. The host owns it entirely; features stop importing `registerProductAppearance`. Suite mode registers nothing (the shell owns suite appearance).

**Q9 Guard policy?**
➡️ `setWindowOpenHandler` deny for every standalone window; `will-navigate` policy from the catalog fact `navigation` — `'deny'` (default: prevent everything) or `'allow-same-url'` (Amove: also permits reload/same-URL navigation). This closes the live drift: Bonded and Exithibition standalone windows are unguarded today.

**Q10 Show timing?**
➡️ One policy: show once after the renderer load resolves (`ready()`). Bonded's `did-finish-load`, Exithibition's `ready-to-show`, and Orbis/Amove's post-`await` show all encode "show when the renderer is ready"; one deterministic policy replaces three. `spellcheck: false` becomes uniform (Bonded's precedent; product UIs).

**Q11 External window close / recreate-on-demand (Amove)?**
➡️ The host listens for the window's `closed` event and marks itself disposed (appearance cleaned up); `dispose()` is idempotent after that. Amove's recreate-on-demand calls `acquireFeatureSurface` again for a fresh handle — its `showMainWindow` keeps exactly today's semantics.

### Round 3 — product wiring, testing, rollout

**Q12 What stays product-owned (honest leaks through the interface)?**
➡️ Controllers, `registerIpc`, Bonded's runtime lease, Amove's presence policy (close-to-hide, tray, dock icon, taskbar quit), Orbis's dialog parenting and worker factory, Exithibition's space handler and powerMonitor hooks, the `ctx.id` guard, and each feature's exact wiring order. The host hands over `webContents` and `window`; it never learns what a controller is.

**Q13 Are the per-feature wiring orders preserved?**
➡️ Yes, each feature keeps its sequence using the handle: Bonded — lease → controller → IPC → `start()` → `ready()` → `excludeProcess(pid)` (was `did-finish-load` in standalone, pre-`start` in suite; both collapse to post-ready, equivalent per the standalone precedent). Orbis — controller + `initialize()` → IPC → `ready()`. Exithibition — IPC + space handler → `ready()` → native start (load-before-native preserved). Amove — settings → `ready()` (at `createMainWindow`'s position) → presence → hotkeys; IPC after `start()`, as today.

**Q14 Test seam?**
➡️ Electron is true-external (mock category): the host's own tests live at the root (`tests/feature-surface-host.test.ts`) and cross its interface with a `vi.mock('electron')` double plus a `vi.mock` of the sibling `./main` appearance helpers; every assertion is an observable outcome (created options, load calls, show/destroy/restore calls, appearance registration and disposal). Per-feature composition tests keep the **real host** behind their existing electron doubles — replace, don't layer: the window-lifecycle assertions that mattered move to the host's matrix; feature tests shrink to product wiring. `ExithibitionController`'s test passes a five-field fake handle — the second adapter (real host in production, fake in tests) that makes the handle's seam real. A new minimal Amove wiring test closes the coverage gap.

**Q15 Migration order?**
➡️ Host + tests first (additive, no callers), then Exithibition (simplest, worst guard drift) → Orbis → Bonded → Amove (heaviest restructure) → docs. One commit per step; each app migrates independently.

**Q16 Docs?**
➡️ `CONTEXT.md` term **Feature surface host** added with this plan (done). `docs/architecture/standalone-applications.md` paragraphs about feature-owned standalone windows updated in the final step (see §7 step 9).

---

## 3. Design-it-twice comparison (three sub-agent designs)

| | A — minimize | B — maximise flexibility | C — optimise common caller |
|---|---|---|---|
| Shape | `launchStandaloneSurface(ctx, attach?)` → standalone-only surface; suite mode untouched (features keep `ctx.surface`) | `createFeatureSurfaceHost(ctx)` → `{ launch(spec), onDispose(fn), dispose() }`; full `FeatureSurface` with `state`/`subscribe` in both modes | `defineFeatureSurface(id, wire)` returns a whole `MoirasiaFeature`; plus a parts door `createFeatureWindow` for Amove |
| Facts | catalog `standaloneWindow` (sizes, navigation, `iconAsset`) | spec param per call site (geometry, background, show strategy, `beforeLoad`) | catalog facts + `defaultProductAppearance` |
| Depth | high for the standalone window; the suite/standalone discrimination and mode-branched `activate()` stay in four callers | deepest unification (state/subscribe/relaunch in both modes) | highest collapse for the 3-of-4 shape (Bonded becomes a wire function) |
| Cost | half the duplication left behind; `attach` is an escape hatch doing Amove's work | machinery with one user each: show strategies (1), LIFO disposer stack (0 needed — features have their own `dispose`), spec-carried geometry re-stating facts per call site | two doors; `wiring()` accessor for Orbis's menu; rewrites feature classes as factories (touches the most product code); Amove's suite half still hand-written |
| Verdict | right facts, wrong scope | right unification, too much interface | right leverage, wrong ownership shift |

**Chosen: hybrid, A/C-facts with a B-shaped handle, staged.** One entry point (`acquireFeatureSurface`) like A; catalog-owned facts and zero per-call configuration like C; a handle that covers **both** host modes like B, but without `state`/`subscribe`/`onDispose`/show strategies (each has at most one caller — hypothetical seams). The staged `acquire → wire → ready` replaces both A's `attach` callback and B's `beforeLoad` hook: the feature's own code is the wire step, so Bonded/Orbis/Exithibition keep IPC-before-load and Amove keeps IPC-after-show with the same interface. Features keep their classes (Orbis keeps public `addLocation`/`rescan`; Bonded keeps its lease error path; Amove keeps `shouldQuitWhenWindowAllClosed`).

---

## 4. The interface

New file `packages/desktop-shell/src/feature-surface-host.ts`:

```ts
import { BrowserWindow, type WebContents } from 'electron'
import { defaultProductAppearance, desktopWindowChromeOptions, neutralWindowBackground, registerProductAppearance } from './main'
import { featureCatalog, validateFeatureResources, type FeatureContext, type FeatureHostMode } from './feature'

export interface FeatureSurfaceOptions {
  /** Standalone window icon (Amove's app icon; the tray/dock reuse the same path). */
  readonly icon?: string
  /** webPreferences.devTools override (Amove disables under CI). Default: Electron's true. */
  readonly devTools?: boolean
}

/**
 * The feature's primary surface, in either host mode. Suite: the shell surface
 * (this handle never creates, loads, shows, or destroys anything). Standalone:
 * a host-owned window — hidden until ready(), guarded, appearance-managed,
 * destroyed on dispose() (never close()).
 */
export interface FeatureSurfaceHandle {
  readonly mode: FeatureHostMode
  /** The IPC target: the shell webContents in suite mode, the standalone window's otherwise. */
  readonly webContents: WebContents
  /** The standalone window when the host owns it; undefined in suite mode. Observe and act on it (dialogs, listeners); never create or destroy it. */
  readonly window: BrowserWindow | undefined
  /** Load the standalone renderer and show the window. No-op in suite mode. Awaits the load; rejects after cleaning up. */
  ready(): Promise<void>
  /** Suite: surface.activate() + focus(). Standalone: restore-if-minimized → show → focus. */
  activate(): void
  /** Standalone: dispose product appearance, then destroy the window. Idempotent; no-op in suite mode. */
  dispose(): void
}

/** Validate the context against the catalog's per-mode requirements, then acquire
 *  the feature's primary surface. Window facts come from the catalog entry;
 *  the initial background from the shared appearance defaults. */
export async function acquireFeatureSurface(
  context: FeatureContext,
  options: FeatureSurfaceOptions = {}
): Promise<FeatureSurfaceHandle>
```

`packages/desktop-shell/src/main.ts` gains:

```ts
/** The product's default appearance — DEFAULTS stays the single owner of the seed table. */
export function defaultProductAppearance(product: ProductId): Appearance { return DEFAULTS[product] }
```

`packages/desktop-shell/src/feature-catalog.ts` gains (pure data, still no Electron import):

```ts
export interface StandaloneWindowFacts {
  readonly width: number
  readonly height: number
  readonly minWidth: number
  readonly minHeight: number
  /** Whether the standalone window may go fullscreen (Bonded: false). Default true. */
  readonly fullscreenable?: boolean
  /** will-navigate policy: 'deny' prevents all navigations; 'allow-same-url' additionally
   *  permits reload/same-URL navigation (Amove). Default 'deny'. window-open is always denied. */
  readonly navigation?: 'deny' | 'allow-same-url'
}
// FeatureCatalogEntry +=  readonly standaloneWindow: StandaloneWindowFacts
```

Seeds (verified against today's four creation sites; titles are the existing `label`):

```ts
amove:        { width: 1180, height: 760, minWidth: 980,  minHeight: 700, navigation: 'allow-same-url' }
exithibition: { width: 1180, height: 760, minWidth: 1080, minHeight: 690 }
bonded:       { width: 430,  height: 600, minWidth: 390,  minHeight: 500, fullscreenable: false }
orbis:        { width: 1280, height: 820, minWidth: 860,  minHeight: 600 }
```

`buildCatalog` validation for the new facts: positive integers, `minWidth ≤ width`, `minHeight ≤ height`, known `navigation` value, `fullscreenable` if present must be `false` (the default is true). `package.json` `exports` gains `"./feature-surface-host": "./src/feature-surface-host.ts"`.

---

## 5. Canonical lifecycle, invariants, error modes

The implementation — the point is that this exists **once**:

```
acquireFeatureSurface(context, options):
 1  validateFeatureResources(context)          # catalog per-mode table; throws before any side effect
 2  if (context.mode === 'suite') return suiteHandle(context.surface)
    # suiteHandle: webContents = surface.webContents; ready() = resolved no-op;
    # activate() = surface.activate() + surface.focus(); dispose() = no-op; window = undefined
 3  entry  = featureCatalog.get(context.id)
 4  preload = context.paths.preloads?.main     # guaranteed by validation; a missing value throws here
 5  window = new BrowserWindow({
      title: entry.label, width, height, minWidth, minHeight, show: false,
      ...desktopWindowChromeOptions(),
      fullscreenable: entry.standaloneWindow.fullscreenable ?? true,
      backgroundColor: neutralWindowBackground(defaultProductAppearance(context.productId)),
      ...(options.icon ? { icon: options.icon } : {}),
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
                        ...(options.devTools !== undefined ? { devTools: options.devTools } : {}) }
    })
 6  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
 7  installNavigationGuard(window, entry.standaloneWindow.navigation ?? 'deny')
    # 'deny': preventDefault always. 'allow-same-url': preventDefault only when url !== webContents.getURL()
 8  disposeAppearance = await registerProductAppearance(context.productId, window, undefined, { applyNativeTheme: true })
    # on rejection: window.destroy(); rethrow
 9  window.on('closed', () => markDisposed())   # external close cleans the appearance; handle goes inert
10  return standaloneHandle(window, disposeAppearance)

handle.ready():                                   # standalone only
    if (disposed || loaded) return resolved       # idempotent
    renderer = context.paths.renderers?.main      # guaranteed by validation
    try: await (isHttpUrl(renderer) ? window.loadURL(renderer) : window.loadFile(renderer))
    catch: dispose(); throw                        # appearance disposed, window destroyed, error propagates
    if (!window.isDestroyed()) window.show()

handle.activate():                                # standalone
    if (!window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus() }
handle.activate():                                 # suite
    surface.activate(); surface.focus()

handle.dispose():                                  # standalone; idempotent
    if (disposed) return; markDisposed()
    disposeAppearance?.(); disposeAppearance = undefined
    if (!window.isDestroyed()) window.destroy()
```

**Invariants (the interface, beyond the types):**

- `acquireFeatureSurface` runs validation first; failures throw before any window exists.
- Suite mode never touches the shell window: no creation, no load, no show, no destroy, no appearance registration. `EmbeddedFeatureHost` keeps sole ownership.
- The standalone window is created hidden and stays unloaded until `ready()`; show happens exactly once, after the first successful load.
- Features wire IPC/controllers between `acquire` and `ready`; the host imposes no wiring order beyond that window.
- Appearance is registered only when the host owns the window, with `applyNativeTheme: true`, and is disposed exactly once — on `dispose()`, on `ready()` failure, or on external `closed`.
- `dispose()` uses `destroy()`, never `close()` — Amove's close-to-hide listeners never fire during teardown (today's discipline, now guaranteed).
- A closed/destroyed window marks the handle disposed; later `dispose()` is a no-op; a replacement surface requires a fresh `acquireFeatureSurface`.
- The host reads only named resource maps (`preloads.main`, `renderers.main`); it never uses the deprecated `preload`/`rendererUrl`/`rendererFile` spellings.

**Error modes:** validation failure (before side effects); window-constructor or appearance failure (window destroyed, error rethrown); `ready()` load failure (appearance disposed, window destroyed, error rethrown — the feature's `catch` cleans only its own controller/lease/IPC). `FeatureRuntime`'s existing register-rollback (`try { dispose() } catch {}`) hits an idempotent handle and is harmless.

---

## 6. What the implementation hides vs. what stays product-owned

**Hidden behind the seam (locality):** the suite/standalone discrimination; `BrowserWindow` construction with chrome options, sandbox posture, and catalog geometry; the initial background join with the shared appearance defaults; guard installation and the navigation policies; standalone-only appearance registration and disposal; URL-vs-file renderer resolution (today four divergent spellings); show-after-load choreography; activation re-focus with restore-if-minimized; destroy-not-close teardown; idempotency, external-close tolerance, and rollback ordering.

**Product-owned, passed as data or wired against the handle (honest leaks):** controllers and their start/stop; `registerIpc`; Bonded's runtime lease and its `excludeProcess` timing; Amove's presence policy (close-to-hide, `closed`→taskbar quit, tray, dock icon), hotkey policy, and window focus/blur listeners; Orbis's dialog parenting and worker factory; Exithibition's space handler and powerMonitor hooks; the `ctx.id` guard; each feature's wiring order; the Amove icon path and CI devTools policy (`options`).

---

## 7. Implementation steps

Each step is one commit. Verify after every step.

### Step 1 — catalog facts (pure data)

- `feature-catalog.ts`: add `StandaloneWindowFacts`, the `standaloneWindow` field on `FeatureCatalogEntry`, the four seeds above, and `buildCatalog` validation.
- `tests/feature-catalog.test.ts`: pin the four fact sets; assert validation rejects non-positive sizes, `min > size`, and unknown `navigation`.
- Verify: `pnpm typecheck && pnpm test`.

### Step 2 — `defaultProductAppearance` (single owner stays single)

- `main.ts`: export `defaultProductAppearance` (one line over `DEFAULTS`); keep `DEFAULTS` private.
- `tests/appearance-registry.test.ts`: one case — `defaultProductAppearance('exithibition') === 'dark'`, `'bonded' === 'system'`.
- Verify: `pnpm typecheck && pnpm test`.

### Step 3 — the host and its test surface (additive, no callers yet)

- New `packages/desktop-shell/src/feature-surface-host.ts` implementing §5; `package.json` gains the export entry.
- New `tests/feature-surface-host.test.ts` — the §8 matrix. Double: `vi.hoisted` `FakeWindow` (records constructor options; `loadURL`/`loadFile` toggleable-resolvable; `show`/`focus`/`restore`/`isMinimized`/`setFullScreenable`/`destroy`/`isDestroyed` spies; `webContents` with `setWindowOpenHandler`/`on`/`getURL`/`getOSProcessId`), `vi.mock('electron')`, and `vi.mock('../packages/desktop-shell/src/main')` for `registerProductAppearance` (returns a dispose spy), `neutralWindowBackground`, `desktopWindowChromeOptions`, `defaultProductAppearance`. Real catalog and real `validateFeatureResources` — the fact joins are pinned against actual catalog data.
- Verify: `pnpm typecheck && pnpm test`.

### Step 4 — migrate Exithibition (worst guard drift dies)

New `apps/integrated/Exithibition/src/main/feature.ts` in full:

```ts
import { acquireFeatureSurface, type FeatureSurfaceHandle } from '@moirasia/desktop-shell/feature-surface-host'
import type { FeatureContext, MoirasiaFeature } from '@moirasia/desktop-shell/feature'
import { ExithibitionController } from './controller'

class ExithibitionFeature implements MoirasiaFeature {
  readonly id = 'exithibition'
  #controller: ExithibitionController | undefined
  #surface: FeatureSurfaceHandle | undefined

  async register(ctx: FeatureContext): Promise<void> {
    if (this.#controller) return
    if (ctx.id !== this.id || ctx.productId !== 'exithibition') throw new Error('Invalid Exithibition feature context')
    const surface = await acquireFeatureSurface(ctx)
    const controller = new ExithibitionController(ctx, surface)
    try {
      this.#controller = controller
      this.#surface = surface
      await controller.start()
    } catch (error) {
      this.#controller = undefined
      this.#surface = undefined
      await controller.stop().catch(() => undefined)
      surface.dispose()
      throw error
    }
  }

  async dispose(): Promise<void> {
    const controller = this.#controller
    const surface = this.#surface
    this.#controller = undefined
    this.#surface = undefined
    try { await controller?.stop() } finally { surface?.dispose() }
  }

  activate(): void { this.#controller?.activate() }
  setActive(active: boolean): void { this.#controller?.setActive(active) }
}

export const feature: MoirasiaFeature = new ExithibitionFeature()
```

`ExithibitionController` changes: constructor takes `(ctx, surface: FeatureSurfaceHandle)`; `start()` becomes `registerIPC()` → `installSpaceHandler(surface.webContents)` → `await surface.ready()` (was `createView`'s load+show) → native client + powerMonitor; `stop()` drops the appearance disposal and `view.destroy()` (the feature's `surface.dispose()` owns both); `authorize`/`broadcast` read `surface.webContents`; `activate()` delegates to `surface.activate()`. Delete `createView` and `isRendererUrl`.

`exithibition-controller.test.ts`: pass a fake handle (`{ mode, webContents, window: FakeWindow, ready: vi.fn(async () => {}), activate, dispose }`) — the second adapter that makes the controller's seam real. Verify: `pnpm -C apps/integrated/Exithibition typecheck && pnpm -C apps/integrated/Exithibition test` + root gates.

### Step 5 — migrate Orbis

`OrbisFeature` changes: `acquireFeatureSurface(ctx)` replaces `createWindow`/`installWindowGuards`; `registerIpc({ webContents: surface.webContents, … })` before `await surface.ready()`; the dialog adapter binds to `surface.window`; `createOrbisSystemShell(() => surface.webContents)` replaces the `let target` union dance; `activate()` becomes `surface.activate()`; `dispose()` keeps its order (IPC → `controller.close()` → `surface.dispose()`); the register-catch keeps its rollback (IPC → `controller.close()` → `surface.dispose()` → field reset). Delete `createWindow`, `loadRenderer`, `installWindowGuards`, `isRendererUrl`. Keep the worker-factory env logic and the `initialize()`-before-IPC ordering (controller published before initialization so a host shutdown can close a loading index).

`orbis-feature.test.ts`: add `isMinimized`/`restore` spies to `FakeWindow`; keep the real host behind the existing electron and `./main` mocks; assertions stand (suite: zero windows; standalone: one window, `loadFile('/tmp/orbis-renderer.html')`, worker only on demand, dispose terminates worker and clears handlers).

Verify: `pnpm -C apps/integrated/Orbis typecheck && pnpm -C apps/integrated/Orbis test` + root gates.

### Step 6 — migrate Bonded

`BondedFeature.#register` becomes: guard → `acquireFeatureSurface(ctx)` → lease → controller → `registerIpc({ webContents: surface.webContents, controller })` → `await controller.start()` → `await surface.ready()` → `controller.excludeProcess(surface.webContents.getOSProcessId())`. Catch: `disposeIpc` → `controller.stop()` → `lease.release()` → `surface.dispose()` → rethrow. `activate()` → `surface.activate()`. `dispose()` keeps today's order (IPC → `controller.stop()` → `surface.dispose()` → `lease.release()`), replacing the appearance/window/appearance-field block. The `#registration` coalescing stays.

`feature.test.ts`: the double's `webContents` gains `on`/`off` spies (the host installs the navigation guard); `excludeProcess` is now asserted after `ready()` resolves in both modes. Verify: `pnpm -C apps/integrated/Bonded typecheck && pnpm -C apps/integrated/Bonded test && pnpm -C apps/integrated/Bonded build:renderer` + root gates.

### Step 7 — migrate Amove (heaviest: the presence policy stays, the boilerplate goes)

`apps/integrated/Amove/src/main/feature.ts`:

```ts
async register(ctx: FeatureContext): Promise<void> {
  if (this.#controller) return
  if (ctx.id !== this.id || ctx.productId !== 'amove') throw new Error('Invalid Amove feature context')
  const surface = await acquireFeatureSurface(ctx, {
    icon: join(ctx.paths.assetsDirectory ?? '', 'app', 'icon.png'),   // assetsDirectory is validation-guaranteed
    devTools: !process.env.CI
  })
  const controller = new AppController(ctx, surface)
  try {
    await controller.start()
    this.#disposeIpc = registerIpc(controller)     // after start(), as today
    this.#controller = controller
  } catch (error) {
    this.#disposeIpc?.(); this.#disposeIpc = undefined
    controller.dispose()
    surface.dispose()
    throw error
  }
}
```

`app-controller.ts` restructure (presence untouched):

- Constructor takes `(ctx, surface: FeatureSurfaceHandle)`; keeps `assetsRoot`/`appIconPath` (tray/dock reuse them), settings, shelf, native.
- `createMainWindow` is deleted. Its window listeners move to `private bindStandaloneWindowPolicy(window: BrowserWindow)` — the focus/blur hotkey policy, the close-to-hide branch, and the `closed` bookkeeping (`this.#surface = undefined` + taskbar-quit check) — called from `start()` in standalone mode against `surface.window`.
- `start()` sequence: `setDockIcon()` (standalone) → `await settings.load(…)` → `bindStandaloneWindowPolicy(surface.window)` → `await surface.ready()` (createMainWindow's position) → `applyPresence()` → hotkeys/polling → `broadcast()`.
- `getMainWebContents()` → `this.surface?.webContents`; `getMainWindow()` → `this.surface?.window`; `focusMainSurface()` keeps its suite/standalone branch via `ctx.surface` / `surface.window` (shelf policy, product-owned).
- `showMainWindow()`: suite → `this.ctx.surface!.activate()`; standalone → recreate via `acquireFeatureSurface(this.ctx, this.#surfaceOptions)` if the handle went away, then `surface.activate()`; both → `applyPresence()` + `updateHotkeyPolicy()`.
- `dispose()`: the `disposeAppearance`/`mainWindow.destroy()` tail becomes `this.surface?.dispose()`; everything else (hotkeys, native, shelf, tray, dock timers) is untouched.
- `updateHotkeyPolicy()` keeps its suite (`ctx.surface.state`/subscribe) and standalone (`surface.window.isFocused()`) reads — honest product policy, no handle state mirroring.

New `apps/integrated/Amove/tests/feature.test.ts` (Bonded's shape): mock `AppController` + electron `FakeWindow`, run the real host; assert suite → no window, standalone → window created with catalog geometry, IPC registered after `controller.start`, `ready()` loaded and showed, dispose → `controller.dispose()` + window destroyed.

Verify: `pnpm -C apps/integrated/Amove typecheck && pnpm -C apps/integrated/Amove test` + root gates.

### Step 8 — grep for completion

```
rg "registerProductAppearance|desktopWindowChromeOptions|neutralWindowBackground" apps/integrated \
  -> only Amove's shelf/tray/dock sites may remain (product-owned), none in feature window code
rg "new BrowserWindow" apps/integrated/*/src/main -> only Amove's shelf-controller (utility surface)
```

### Step 9 — docs

- `CONTEXT.md`: the **Feature surface host** term (added with this plan).
- `docs/architecture/standalone-applications.md`, §"embedded feature" paragraph: replace "only standalone mode receives a feature-owned primary `BrowserWindow`" with the host owning that window, and "Window dimensions remain controller-owned" with "standalone window facts (geometry, fullscreenable, navigation policy) are catalog-owned and resolved by the feature surface host."

### Step 10 — final gates

```
pnpm typecheck && pnpm test
pnpm -C apps/integrated/Amove typecheck && pnpm -C apps/integrated/Amove test
pnpm -C apps/integrated/Exithibition typecheck && pnpm -C apps/integrated/Exithibition test
pnpm -C apps/integrated/Bonded typecheck && pnpm -C apps/integrated/Bonded test
pnpm -C apps/integrated/Orbis typecheck && pnpm -C apps/integrated/Orbis test
```

Then the repo's full gate `pnpm ui:verify` (baseline it before starting; pre-existing unrelated failures don't block this change).

### Manual smoke checklist

- Each app standalone dev run: geometry/title correct; appearance toggle works; dark-mode background correct (Exithibition dark); window-open denied everywhere; `will-navigate` denied (Bonded/Orbis/Exithibition) but reload works in Amove; activate re-focuses (restore-from-minimized included); quit tears down promptly (no orphaned helpers — Exithibition especially).
- Suite run: all four features load with zero extra windows; switching tabs activates/focuses; uninstall/reinstall from the Features page disposes cleanly.
- Amove: menu-bar presence close-to-hide; tray Quit; dock icon; shelf focus restore; `presenceMode: 'taskbar'` on Windows quits on last-window close.
- Orbis: Choose Folder dialog parents to the standalone window; scan works in both modes.
- Exithibition: space-bar sampling toggle in both modes; window shows after load.

---

## 8. Test matrix (`tests/feature-surface-host.test.ts`)

| # | Scenario | Asserts |
|---|---|---|
| 1 | Suite mode | zero windows constructed; `webContents === ctx.surface.webContents`; `ready()` resolves without loading; `activate()` → `surface.activate()` + `focus()`; `dispose()` leaves the surface untouched |
| 2 | Standalone creation facts (Bonded seed) | constructor options: title `label`, catalog sizes, `fullscreenable: false`, chrome options, `backgroundColor = neutralWindowBackground(defaultProductAppearance('bonded'))`, `webPreferences { preload, contextIsolation, nodeIntegration: false, sandbox: true, spellcheck: false }` |
| 3 | Options (Amove seed) | `icon` and `devTools` land in the constructor options; navigation `'allow-same-url'` from the catalog |
| 4 | Validation | standalone ctx missing `renderers.main` (Orbis table) → throws before any window exists (`FakeWindow.instances` empty) |
| 5 | Wire-before-load | after acquire, `loadURL`/`loadFile` not called; after `ready()` → `loadFile(file)` / `loadURL(http)` by scheme; second `ready()` does not reload |
| 6 | Guards | `setWindowOpenHandler` deny installed; `will-navigate` prevented under `'deny'`; under `'allow-same-url'`: same-URL event allowed, different URL prevented |
| 7 | Appearance | `registerProductAppearance(productId, window, undefined, { applyNativeTheme: true })` in standalone, never in suite; `dispose()` runs the disposer exactly once; double-dispose is a no-op |
| 8 | `ready()` failure | `loadFile` rejects → disposer ran, window destroyed, error propagates; handle inert afterwards |
| 9 | activate (standalone) | minimized → `restore()` then `show()` then `focus()`; destroyed window tolerated without throwing |
| 10 | External close | window emits `closed` → disposer ran; subsequent `dispose()` no-op; `ready()` on the dead handle does not load |
| 11 | Acquire failure | appearance registration rejects → window destroyed, error propagates |

Per-feature composition tests (§7 steps 4–7) assert product wiring only: controller start/stop counts, IPC registration order, lease release, dialog parenting, excludeProcess timing, IPC-after-start for Amove. Window-lifecycle assertions live in the matrix above, once.

---

## 9. Behavior-change ledger (intended)

| App / mode | Change | Why |
|---|---|---|
| Bonded, Exithibition standalone | window-open denied + will-navigate prevented (were unguarded) | drift fix; guard policy centralized |
| Exithibition standalone | window shows after the load resolves (was `ready-to-show`) | one show policy |
| Bonded standalone | show after load resolves (was `did-finish-load`) | one show policy |
| Amove, Orbis, Exithibition standalone | `spellcheck: false` (was on) | Bonded's precedent, uniform posture |
| Bonded suite | `excludeProcess` runs after `controller.start()` (was before) | matches standalone's existing order; equivalent exclusion list |
| Bonded standalone | `fullscreenable` via constructor option (the extra `setFullScreenable` call is dropped) | same effect, one mechanism |
| Orbis, Exithibition standalone `activate` | restore-if-minimized added | Bonded parity; uniform activation |
| Orbis, Amove suite `activate` | `surface.focus()` added after `activate()` | uniform activation; strictly better focus |
| All standalone | appearance registered with `applyNativeTheme: true` explicitly | was already the effective value everywhere |

## 10. Risks and mitigations

1. **Electron double fidelity** (`FakeWindow` fakes events, not Electron): mitigated by the manual smoke checklist, the per-app Playwright e2e suites, and the composition tests running the real host behind the doubles.
2. **Show-timing change for Exithibition** (post-load vs first-paint): smoke-verify no visible flash; if it matters, `ready()` can await `ready-to-show` internally — an implementation detail behind the same interface.
3. **Guard tightening on Bonded/Exithibition**: both renderers are trusted local builds with no intentional navigation; e2e suites cover them.
4. **Amove recreate-on-demand + external close**: the host's `closed` listener plus the fresh-acquire path are covered by matrix #10 and the new Amove wiring test.
5. **Bundling**: the host is main-process-only and imported by feature chunks; electron-vite's per-feature splitting and `runtime.ts`'s literal `import()`s are untouched; the catalog addition is four number tuples (renderer-bundled, negligible).
6. **Import cycles**: `feature-surface-host` → `./main` + `./feature` (+ catalog re-exports); nothing imports back — verified by typecheck and each app's `build:renderer`.
7. **Rollback**: every step is an independent commit; the host is additive until each app adopts it; each app can revert independently.

## 11. Out of scope

- Architecture-review candidates 2–6 (standalone context builder, product-identity single owner, control-protocol contract, Vox onto the launcher, legacy alias deletion — the host reads named maps only, which nudges 6 but does not complete it).
- The suite shell window in `src/main/index.ts` (its own guards and appearance stay shell-owned).
- Amove's ShelfController (a utility window with a show/hide lifecycle, deliberately feature-owned).
- Vox and YN360 (standalone controllers, not `MoirasiaFeature` hosts — they don't build a `FeatureContext`).
- `FeatureRuntime`, `EmbeddedFeatureHost`, `suite-context.ts`, and the `MoirasiaFeature` contract.

## 12. Success criteria

- The standalone window lifecycle exists exactly once; the four features contain no window construction, chrome options, appearance registration, background computation, URL-vs-file detection, or window guards (§7 step 8's greps come back clean; Amove's shelf is the only remaining `new BrowserWindow`).
- The interface is one function, one handle (six members), one options type (two fields), one catalog fact group, one appearance helper — and every feature uses it with zero configuration except Amove's two options.
- The §8 matrix is green through the host's interface; root and per-app typecheck/test/build gates green; composition tests assert wiring, not window mechanics.
- Deletion test holds: removing the host would scatter the lifecycle — with today's drift — back across four callers.
- Leverage: the fifth embedded feature gets a guarded, themed, validated, teardown-correct standalone window for one catalog entry. Locality: every window bug lands in one module with one test surface.