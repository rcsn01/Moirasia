# Moirasia — domain vocabulary

Moirasia is a macOS controller and feature host. This file is the short glossary; `docs/architecture/standalone-applications.md` is the full architecture document and wins on detail.

## Terms

- **Controller** — the Moirasia main-process side that discovers, opens, focuses, and quits Amove, Vox, Bonded, and Shout through the AppKit agent and the `--moirasia-control` protocol.
- **Feature host** — the Moirasia side that runs a product inside the suite process when the product ships a feature package.
- **Embedded feature** — a product running inside the suite window against the `MoirasiaFeature` contract (`register`/`dispose`/`activate`/`setActive`). Currently Amove, Bonded, and Shout.
- **Standalone application** — an independently packaged app under `apps/standalone`. Exithibition and Orbis are standalone-only and are not controlled by Moirasia.
- **Standalone launcher** — `runStandaloneLaunch` in `@moirasia/desktop-shell/main`; owns the single-instance lock, ready-time registration, activation re-focus, quit policy, and awaited teardown. Controlled apps enable its optional Moirasia login-item command branch; standalone-only apps disable it.
- **Standalone surface** — `acquireStandaloneSurface` in `@moirasia/desktop-shell/standalone-surface`; owns a standalone app's guarded primary window, app-local appearance registry, renderer loading, activation, and teardown without depending on feature catalogs or suite mode.
- **Host mode** — `suite` or `standalone`; the mode discriminates window ownership and the resource set an embedded feature requires.
- **Feature catalog** — pure-data owner of the shared facts about the three embedded features: Amove, Bonded, and Shout.
- **Application catalog** — the same for the four family applications the controller launches: Amove, Vox, Bonded, and Shout; `packages/desktop-shell/src/application-catalog.ts`.
- **Feature runtime** — `src/main/features/runtime.ts`; loads, installs/uninstalls, and activates embedded features behind serialized per-feature operations.
- **FeatureContext** — the discriminated context (`mode`, resource path maps, embedded `surface`) a feature receives at `register` time.
- **Feature surface host.** `packages/desktop-shell/src/feature-surface-host.ts` exports `acquireFeatureSurface` through `@moirasia/desktop-shell/feature-surface-host`. It returns the shell surface in suite mode without controlling its window. In standalone mode it creates the primary window from catalog facts, installs guards and appearance handling, loads the renderer in `ready()`, and owns activation and teardown. Features keep their controllers, IPC, leases, and presence policies.
- **Runtime lease** — the cross-host exclusive lock ensuring one host owns a feature's sensitive session at a time. It stores an owner record, probes PID liveness, recovers stale ownership through a recovery marker, and releases by token. The deep implementation is `@moirasia/desktop-shell/runtime-lease`; each app keeps a thin adapter naming its lock and host.
- **Artifact fact** — a catalog-owned fact about a file a feature ships: its filename (or napi base name), where the build output lands in the app repo, where staging places it in the suite repo, where packaged resources land in the suite and in the app's own bundle, and which source the suite trusts in development. Catalogs own the facts; hosts resolve them (`artifactPath` joins a root with a fact).
- **Staged resources** — build outputs placed under `native/staged/…` so both suite development and suite packaging find them at the same repo-relative paths; packaged copies live under `Contents/Resources/features/<id>/…`.
- **Product bar / appearance** — the shell-owned 36px neutral bar with the sun/moon toggle; per-product appearance is persisted in the shared `AppearanceRegistry`.