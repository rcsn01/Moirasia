# Shared UI foundation

This package is the single authoring and generation owner for React, plain CSS and SwiftUI presentation tokens. It does not own app layouts, lifecycle or theme transport.

- `foundation.tokens.json` contains DTCG-style primitive and semantic tokens, complete light/dark roles, web preset mappings and native policy.
- `product-tokens.json` contains visualization colors and the explicit bespoke Amove shelf exception. Runtime validation restricts each product to its actual roles and modes.
- `preset.source.json` pins shadcn `bKZTOcpW`, Base UI, Mira, stone and JetBrains Mono. Other presets are rejected before any write. The authored web typography overrides the preset's main font with locally bundled Actor, while monospace text keeps JetBrains Mono.
- `preset.lock.json` records input/generator hashes, format version and all 15 payload hashes. The lock itself is the sixteenth generated artifact.

Run from the workspace root:

```sh
pnpm ui:preset:sync
pnpm ui:preset:check
pnpm --filter @moirasia/design-system test
```

The existing `pnpm ui:preset:set <code>` interface remains restricted to the supported preset. Check is read-only and reports all absent/stale outputs and package dependency mismatches together. CLI paths derive from the module location, not the working directory. Sync resolves, validates and renders every output before writing. Filesystem write failures are reported, not silently repaired; rerun sync after correcting the failure.

## Adapters and compatibility

`ui-react` retains its exact reference preset CSS, adaptive product styles, TypeScript window-background facts and components.json. No React component styling refactor is part of this migration.

`ui-css` retains every previously exported property name and product import path. Its primitive neutral aliases now use stone values. Semantic aliases resolve directly to canonical values, including overlays, focus, action states and shadows. LiteMaptica and Mini-NSW themes explicitly set **all** appearance-sensitive roles to dark and light respectively; `color-scheme` alone would leave OS-dependent status/shadow values behind. Reduced-motion variables remain independent of mode.

`ui-swift` retains the public MoiraColor, MoiraSpace, MoiraRadius, MoiraControl, MoiraMotion, MoiraType and MoiraExithibition names. Dimensions in px map to points; rem maps through the explicit 16px baseline. Durations in ms map to seconds. Touch height is at least 44pt. Native `surface` uses the distinct secondary neutral, not the white light card/canvas pairing. MoiraExithibition remains fixed-dark, including windowBackground and telemetry colors.

macOS typography keeps the named numeric system-font scale. iOS uses authored semantic system text styles so SwiftUI Dynamic Type scales natively; weight/design parameters and default weights remain unchanged. Native focus and reduced-motion handling remain app-owned. The native adapter does not impose the web font.

## Color conversion

The generator accepts six/eight-digit hex, rgba and numeric OKLCH, including fractional or percentage alpha. Other expressions are rejected. Web-only menu color-mix/filter expressions are assembled from explicit web policy, not passed into Swift's color parser.

OKLCH conversion uses the CSS Color 4 OKLab matrices, then encodes sRGB and clamps each encoded channel to `[0, 1]`. Alpha is preserved separately. Swift stores normalized floating-point channels with eight decimal places; generated channel comparison tolerance is `5e-9`, and reference matrix fixtures use `2e-6`. Opaque composition requires an explicitly named opaque surface. Canvas/window backgrounds are already opaque; translucent borders and hover states remain translucent.

## Changing a role

Change its authored token, run sync/check and inspect every adapter diff. Tests pin the React reference and previous CSS/Swift public names while separately testing semantic relationships, conversions, drift and mutation safety. Browser/native checks are still required when appearance changes. Do not regenerate the characterization fixtures just to accept a regression.

Product tokens may not replace structural chrome, typography, radii or ordinary control colors. LiteMaptica's confidence palette and Mini-NSW's simulation timeline marker are domain data. Map/material/traffic rendering remains app-local. Standalone apps must never be embedded in or controlled by Moirasia.

## Rendered verification

Build LiteMaptica and Mini-NSW first, then run with root development dependencies:

```sh
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  node packages/design-system/test/browser/verify.mjs
```

Omit `CHROME_PATH` when Playwright Chromium is installed. The verifier writes screenshots and results under ignored `test-results/foundation-browser/`. See [migration results](../../docs/design-system/foundation-migration.md) for app/native checks and coverage limits.
