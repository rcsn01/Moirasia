# Moirasia UI System — Next Agent Prompt

You are working in:

`/Users/mac/Syncthing/Projects/Moirasia`

Moirasia will become the shared home for the user's application family and UI
system. The applications currently live under `apps/`:

- `Amove` — React 19 + Electron, pnpm
- `Exithibition` — native macOS SwiftUI
- `LiteMaptica` — React 19 + Tauri, Bun
- `Mini-NSW`
- `OpenAgent` — SolidJS/Electron monorepo, Bun
- `Semiquaver` — native iOS SwiftUI

## Objective

Establish a maintainable cross-platform UI foundation inside Moirasia, then use
Amove as the first pilot application. The apps should have a recognisable family
resemblance without being forced into an identical skin.

Start with Amove's conventional main/settings window. Do not begin by redesigning
its distinctive floating shelf.

## Important repository state

Inspect the workspace before making changes and report what you find.

At the time this prompt was written:

- Moirasia itself had no root `.git` repository.
- Each application still contained its original nested `.git` directory.
- There was no root `package.json` or workspace configuration.
- The directory was approximately 108 GB because copied applications include
  generated/build/dependency data; `apps/Mini-NSW` accounted for roughly 95 GB.
- The applications use different package managers and build systems.

Treat all existing files and Git histories as user data. Do not delete nested
`.git` directories, build products, dependency directories, caches, lockfiles,
or other large files without explicit user approval. Do not edit the original
copies elsewhere under `/Users/mac/Syncthing/Projects`; work only in Moirasia.

Before converting this into a true monorepo, explain the safe history-preserving
options to the user. If removing nested repositories or discarding generated
data becomes necessary, resolve exact targets and request approval first.

## Design-system architecture

Build a small shared foundation rather than a universal cross-framework
component library. A suitable target structure is:

```text
Moirasia/
├── apps/
│   └── ...
├── packages/
│   ├── design-tokens/
│   ├── ui-css/
│   ├── ui-react/
│   └── ui-swift/
├── docs/
│   └── design-system/
└── scripts/
```

Use three layers:

1. **Primitive tokens** — colour scales, spacing scale, type sizes, radii,
   shadows, control sizes, and motion durations.
2. **Semantic tokens** — canvas, surface, raised surface, primary and muted
   text, border, accent, success, warning, danger, focus, and interaction states.
3. **Product themes** — the small set of intentional overrides that preserve an
   application's identity.

Prefer semantic names such as `color.action.primary` and
`color.status.success`; do not name shared tokens after literal colours such as
`blue` or `green`. Keep product accent separate from status colours.

Use a DTCG-compatible JSON token source where practical. Generate or expose:

- CSS custom properties usable by React and Solid applications.
- A thin React component layer only for genuinely reusable controls.
- Swift constants or a Swift package for the native applications in a later
  phase.

Do not force all projects onto one package manager as part of the first phase.
Local packages must have clear public entry points; avoid brittle imports that
reach into another application's source tree.

## Shared visual language

Initially standardise:

- system sans and monospace typography roles;
- a four-point spacing scale;
- control heights and density roles;
- control, card, panel, overlay, and pill radii;
- light and dark semantic colours;
- hover, pressed, selected, focus-visible, disabled, loading, success, warning,
  and danger states;
- fast, normal, and deliberate motion durations;
- buttons, icon buttons, segmented controls, fields, status badges, settings
  rows, toolbars, panels, dialogs, and empty states.

Maintain native platform behaviour. SwiftUI applications should use native
navigation and controls where possible and consume the same design decisions
through tokens rather than imitating web components.

## Amove pilot

Inspect these files and their imports before editing:

- `apps/Amove/src/renderer/main/main.css`
- `apps/Amove/src/renderer/main/MainApp.tsx`
- `apps/Amove/src/renderer/shelf/shelf.css`
- `apps/Amove/src/renderer/shelf/ShelfApp.tsx`
- `apps/Amove/package.json`

For the first implementation:

1. Inventory Amove's repeated literal colours, spacing, radii, typography,
   shadows, control sizes, and state treatments.
2. Define the smallest coherent token set that covers the main window.
3. Make Amove consume the shared local token/CSS package through a documented
   public entry point.
4. Migrate the main/settings window away from arbitrary literals while
   preserving its behaviour and general neutral-blue identity.
5. Create shared React primitives only where there are multiple real usages.
   Do not construct a large speculative component library.
6. Leave the shelf visually distinctive. Once the main window is sound, apply
   only appropriate foundations such as typography, focus, motion, and semantic
   state tokens to the shelf.
7. Add concise documentation showing token naming, allowed product overrides,
   and how another app should adopt the system.

OpenAgent already contains a mature product-specific theme under
`apps/OpenAgent/packages/ui/src/styles/theme.css`. It is useful reference
material, but do not make the whole OpenAgent UI package the shared standard.
Extract only broadly applicable ideas.

Semiquaver already has a Swift theme layer at
`apps/Semiquaver/Semiquaver/Design/PlayerTheme.swift`. Treat that as input for
the later Swift adapter rather than rewriting it during the Amove pilot.

## Quality and verification

- Preserve existing behaviour, accessibility attributes, keyboard handling, and
  native window drag regions.
- Ensure focus-visible, disabled, warning, danger, and dark-mode states remain
  legible.
- Avoid unrelated refactors.
- Preserve existing lockfiles and package-manager choices.
- Run Amove's focused tests and typecheck first, followed by its application
  build if the environment supports the native dependency.
- If an existing failure is unrelated, document it precisely rather than
  weakening tests.
- Visually inspect the main window in both light and dark modes when possible.

## Expected handoff

Finish with:

- a concise explanation of the chosen repository/package architecture;
- a list of files changed;
- verification commands and results;
- screenshots or a clear visual QA report for Amove;
- any unresolved repository-history or large-file decisions that require the
  user's approval;
- a recommended next application after Amove, likely LiteMaptica.

Work incrementally. The first milestone is a clean, reusable foundation proven
by Amove—not a simultaneous redesign of every application.
