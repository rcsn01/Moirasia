# Moirasia — domain vocabulary

Moirasia is a macOS controller and feature host. This file is the short glossary; `docs/architecture/standalone-applications.md` is the full architecture document and wins on detail.

## Terms

- **Controller** — the Moirasia main-process side that discovers, opens, focuses, and quits the standalone family applications through the AppKit agent and the `--moirasia-control` protocol.
- **Feature host** — the Moirasia side that runs a product inside the suite process when the product ships a feature package.
- **Embedded feature** — a product running inside the suite window against the `MoirasiaFeature` contract (`register`/`dispose`/`activate`/`setActive`). Currently Amove, Exithibition, Bonded, Orbis.
- **Standalone application** — an independently packaged family app the controller launches (the five above plus Vox; YN360, LiteMaptica, Mini-NSW, Semiquaver are standalone-only).
- **Host mode** — `suite` or `standalone`; the mode discriminates window ownership and the resource set a feature requires.
- **Feature catalog** — pure-data single owner of the shared facts about the four embedded features: identity, labels, bundle and executable names, descriptions, display groups, icon keys, menu order, per-host-mode resource requirements, and artifact facts.
- **Application catalog** — the same for the five family applications the controller launches (menu, accelerators, agent contract, login-item control); `packages/desktop-shell/src/application-catalog.ts`.
- **Feature runtime** — `src/main/features/runtime.ts`; loads, installs/uninstalls, and activates embedded features behind serialized per-feature operations.
- **FeatureContext** — the discriminated context (`mode`, resource path maps, embedded `surface`) a feature receives at `register` time.
- **Artifact fact** — a catalog-owned fact about a file a feature ships: its filename (or napi base name), where the build output lands in the app repo, where staging places it in the suite repo, where packaged resources land in the suite and in the app's own bundle, and which source the suite trusts in development. Catalogs own the facts; hosts resolve them (`artifactPath` joins a root with a fact).
- **Staged resources** — build outputs placed under `native/staged/…` so both suite development and suite packaging find them at the same repo-relative paths; packaged copies live under `Contents/Resources/features/<id>/…`.
- **Product bar / appearance** — the shell-owned 36px neutral bar with the sun/moon toggle; per-product appearance is persisted in the shared `AppearanceRegistry`.