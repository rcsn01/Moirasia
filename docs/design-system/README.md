# Moirasia design system

Moirasia shares design decisions without forcing web and native applications
through one component implementation. React applications now have a canonical
component layer:

- `@moirasia/ui-react` is the source-owned shadcn package for React 19. It uses
  Tailwind CSS 4, Base UI, the Nova preset, neutral CSS-variable themes, Lucide
  icons, and a locally bundled Geist Sans variable font.
- Generic React controls belong in `@moirasia/ui-react`; application layouts,
  product-specific status presentations, and workflows remain app-owned.

The earlier cross-platform token foundation remains transitional infrastructure
for applications that have not migrated:

1. `packages/design-tokens/tokens.json` is the DTCG-compatible legacy source for
   primitive, semantic, and product tokens.
2. `packages/ui-css` exposes generated CSS variables for web applications.
3. `packages/ui-swift` exposes generated SwiftUI constants for native Apple
   applications. Other framework adapters should be added only when repeated
   real usage justifies them.

Do not bridge those legacy variables into the React theme. React applications
should import `@moirasia/ui-react/styles.css` once and migrate screen-by-screen.
The existing CSS and Swift adapters remain available until their owning
applications move independently.

Run `npm run build` from `packages/design-tokens` after changing tokens. The
generator updates both the CSS themes and
`packages/ui-swift/Sources/MoirasiaUI/MoiraTokens.swift`. Run `npm run check`
there in CI to verify that every committed adapter is current.

## Naming and overrides

Application code should consume semantic variables such as
`--moira-color-text-primary`, `--moira-color-warning-surface`, and
`--moira-control-height-medium`. Primitive variables are emitted to support
adapter development, but they should not be the normal application API.

Product themes may override accent/action, brand typography, and a small number
of deliberate density or shape decisions. They must not redefine shared
success, warning, or danger meanings. The Amove theme keeps its neutral-blue
accent separate from status colors.

## Amove pilot inventory

The original main-window stylesheet contained 45 distinct literal colors and
rgba values, 28 distinct pixel dimensions, one-off light/dark state blocks, and
no shared hover, pressed, focus-visible, reduced-motion, or semantic disabled
treatments. Repeated concepts included:

- near-white canvas, raised controls, primary/muted text, and neutral borders;
- 7–10 px control radii and a pill radius;
- 4–42 px spacing values centered on a four-point rhythm;
- 34–36 px controls, 12–31 px type, and sans/monospace roles;
- neutral-blue action/focus, plus success, warning, and danger statuses.

The pilot replaces those concepts with shared variables while leaving component
layout, accessibility roles, keyboard behavior, and the floating shelf intact.

## Adopting in another web app

Add `@moirasia/ui-css` as a local dependency using that application's existing
package manager, import `@moirasia/ui-css/foundation.css` once at its renderer
entry point, and map existing literals to semantic variables incrementally.
Create a product entry point only if the application needs intentional brand
overrides. Do not import another application's source or theme CSS.

The public product entry points currently are:

- `@moirasia/ui-css/amove.css`
- `@moirasia/ui-css/litemaptica.css`
- `@moirasia/ui-css/openagent.css`
- `@moirasia/ui-css/mini-nsw.css`
- `@moirasia/ui-css/exithibition.css` for parity with the native theme

## LiteMaptica pilot

LiteMaptica is the second adopter and exercises the same CSS output through
React, Tauri, and Bun. Its `litemaptica.css` entry point deliberately keeps the
application's always-dark green reconstruction workspace while inheriting the
shared typography, spacing, radius, motion, focus, disabled, and status roles.
This demonstrates family resemblance without turning Amove and LiteMaptica
into identical skins.

## Exithibition native adopter

Exithibition is the first native adopter. Its Xcode project links the local
`packages/ui-swift` package and maps the generated `MoiraExithibition` palette,
shared four-point spacing, radii, and motion values through an app-local
`ExithibitionTheme` facade. The dashboard and inspector consume those roles
while the schematic retains its monochrome and heat-driven visualization
colors. Native settings form controls remain native SwiftUI controls.

Verify the adapter and application with:

```sh
cd packages/ui-swift
swift test

cd ../../apps/Exithibition
npm test
```

## OpenAgent adopter

OpenAgent consumes `@moirasia/ui-css/openagent.css` from its existing
`@openagent/ui` package. Its default theme maps typography, four-point spacing,
core surfaces, primary and muted text, borders, focus, and primary status roles
to Moirasia semantics. OpenAgent's mature component, syntax, diff, avatar, and
agent palettes remain product-owned, and its runtime theme mechanism can still
override the default variables.

Verify the focused integration with:

```sh
cd apps/OpenAgent
bun --cwd packages/ui test
bun --cwd packages/ui typecheck
bun --cwd packages/app build
```

## Mini NSW adopter

Mini NSW consumes `@moirasia/ui-css/mini-nsw.css` through npm. Its control bar,
station panel, timeline, fields, selection, hover, focus-visible, pressed, and
disabled states use shared semantic roles. Three.js terrain, water, population,
and rail colors remain simulation data rather than UI tokens.

Verify the application with:

```sh
cd apps/Mini-NSW/app
npm test
npm run typecheck
npm run build
```

## Adoption status

| Application | Adapter | Product identity retained |
| --- | --- | --- |
| Amove | CSS / React | Neutral-blue desktop controls and floating shelf |
| LiteMaptica | CSS / React | Always-dark green reconstruction workspace |
| Exithibition | SwiftUI package | Monochrome telemetry schematic |
| OpenAgent | CSS / SolidJS | Extensible theme, syntax, diff, and agent palettes |
| Mini NSW | CSS / vanilla TypeScript | Light rail-map workspace and scene rendering |

Semiquaver is intentionally outside the current adoption scope.
