# Foundation migration results

The reviewed root `plan.md` is implemented. `packages/design-system` now owns foundation and product authoring, validation, color conversion and generation for React, CSS and SwiftUI. It generates 15 payloads and the lock file. The old `packages/design-tokens` authoring package is removed.

All eight React payloads remain byte-identical to the characterization fixtures. CSS and Swift colors now resolve from the canonical source. Existing CSS property names/imports and Swift public exports remain available. CSS product modes override every appearance-sensitive role. Exithibition telemetry focus/selection have explicit domain aliases and cannot override generic focus/selection.

iOS typography uses semantic system styles for Dynamic Type. macOS keeps the numeric system-font scale. Native `surface` uses the secondary neutral so cards remain distinct from the canvas. No standalone app integration or app lifecycle changed.

## Verification

| Context | Result |
| --- | --- |
| Generator | 33 Node tests; deterministic sync/check/set, invalid-input write safety, drift detection, export compatibility, all Swift color roles, conversion overflow and malformed font checks |
| Shared Swift package | 6 tests |
| Moirasia | Typecheck, 362 tests, renderer build |
| Amove | Typecheck, 74 tests, renderer build |
| Bonded | Typecheck, 127 JS tests, renderer build; 1 real-nettop integration test skipped |
| Shout | Typecheck, 47 JS tests, renderer build |
| Exithibition | Typecheck, 8 JS tests, renderer build |
| Orbis | Typecheck, 359 tests, renderer build |
| YN360 | Typecheck, 66 tests, renderer build |
| Vox | Typecheck, 71 tests, renderer build |
| Herm-Bot | Typecheck, 1,152 tests, renderer build |
| LiteMaptica | 13 Vitest tests, build, Cargo check and 28 Python tests through `bun run check` |
| Mini-NSW | Typecheck, 13 tests, build |
| Semiquaver | 3 Node packaging tests; unsigned Xcode tests, 23 macOS and 12 iOS |
| Browser | 14 primary contexts and 8 additional narrow screenshots using system Chrome |

Browser checks exercise the React reference in both modes, focus and disabled controls, nested appearance scopes, the real Moirasia shell with Bonded, and Bonded's standalone presentation/settings. LiteMaptica and Mini-NSW run in development and built output under both OS appearances. Checks cover fixed mode semantics, font loading, interaction, focus, reduced motion and viewport overflow. Light/dark native cards and iOS accessible-size text were rendered and visually inspected. The iOS tests measure all seven typography roles at default and accessible sizes.

Shout's linked Base UI CommonJS shim needed explicit test resolution and optimization to use the same React instance. Mini-NSW needed an app-local Vitest configuration to avoid inheriting the workspace's test selection. Both corrections are app-owned test configuration changes.

`ui-css` bundles JetBrains Mono through its declared font dependency. LiteMaptica and Mini-NSW also declare the same font version because local-file package resolution did not reliably install the transitive dependency. Both builds include font assets.

Herm-Bot's 33 vendored package files matched the initial shared package. React runtime files did not change, so its tarball was not repacked. Only the shared package README now differs from the vendored copy.

## Reproduction and local evidence

```sh
pnpm ui:preset:sync
pnpm ui:preset:check
pnpm --filter @moirasia/design-system test
swift test --package-path packages/ui-swift
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  node packages/design-system/test/browser/verify.mjs
```

Build the two CSS apps before the browser check. The verifier requires root development dependencies and either installed Playwright Chromium or `CHROME_PATH`.

Ignored local evidence lives under `test-results/`:

- `foundation-baseline/` contains pre-migration CSS app screenshots.
- `foundation-browser/` contains results and current desktop/narrow screenshots.
- `foundation-verification/` contains broad app check logs.
- `foundation-tests.log`, `swift-tests.log`, `litemaptica-check.log`, `mini-nsw-check.log` contain focused results.
- `semiquaver-mac.log`, `semiquaver-ios.log` and their derived-data directories contain unsigned Xcode results.
- `native-presentations/mac/` and `native-presentations/ios-rendered/` contain inspected native attachments. The older `native-presentations/ios/` images are blank and are not verification evidence. The iOS test now uses ImageRenderer and asserts that light/dark PNGs differ.

Native tests used Xcode 27.0, macOS and an iPhone 17 simulator running iOS 26.5. Commands used `CODE_SIGNING_ALLOWED=NO` and no publication or deployment.

## Coverage limits

No native before screenshots were captured. Native OS reduced-motion preference switching was not exercised; existing app handling remains unchanged. LiteMaptica's browser check uses its desktop-unavailable mode, not a full Tauri project/import/export chooser workflow. Actual Electron window launch, other app native suites and real library/playback workflows were not exercised.

The full root `ui:verify` command was not run because some app scripts invoke unrelated native/driver builds. Relevant checks were run separately. No PF changes, drivers, microphone workflows, default audio-device changes or real library modifications were used for appearance checks. Orbis's prebuild regenerated a tracked native binary; that unrelated artifact was restored to its clean baseline.
