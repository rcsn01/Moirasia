# Moirasia design system

`packages/design-system` owns shared presentation semantics and generates the React, plain-CSS and native SwiftUI adapters. There is no separate legacy authoring module. App layouts, workflows and runtime ownership remain app-specific.

## Sources and generation

- `foundation.tokens.json` authors primitive dimensions, motion, typography, semantic light/dark roles and explicit platform policy.
- `product-tokens.json` authors visualization colors and Amove's bespoke shelf presentation.
- `preset.source.json` pins shadcn `bKZTOcpW`, Base UI, Tailwind 4, Mira, stone and JetBrains Mono.

Run `pnpm ui:preset:sync` to regenerate all adapters and `pnpm ui:preset:check` to detect drift without writing. `pnpm --filter @moirasia/design-system test` exercises validation, conversions, compatibility and the generation interface. See `packages/design-system/README.md` for conversion tolerances and output guarantees.

## Ownership and product policy

Common canvas/surface/text/border/action/focus roles, typography, spacing, radii and control sizes belong to the shared foundation. Product themes must not redefine those decisions. Product-specific status and visualization colors may express domain meaning. Separate mixed usages rather than preserving a branded ordinary button because it once used a broad accent name.

Amove's floating shelf is an explicit bespoke exception; its main window uses shared structure. Bonded protocol/enforcement colors, Vox signal colors, Exithibition telemetry and YN360 channel indicators remain domain data. LiteMaptica confidence colors and Mini-NSW's simulation-time marker are domain colors, not control colors. Native platform minimums and Herm-Bot mobile variants remain platform adaptations, not arbitrary product overrides.

## Consumer adapters

| Consumer | Adapter | Retained presentation policy |
| --- | --- | --- |
| Moirasia, Amove, Bonded, Shout | ui-react and desktop-shell | Existing React appearance; integrated feature layouts remain app-owned |
| Exithibition, Orbis, Vox, YN360 | ui-react and desktop-shell | Independent windows; Exithibition defaults dark; domain palettes remain |
| Herm-Bot | Vendored ui-react package and mobile adapters | Existing mobile controls and touch targets |
| LiteMaptica | ui-css in Tauri/React | Fixed dark shared structure; map/material/confidence colors remain |
| Mini-NSW | ui-css in Electron/DOM/Three.js | Fixed light shared structure; traffic/terrain/rail colors remain |
| Semiquaver | ui-swift | Native system typography, adaptive colors and accessibility |

Standalone applications remain independent. Do not embed, launch or control them through Moirasia. `openagent.css` remains an exported compatibility entrypoint but has no current repository consumer; OpenAgent is not an integrated app.

## React adoption

Import `@moirasia/ui-react/styles.css` once and declare renderer-owned Tailwind source paths. The preset CSS and current component behavior are the visual reference; do not bridge an independently authored legacy palette into it. Generic React controls belong in ui-react, app content and layouts in their apps, and desktop-shell owns primary-window chrome and appearance controls.

## Plain CSS adoption

Use the owning application's package manager and import `@moirasia/ui-css/foundation.css` once, or the approved fixed-mode product entrypoint. Existing amove, litemaptica, exithibition, openagent and mini-nsw CSS paths remain available. Use semantic properties, not primitive neutral names in app code.

JetBrains Mono is bundled through a declared local font dependency, not loaded from a CDN. Verify font files in built Tauri/Electron renderer output. With local file dependencies, refresh the installed package copy and declare the same font package in consumers whose package manager does not resolve local transitive dependencies reliably. See `packages/ui-css/README.md`.

## Native adoption

Semiquaver consumes the local MoirasiaUI Swift package. Native colors follow platform appearance and preserve alpha; MoiraExithibition remains fixed-dark. macOS text uses the authored point scale. iOS text uses semantic system styles and Dynamic Type. Preserve native focus, accessibility, reduced motion and touch minimums instead of matching web screenshots numerically.

## Verification

Generation tests and typechecking do not prove a rendered workflow. Verify the React reference in both modes, an integrated feature in embedded and standalone presentations, fixed-mode CSS apps under both OS preferences, and native light/dark and text-size behavior. Exercise selected, disabled, error, focus and reduced-motion states. Never enable PF rules, change audio devices, access real libraries or launch standalone apps through Moirasia for appearance tests.

Use each app's existing test/build commands. Semiquaver's Node test checks packaging only; use its Semiquaver-macOS and Semiquaver Xcode schemes for native tests, with code signing disabled. Record missing platform runs as gaps, not passes.
