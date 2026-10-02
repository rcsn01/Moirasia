# Align Moirasia's UI foundations

## Status and scope

This is the reviewed implementation plan for architecture-review option 1. The user authorized the recommended clarification answers, implementation and commits. Implementation is complete; results and verification limits are recorded in [foundation-migration.md](docs/design-system/foundation-migration.md). The evidence and inventories below describe the pre-migration baseline and remain here as the rationale for the changes.

The objective is one owner for shared visual decisions across Moirasia, integrated apps, and standalone apps. The objective is not identical layouts, a common app runtime, or a rewrite of every UI.

Follow AGENTS.md throughout:

- Amove, Bonded and Shout under apps/integrated can run inside Moirasia.
- Apps under apps/standalone remain independent. Do not embed, launch or control them through Moirasia.
- Both groups share presentation conventions and UI packages.
- App-specific content, layout and workflows remain app-specific.

## 1. Evidence and root cause

### 1.1 Two modules currently own overlapping decisions

The newer React generation path is owned by packages/design-system:

- preset.source.json identifies shadcn preset bKZTOcpW, Base UI, Tailwind 4, and shadcn 4.16.1.
- scripts/preset.mjs validates the preset, defines core light/dark colors and typography, emits React preset CSS, product CSS, generated TypeScript facts and components.json, and writes preset.lock.json.
- ui-react/src/styles.css imports JetBrains Mono Variable and the generated preset.
- The preset uses stone neutrals and JetBrains Mono.

The older generation path is owned by packages/design-tokens:

- tokens.json defines primitives, light/dark semantics and product data.
- scripts/build-css.mjs emits ui-css/foundation.css, CSS product themes and ui-swift/Sources/MoirasiaUI/MoiraTokens.swift.
- The generated foundation uses system typography, a different neutral palette and different dimension definitions.
- LiteMaptica and Mini-NSW product themes override shared structural colors, radii and other presentation decisions. Importing shared tokens therefore does not ensure shared appearance.

### 1.2 The old generator is not reproducible today

During planning, this read-only command failed:

```sh
node packages/design-tokens/scripts/build-css.mjs --check
```

It throws at the expression tokens.product.exithibition.base.color. The script replaces its Exithibition product data with packages/design-system/product-tokens.json, whose Exithibition entry now has light and dark groups, not base. It also replaces Amove data with a shelf-only shape while later CSS generation expects the older light/dark shape.

The checked-in Swift output exposes bodyLarge, titleSmall and titleLarge typography methods that the current old template does not generate. Semiquaver calls bodyLarge and titleLarge; titleSmall has no current caller but remains a public export. Regenerating without accounting for existing exports would break callers.

These are reasons to replace split generation ownership, not add permissive fallbacks or patch stale generated output by hand.

### 1.3 Consumer inventory

| Consumer | Existing shared presentation | Planned effect |
| --- | --- | --- |
| Moirasia | ui-react and desktop-shell | Preserve current appearance as reference |
| Amove | ui-react, desktop-shell, bespoke shelf | Preserve main-window appearance and shelf exception |
| Bonded | ui-react and desktop-shell | Preserve structural appearance and protocol/status colors |
| Shout | ui-react and desktop-shell | Preserve structural appearance and audio-specific content |
| Vox | ui-react and desktop-shell | Shared output compatibility only; no Moirasia control |
| Orbis | ui-react and desktop-shell | Shared output compatibility only |
| Exithibition | ui-react and desktop-shell | Preserve dark default and telemetry colors |
| YN360 | ui-react and desktop-shell | Preserve product indicators and layout |
| Herm-Bot | Vendored ui-react tarball and mobile adapters | Verify artifact freshness; keep mobile conventions |
| LiteMaptica | ui-css in a Tauri/React app | Align structural tokens; retain dark workspace and domain colors |
| Mini-NSW | ui-css in an Electron/DOM/Three.js app | Align structural tokens; retain light map workspace and domain colors |
| Semiquaver | ui-swift in SwiftUI | Align semantic palette and shared dimensions; retain native text and accessibility |

All 33 regular files in Herm-Bot's client/vendor/moirasia-ui-react-0.1.0.tgz byte-match workspace ui-react counterparts, including package metadata and all packaged source. The artifact is not stale. Repack only when implementation changes packaged contents and refresh npm lockfile integrity. No repack script exists; use local npm pack without publishing.

## 2. Finalized decisions

### 2.1 Ownership and canonical appearance

Recommended answer adopted: packages/design-system becomes the single authoring and generation module for shared foundations and product visualization tokens.

Keep the pinned React preset as the visual reference. Do not restyle all current React apps to match the older tokens. Move reusable core values out of generator templates into an explicitly authored foundation document under packages/design-system. Keep preset.source.json as validated preset metadata and product-tokens.json as the product-visualization source.

The source must describe semantic meaning, not only framework variable names. React, CSS and Swift adapters consume the same resolved semantic data.

Recommended answer adopted: consolidate generation rather than chain the old generator behind the new one. One invocation owns output consistency and one check covers all generated artifacts.

### 2.2 Shared versus platform-specific decisions

Shared decisions include:

- Neutral canvas, surface, raised surface, text and border roles.
- Control background, hover/selected presentation and focus roles.
- Semantic danger, warning and success colors, including foreground/background pairings.
- Shared spacing vocabulary, radius roles and motion durations.
- A named type scale and named control-size roles.
- Light/dark role mapping and product-theme override rules.

Platform adaptation is deliberate:

- Web UI uses the existing JetBrains Mono font dependency.
- SwiftUI keeps native system text, platform accessibility and native focus behavior. Preserve existing system-text Dynamic Type behavior; fixed-size MoiraType methods require explicit scaling tests, as detailed in Phase 4. Do not force a web font into native text.
- Express web dimensions in suitable CSS units and Swift dimensions in points using an explicit mapping. Equivalent roles do not require identical numeric units.
- Preserve mobile touch targets and native platform control minimums. A desktop compact size is not a mobile default.
- Keep reduced-motion support in CSS and in native presentation. Do not change existing native accessibility behavior to obtain screenshot similarity.
- Choose named defaults by platform in the source or explicit adapter policy, not by arbitrary per-app overrides.

Recommended answer adopted: preserve current React appearance in the first implementation. Legacy CSS/Swift consumers receive the alignment changes. Existing Swift named exports remain available.

### 2.3 Product exceptions

Recommended answer adopted: product themes may supply data-visualization, status and domain-content colors, but not replace common window chrome, typography, text, neutral cards, radii or control foundations.

Specific policies:

- LiteMaptica remains an always-dark workspace. Its shared structural roles come from the common dark foundation. Retain map/material/selection colors only where they communicate domain meaning.
- Mini-NSW remains an always-light workspace. Its shared structural roles come from the common light foundation. Retain map/traffic/selection colors only where they communicate domain meaning.
- Semiquaver remains system/light/dark capable and uses native typography.
- Exithibition retains its dark default and telemetry visualization colors.
- Amove's shelf remains an explicit bespoke presentation exception, separate from main-window structural styling.
- Bonded protocol and enforcement-status colors, Vox signal colors and YN360 light indicators remain product-specific.

Classify each old product token by actual call sites before removing it. A domain color is not structural merely because its old token has a broad name. Separate mixed usage so domain meaning survives while structural chrome aligns.

### 2.4 Compatibility and scope limits

Recommended answer adopted: preserve app import paths, CSS custom-property names and Swift exports wherever possible. Change their generated values or ownership without requiring every app to change its imports.

- ui-react remains the React presentation adapter package.
- ui-css remains the plain-CSS presentation adapter package.
- ui-swift remains the Swift presentation adapter package.
- desktop-shell continues owning Product bar / appearance, standalone surfaces and window chrome. No lifecycle or control refactor is part of this work.
- ui-css properties that have no direct preset equivalent get an explicit shared semantic mapping. Do not silently drop them.
- Preserve Swift MoiraColor, MoiraSpace, MoiraRadius, MoiraControl, MoiraMotion, MoiraType and existing MoiraExithibition names until consumer inventory proves a removal safe.
- Remove packages/design-tokens only after all consumers of its exported tokens path and commands have been migrated. The audited nested apps do not consume its tokens export, so no compatibility data artifact is required.

Do not include option 2's shared control-styling refactor, option 3's generalized renderer setup module, or option 4's full verification orchestration in this implementation. Add only the verification needed to prove the foundation migration. Do not redesign screen layouts, add runtime theme transport, add standalone integration, or introduce a generic multi-framework UI toolkit.

## 3. Module and interface design

### 3.1 Alternatives considered

1. Make the old tokens module authoritative and adapt the React preset to it. Rejected because this would change the already-aligned majority and undermine the pinned preset with no confirmed benefit.
2. Keep both generators and add equivalence assertions. Rejected as the main solution because two independent authors still own the same decisions; tests detect drift but do not provide locality.
3. Let design-system own resolved foundation data and all output adapters. Selected because it provides depth behind one generation interface while preserving existing consumer interfaces.

### 3.2 External interface

Retain the existing preset commands so callers do not learn a second generation interface:

```sh
pnpm ui:preset:sync
pnpm ui:preset:check
pnpm ui:preset:set <code>
```

Extend sync/check to include CSS and Swift outputs. Keep the existing preset support restriction explicit; this work does not add support for arbitrary new shadcn presets. An unsupported preset or inconsistent source document fails before writing outputs.

The module's interface includes these invariants:

- All output adapters resolve the same foundation source.
- Sync is deterministic and does not depend on the current working directory.
- Check is read-only and reports all missing/stale artifacts and dependency mismatches together. Preserve existing ui-react shadcn/font and Vox font dependency checks.
- Invalid data produces an actionable error before any source or output write. This does not promise transactional filesystem writes: report I/O failures and rerun sync to restore consistency.
- Only known output paths may be written.
- Consumers do not run generation at runtime or read authoring files from the renderer.
- Compatibility names stay stable unless their callers are migrated in the same work.
- Product tokens cannot override shared structural roles except explicitly approved bespoke presentations.

### 3.3 Internal seam

Suggested file organization, with names adjusted only if existing structure offers a clearer home:

```text
packages/design-system/
  foundation.tokens.json
  product-tokens.json
  preset.source.json
  preset.lock.json
  scripts/
    preset.mjs                 # existing command entry
    foundation.mjs             # input validation and resolution
    adapters/
      react.mjs
      css.mjs
      swift.mjs
  test/
    preset.test.mjs
    foundation.test.mjs
    adapters.test.mjs
```

Keep validation, token resolution, output assembly, hashing and stale-file reporting inside the deep design module. Small internal files are acceptable; do not expose their sequence as a new caller obligation.

The resolved foundation contains typed semantic roles, complete light/dark values, dimensions, motion, typography roles and explicit platform mappings. Use the project's existing token document conventions rather than inventing a second incompatible token language. Use one runtime validator rather than duplicate new JSON Schemas with no current consumer. The existing preset-source schema is descriptive and is not loaded by preset.mjs. Resolve references with cycle detection and errors for unknown references, missing required roles, unsupported units, invalid color values and unsupported modes.

Three concrete adapters justify the seam:

- React adapter emits existing preset CSS conventions, product CSS, TypeScript facts and components.json.
- CSS adapter emits --moira-* names and product entrypoints with explicit theme mode selection.
- Swift adapter emits native dynamic colors, dimensions and typography while retaining the existing public names.

The interface is the test surface: exercise sync/check/set and consume generated output. Internal pure-function tests support validation and conversions but do not replace generation and rendered-consumer checks.

### 3.4 Color conversion

The current React reference includes OKLCH and translucent colors; the old Swift generator accepts only hex and rgba. Do not reuse that parser unchanged.

Recommended answer adopted:

- Keep existing React CSS output stable where feasible.
- Convert resolved colors to sRGB for Swift and generate alpha explicitly. Replace the integer-channel RGB initializer with normalized floating-point channels to avoid quantizing conversions.
- Use deterministic, tested OKLCH-to-sRGB conversion and an explicit gamut policy. Clamp out-of-gamut channels consistently; document the tolerance used for cross-output comparisons.
- Resolve alpha against a named surface when a role requires an opaque window background. Preserve alpha for roles that are genuinely translucent.
- Reject unsupported expressions rather than feeding unresolved CSS syntax to Swift.
- Do not add a color dependency automatically. Inspect existing usable dependencies first; if a small standards-based conversion is required, implement it inside the module with trusted reference fixtures. Add a dependency only if its verified conversion coverage justifies it.

## 4. Implementation sequence

### Phase 0: baseline and consumer inventory

1. Inspect root and every affected nested repository status. Preserve unrelated changes. Each of the 11 named apps is a separate repository; root status does not establish app cleanliness. Review baseline: all are clean except Herm-Bot's untracked .pi/ directory, which must remain untouched. Root has the pre-existing plan.md modification.
2. Search for design-tokens imports, ui-css theme imports, --moira-* properties and all Swift Moira symbols. Include repository scripts, packaging code and tests, excluding generated/build directories.
3. Record current exports and used token names in a compatibility fixture.
4. Capture current representative light/dark screenshots and computed styles for React reference controls, LiteMaptica and Mini-NSW. Capture Semiquaver macOS and iOS baselines using available native tooling.
5. Record the known old-generator failure separately from new regressions.
6. Run the existing preset checks and narrow shared tests to establish the working React baseline.

Completion gate: inventory identifies every affected output and caller; platform differences and product exceptions are documented before changing generated values.

### Phase 1: author one foundation source and migration table

1. Move current React core light/dark roles and font policy out of template literals into foundation.tokens.json.
2. Add the shared spacing, radius, motion, type and control-size roles required by all existing outputs.
3. Build an explicit old-name-to-semantic-role table. Include every declared name in Appendix A. Explicitly map canvas-deep, surface-sunken, surface-overlay, surface-overlay-strong, overlay, overlay-subtle, backdrop, hairline-light/dark, control-selected, focus-soft, all action-primary states, text-on-action, window-background, disabled opacity, semantic status pairs and shadows. Move LiteMaptica's micro/label/detail/compact type roles into shared type policy. Both CSS apps use product action-primary tokens in ordinary buttons: map those usages to shared action roles, not domain exceptions. Separate domain accent usage from structural accent usage.
4. Express platform typography and control minimums as explicit adaptation policy.
5. Add CSS-only product visualization groups for LiteMaptica and Mini-NSW to the authoritative product source after auditing usages. Regenerate all five existing CSS themes, including exported but currently unused amove, exithibition and openagent entrypoints. Map their structural/action/focus names to shared semantics; retain telemetry names. OpenAgent has no current consumer and requires no app integration or structural exception.
6. No caller of @moirasia/design-tokens/tokens exists in the audited root or 11 nested apps. Remove this unused authoring export with the old package; do not build speculative compatibility output for unknown external consumers.
7. Add source validation. Errors identify the document and token path; do not substitute defaults for malformed values.

Completion gate: one source resolves all required roles without changing the current React reference unexpectedly.

### Phase 2: deterministic generation through one module

1. Refactor the existing preset entry so importing internal generation code does not execute CLI writes.
2. Extract the React adapter without changing its caller interface or generated names.
3. Implement the CSS adapter using the canonical resolved data and compatibility mappings.
4. Implement the Swift adapter using tested color conversion and every existing exported type/method.
5. Generate all content in memory and validate the complete output set before writing.
6. Extend preset.lock.json to include all output hashes, relevant input hashes and a generator format version.
7. Make check identify stale or absent CSS, Swift, React and lock outputs in one run without mutating files.
8. Route existing design-tokens build/check commands to the authoritative module temporarily if still referenced. Delete the obsolete template logic; do not leave two independent generators.
9. Verify unsupported preset set operations cannot modify source files or outputs.

Completion gate: sync followed by check succeeds, repeated sync has no diff, and deliberate output corruption is detected for every adapter.

### Phase 3: align CSS consumers without replacing their layouts

1. Update generated foundation.css while preserving consumed --moira-* names.
2. Keep ui-css/litemaptica.css and mini-nsw.css entrypoints stable.
3. Change product themes to select the approved dark/light mode and domain tokens only. Remove duplicated structural palette/radius/type overrides after replacing mixed usages.
4. Ensure theme selection overrides system preference deliberately for fixed-mode apps. Reduced-motion still applies regardless of mode.
5. Provide JetBrains Mono to plain-CSS consumers through a declared shared CSS asset/dependency path; do not rely on the operating system having the font installed. Verify packaging and licensing. Reuse the existing font package/version where suitable.
6. Replace local overrides only where they contradict approved shared foundation roles. Preserve map layouts, canvas sizing, zoom tools, overlay behavior and domain color legends.
7. Audit hardcoded 32px controls in Mini-NSW. The selector covers ordinary buttons, speed options and toggles, not only canvas tools. Move ordinary shared controls to a named size role; retain an explicitly justified compact canvas-tool size if it is needed. Do not force blanket control-layout changes.
8. Verify no product stylesheet reintroduces shared structural tokens through broad root overrides.

Completion gate: both apps use canonical structural roles, keep their existing workflows, and preserve readable domain visualizations.

### Phase 4: align Swift output and preserve native behavior

1. Generate all existing MoiraColor roles from canonical semantics with correct light/dark and alpha values.
2. Preserve MoiraSpace, MoiraRadius, MoiraControl and MoiraMotion names; document intentional platform adaptation.
3. Preserve caption, small, body, bodyLarge, titleSmall, title and titleLarge typography methods and current parameters. Use native fonts. Current methods use fixed .system(size:weight:design:) and do not themselves provide Dynamic Type scaling. Preserve signatures and default weights/designs; test explicit scaling adaptations at native call sites rather than claiming existing fixed-size fonts scale.
4. Preserve all 17 MoiraExithibition public exports even though the audited apps have no callers. Map structural exports to common dark semantics and telemetry exports to the product dark group. Preserve fixed-dark MoiraExithibition behavior, including windowBackground; do not silently make these colors adaptive. Never access nonexistent base data.
5. Inspect Semiquaver usage for assumptions about contrast, opacity and selected states. PlayerThemeTests.testSurfaceAndBorderTokensStayDistinctFromCanvas requires surface != canvas and border != surface in both modes. Preset light background and card are both white: mapping canvas to background and surface to card fails this test. Map native surface to the distinct neutral secondary role and raised surface to card; assert resolved/composited distinctions. MediaModels.swift uses shared status/neutral colors in all eight artwork gradient palettes; check artwork readability too. Update only affected presentation adapters, not playback or navigation logic.
6. Leave app-local card/modifier cleanup for a separate change unless required to apply the foundation correctly.

Completion gate: ui-swift tests and Semiquaver native builds pass; both native appearance modes retain legibility, Dynamic Type and reduced-motion behavior.

### Phase 5: compatibility, deletion and documentation

1. Regenerate every shared artifact and inspect the complete diff, especially unexpected React changes.
2. Compare Herm-Bot's complete vendored package against updated workspace contents; the baseline has 33 matching files. Repack only if authoritative generated output changed. Use local npm pack and the client npm lockfile workflow; no checked-in repack script exists. Do not publish or deploy.
3. Keep existing mobile variant adapters and touch-size overrides unless a specific conflict is demonstrated.
4. Search again for legacy authoring reads. Remove packages/design-tokens/tokens.json and obsolete generator/package only when no consumers depend on them. The tokens export has no audited callers; remove it rather than creating unused compatibility machinery. Remove its pnpm-lock.yaml importer through the normal local lockfile workflow.
5. Add narrow ownership assertions for migrated CSS product themes, not a universal desktop-shell rule for every platform.
6. Update ui-react README's stale Geist Sans description to match its actual JetBrains Mono font.
7. Document the canonical source, regeneration/check commands, platform adaptations and allowed product exceptions in shared package READMEs and docs/design-system/README.md. The latter prescribes the old generator, permits structural product overrides, excludes Semiquaver and claims an obsolete OpenAgent consumer; correct all those instructions.
8. Add a Shared UI foundation term to CONTEXT.md during implementation. Define it as the design module owning common semantics and generating React/CSS/Swift presentation adapters. Sharpen Product bar / appearance to distinguish chrome ownership from token ownership. Make these focused glossary edits directly.

Completion gate: the deletion test passes. Removing the old authoring module concentrates decisions in design-system instead of moving them into apps, and no stale command remains.

## 5. Test and verification plan

### 5.1 Shared-module regression tests

Add tests through the generation interface for:

- Current supported preset metadata and unsupported preset rejection.
- Complete required roles in both appearance modes.
- Unknown/cyclic references, unsupported dimensions/colors and invalid product overrides.
- Deterministic outputs, stable ordering and no working-directory dependency.
- Sync/check agreement and idempotent generation.
- Missing/stale artifacts across React, CSS, Swift and lock output.
- No source or output mutation on invalid input or read-only check.
- Preservation of all used CSS properties and Swift exports.
- Numeric conversion fixtures for colors, alpha, dimensions and motion.
- Cross-adapter equivalence of semantic values within documented conversion tolerance.
- Explicit allowed platform differences, including typography and touch-size minimums.
- Fixed dark/light CSS product policy independent of OS appearance.
- Product visualization groups cannot redefine common structural roles.

Do not use only snapshots of the old output. Assert semantic relationships and preserve a small number of intentional compatibility fixtures so a wrong generator cannot bless itself.

### 5.2 Commands

Start with narrow checks:

```sh
pnpm --filter @moirasia/design-system test
pnpm ui:preset:sync
pnpm ui:preset:check
pnpm typecheck
pnpm test
swift test --package-path packages/ui-swift
```

After migration, sync must generate all adapters; check must verify them. Do not run the broken old generator as a production build step.

Affected app verification, using each repository's existing manifest commands:

```sh
pnpm -C apps/integrated/Amove typecheck
pnpm -C apps/integrated/Amove test
pnpm -C apps/integrated/Amove build:app
pnpm -C apps/integrated/Bonded typecheck
pnpm -C apps/integrated/Bonded test
pnpm -C apps/integrated/Bonded build:renderer
pnpm -C apps/integrated/Shout typecheck
pnpm -C apps/integrated/Shout test
pnpm -C apps/integrated/Shout build:renderer
pnpm -C apps/standalone/Exithibition typecheck
pnpm -C apps/standalone/Exithibition test
pnpm -C apps/standalone/Exithibition build:renderer
pnpm -C apps/standalone/Orbis typecheck
pnpm -C apps/standalone/Orbis test
pnpm -C apps/standalone/Orbis build:app
pnpm -C apps/standalone/YN360 verify
bun --cwd apps/standalone/Vox run typecheck
bun --cwd apps/standalone/Vox test
bun --cwd apps/standalone/Vox run build:renderer
(cd apps/standalone/LiteMaptica && bun run check)
(cd apps/standalone/Mini-NSW/app && npm run typecheck && npm test && npm run build)
(cd apps/standalone/Herm-Bot/client && npm run typecheck && npm test && npm run build)
pnpm -C apps/standalone/Semiquaver test
```

Inspect current manifest scripts before execution; do not invent missing scripts. Semiquaver's pnpm test checks packaging scripts, not native presentation. The shared Xcode schemes are Semiquaver-macOS and Semiquaver, both with TestAction, in apps/standalone/Semiquaver/Semiquaver.xcodeproj. Run xcodebuild test for Semiquaver-macOS with destination platform=macOS and CODE_SIGNING_ALLOWED=NO. Run Semiquaver tests on an installed iOS Simulator destination listed by xcodebuild -showdestinations, with CODE_SIGNING_ALLOWED=NO. Run native presentation checks separately. Record unsupported simulator/platform checks explicitly.

Root ui:preset:check also runs scripts/check-ui-ownership.mjs, whose current scope is root, Amove, Exithibition, Bonded and Orbis. Preserve that check while adding narrow CSS ownership assertions. Run root ui:verify as a supplementary existing broad check where toolchains are available. It does not cover all these consumers and is not sufficient alone.

### 5.3 Rendered workflow verification

Use browser/Electron automation where available, Tauri launch or browser fixtures for LiteMaptica, and native tooling for Semiquaver. Source checks and typechecking do not prove appearance alignment.

Required matrix:

- React reference in light and dark modes, including window chrome, cards, buttons and text hierarchy.
- At least one integrated app inside Moirasia and in its own standalone window.
- LiteMaptica dark workspace under both light and dark OS preferences.
- Mini-NSW light workspace under both light and dark OS preferences.
- Semiquaver macOS light/dark and iOS representative text/accessibility sizes.
- Herm-Bot mobile control rendering if its artifact changes.
- Keyboard focus, disabled/selected/error states, reduced motion and contrasting text. Exercise nested .light within .dark and nested .dark within .light for preset and all four adaptive product styles; preserve explicit .light resets and selector ordering. In fixed-mode CSS apps check every status and shadow role under both OS preferences: color-scheme alone does not override OS-selected variables.
- Font assets present in development and built plain-CSS consumers.
- No clipped content after typography/dimension changes; no canvas or scroll regression.

Use temporary user-data locations and read-only fixtures. Do not enable PF rules, change default audio devices, install drivers, invoke real microphone workflows, alter libraries or publish apps just to test appearance. Open standalone apps directly, never from Moirasia.

Capture before/after evidence and computed-role values. Judge alignment by shared role policy, not pixel equality between native and web controls. Report gaps rather than treating missing platform runs as passes.

## 6. Acceptance criteria

Implementation is complete only when:

1. One editable module owns shared foundation decisions.
2. All React/CSS/Swift outputs regenerate from that module through existing commands.
3. The obsolete Exithibition base/light-dark failure is eliminated without silent fallback.
4. Current React structure remains stable except explicitly reviewed changes.
5. LiteMaptica and Mini-NSW use common structural roles, preserving fixed workspace modes and domain colors.
6. Swift named exports survive, the distinct-surface test remains valid, Exithibition exports remain fixed-dark, and native appearance/accessibility checks pass on available targets.
7. Every retained product exception is explicit and documented.
8. Sync is deterministic; check is read-only and detects drift in every adapter.
9. A single shared-role change is reflected in all three output adapters with no per-app token edits.
10. Font assets resolve in built CSS consumers.
11. Relevant app verification and rendered-flow checks pass or have explicit unresolved platform limitations.
12. Standalone apps remain independent; no launch/control/runtime integration is added.
13. Root and nested diffs contain only intentional changes; no release or privileged operation was performed.

## 7. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| OKLCH/translucent colors cannot be emitted by old Swift code | Tested deterministic conversion and explicit alpha policy |
| Legacy semantic names have no exact preset role | Explicit migration table; no silent drop or guessed fallback |
| Structural product overrides survive and defeat alignment | Audit call sites; separate domain colors from chrome roles |
| Swift regeneration removes methods used by Semiquaver | Compatibility fixture and actual native build checks |
| Shared font fails in Tauri or packaged Electron | Declared asset dependency and built-consumer verification |
| New dimensions clip dense map controls | Preserve named compact use cases and verify workflows |
| Mobile/native accessibility is lost to web parity | Platform policy, native typography and explicit touch minimums |
| Herm-Bot tarball differs despite unchanged version | Compare actual artifact contents; repack only when necessary |
| Nested repos have unrelated work or stale local file dependencies | Inspect each status; refresh affected dependency artifacts using local lock workflow |
| Tests assert output text but miss bad rendered behavior | Rendered interface checks plus semantic conversion assertions |

## 8. Delivery and rollback

Implement in coherent reviewable groups: source/validation and characterization tests; generation adapters and compatibility; CSS product migration; Swift/native verification; deletion/docs and full evidence.

Do not stage, commit, push, publish, sign, install privileged helpers or run release commands without explicit authorization. Changes to nested apps must be tracked and reviewed in their own repositories, not assumed to belong to the root commit.

For rollback, preserve the reviewed before-generation artifacts and baselines in the implementation change history. Reverse the affected implementation changes coherently only with authorization, keeping source and generated artifacts consistent. Never revert unrelated user changes or overwrite application data.

Final implementation report should identify the authoritative source, removed duplicate ownership, intentional platform exceptions, root/nested paths changed, commands run, rendered evidence and any remaining verification gaps.

## Appendix A. Independently checked source inventory

Preset check and all three preset tests pass. The old read-only generator check fails at build-css.mjs:127 before writing; later Amove light/dark generation is also invalid. Existing Swift package tests assert spacing and ordered motion, not conversion or accessibility.

Generation sites: design-system/scripts/preset.mjs owns eight payload outputs plus preset.lock.json. design-tokens/scripts/build-css.mjs owns foundation.css, five themes and ui-swift/Sources/MoirasiaUI/MoiraTokens.swift. Preserve all 16 unique generated paths, including the lock, under one owner. The five ui-css product entrypoints import foundation first and theme second.

- `packages/ui-css/foundation.css`: 77 declared names. `--moira-color-border`, `--moira-color-border-strong`, `--moira-color-canvas`, `--moira-color-control`, `--moira-color-control-hover`, `--moira-color-control-selected`, `--moira-color-danger-action`, `--moira-color-danger-action-hover`, `--moira-color-danger-surface`, `--moira-color-danger-text`, `--moira-color-neutral-0`, `--moira-color-neutral-100`, `--moira-color-neutral-200`, `--moira-color-neutral-25`, `--moira-color-neutral-300`, `--moira-color-neutral-50`, `--moira-color-neutral-500`, `--moira-color-neutral-600`, `--moira-color-neutral-700`, `--moira-color-neutral-800`, `--moira-color-neutral-900`, `--moira-color-neutral-dark-100`, `--moira-color-neutral-dark-300`, `--moira-color-neutral-dark-500`, `--moira-color-neutral-dark-600`, `--moira-color-neutral-dark-700`, `--moira-color-neutral-dark-800`, `--moira-color-status-danger-dark`, `--moira-color-status-danger-light`, `--moira-color-status-success-dark`, `--moira-color-status-success-light`, `--moira-color-status-warning-border`, `--moira-color-status-warning-dark`, `--moira-color-status-warning-light`, `--moira-color-success-surface`, `--moira-color-success-text`, `--moira-color-surface`, `--moira-color-surface-raised`, `--moira-color-text-muted`, `--moira-color-text-on-danger`, `--moira-color-text-primary`, `--moira-color-text-subtle`, `--moira-color-warning-border`, `--moira-color-warning-surface`, `--moira-color-warning-text`, `--moira-control-height-medium`, `--moira-control-height-small`, `--moira-font-family-mono`, `--moira-font-family-sans`, `--moira-font-size-body`, `--moira-font-size-body-large`, `--moira-font-size-caption`, `--moira-font-size-small`, `--moira-font-size-title-large`, `--moira-font-size-title-medium`, `--moira-font-size-title-small`, `--moira-motion-deliberate`, `--moira-motion-fast`, `--moira-motion-normal`, `--moira-opacity-disabled`, `--moira-radius-card`, `--moira-radius-control`, `--moira-radius-overlay`, `--moira-radius-panel`, `--moira-radius-pill`, `--moira-shadow-control`, `--moira-shadow-hairline`, `--moira-space-0`, `--moira-space-1`, `--moira-space-10`, `--moira-space-2`, `--moira-space-3`, `--moira-space-4`, `--moira-space-5`, `--moira-space-6`, `--moira-space-7`, `--moira-space-8`.

- `packages/ui-css/themes/amove.css`: 8 declared names. `--moira-color-action-primary`, `--moira-color-action-primary-border`, `--moira-color-action-primary-hover`, `--moira-color-action-primary-pressed`, `--moira-color-focus`, `--moira-color-focus-soft`, `--moira-color-text-on-action`, `--moira-color-window-background`.

- `packages/ui-css/themes/exithibition.css`: 17 declared names. `--moira-color-battery`, `--moira-color-border`, `--moira-color-canvas`, `--moira-color-cool`, `--moira-color-fan`, `--moira-color-focus`, `--moira-color-hot`, `--moira-color-load-high`, `--moira-color-load-low`, `--moira-color-selected`, `--moira-color-storage`, `--moira-color-surface`, `--moira-color-surface-raised`, `--moira-color-text-muted`, `--moira-color-text-primary`, `--moira-color-warm`, `--moira-color-window-background`.

- `packages/ui-css/themes/litemaptica.css`: 41 declared names. `--moira-color-accent`, `--moira-color-accent-border`, `--moira-color-accent-border-subtle`, `--moira-color-accent-glow`, `--moira-color-accent-muted`, `--moira-color-accent-soft`, `--moira-color-accent-surface`, `--moira-color-accent-surface-subtle`, `--moira-color-action-primary`, `--moira-color-action-primary-border`, `--moira-color-action-primary-hover`, `--moira-color-action-primary-pressed`, `--moira-color-backdrop`, `--moira-color-border`, `--moira-color-border-strong`, `--moira-color-canvas`, `--moira-color-canvas-deep`, `--moira-color-control`, `--moira-color-control-hover`, `--moira-color-control-selected`, `--moira-color-focus`, `--moira-color-focus-soft`, `--moira-color-hairline-dark`, `--moira-color-hairline-light`, `--moira-color-shadow`, `--moira-color-surface`, `--moira-color-surface-overlay`, `--moira-color-surface-overlay-strong`, `--moira-color-surface-raised`, `--moira-color-surface-sunken`, `--moira-color-text-muted`, `--moira-color-text-on-action`, `--moira-color-text-primary`, `--moira-color-text-subtle`, `--moira-font-size-compact`, `--moira-font-size-detail`, `--moira-font-size-label`, `--moira-font-size-micro`, `--moira-radius-card`, `--moira-radius-control`, `--moira-radius-panel`.

- `packages/ui-css/themes/mini-nsw.css`: 21 declared names. `--moira-color-action-primary`, `--moira-color-action-primary-border`, `--moira-color-action-primary-hover`, `--moira-color-action-primary-pressed`, `--moira-color-border`, `--moira-color-border-strong`, `--moira-color-canvas`, `--moira-color-control`, `--moira-color-control-hover`, `--moira-color-control-selected`, `--moira-color-focus`, `--moira-color-focus-soft`, `--moira-color-overlay`, `--moira-color-overlay-subtle`, `--moira-color-shadow`, `--moira-color-surface`, `--moira-color-surface-raised`, `--moira-color-text-muted`, `--moira-color-text-on-action`, `--moira-color-text-primary`, `--moira-color-text-subtle`.

- `packages/ui-css/themes/openagent.css`: 7 declared names. `--moira-color-action-primary`, `--moira-color-action-primary-border`, `--moira-color-action-primary-hover`, `--moira-color-action-primary-pressed`, `--moira-color-focus`, `--moira-color-focus-soft`, `--moira-color-text-on-action`.

- `MoiraColor`: 21 exports. `canvas`, `surface`, `surfaceRaised`, `textPrimary`, `textMuted`, `textSubtle`, `border`, `borderStrong`, `control`, `controlHover`, `controlSelected`, `successSurface`, `successText`, `warningSurface`, `warningBorder`, `warningText`, `dangerSurface`, `dangerText`, `dangerAction`, `dangerActionHover`, `textOnDanger`.
- `MoiraSpace`: 9 exports. `x1`, `x2`, `x3`, `x4`, `x5`, `x6`, `x7`, `x8`, `x10`.
- `MoiraRadius`: 5 exports. `control`, `card`, `panel`, `overlay`, `pill`.
- `MoiraControl`: 2 exports. `smallHeight`, `mediumHeight`.
- `MoiraMotion`: 3 exports. `fast`, `normal`, `deliberate`.
- `MoiraType`: 7 exports. `caption`, `small`, `body`, `bodyLarge`, `titleSmall`, `title`, `titleLarge`.
- `MoiraExithibition`: 17 exports. `canvas`, `surface`, `surfaceRaised`, `textPrimary`, `textMuted`, `border`, `cool`, `warm`, `hot`, `loadLow`, `loadHigh`, `focus`, `selected`, `battery`, `storage`, `fan`, `windowBackground`.

Existing directly relevant tests: design-system/test/preset.test.mjs checks decoding, committed drift and invalid-code/source-preservation. ui-swift/Tests/MoirasiaUITests/MoiraTokensTests.swift contains spacingUsesFourPointFoundation and motionDurationsRemainOrdered. Semiquaver/Semiquaver-macOSTests/PlayerThemeTests.swift contains testSurfaceAndBorderTokensStayDistinctFromCanvas. Root tests/ui-react.test.tsx covers React components. No existing test proves cross-adapter equivalence; add semantic tests rather than merely copying old output.

### Consumer call-site index

These indexes record source line numbers at review time, not future generated line numbers.

`apps/standalone/LiteMaptica/src/styles.css` uses 64 distinct shared property names:

- `--moira-color-accent`: 228.
- `--moira-color-accent-border`: 271.
- `--moira-color-accent-border-subtle`: 278, 288.
- `--moira-color-accent-glow`: 151.
- `--moira-color-accent-muted`: 272.
- `--moira-color-accent-soft`: 113, 230.
- `--moira-color-accent-surface`: 273.
- `--moira-color-accent-surface-subtle`: 279, 290, 496.
- `--moira-color-action-primary`: 67, 318, 558.
- `--moira-color-action-primary-border`: 66, 556.
- `--moira-color-action-primary-hover`: 72, 73, 112, 564, 565.
- `--moira-color-action-primary-pressed`: 112.
- `--moira-color-backdrop`: 597.
- `--moira-color-border`: 88, 181, 188, 212, 311, 476, 493, 504, 573.
- `--moira-color-border-strong`: 30, 354, 377, 427, 511, 545, 605, 622.
- `--moira-color-canvas`: 80.
- `--moira-color-canvas-deep`: 4, 333, 514, 626.
- `--moira-color-control`: 33.
- `--moira-color-control-hover`: 44.
- `--moira-color-control-selected`: 48, 369.
- `--moira-color-danger-action`: 396, 644.
- `--moira-color-danger-surface`: 647.
- `--moira-color-danger-text`: 646.
- `--moira-color-focus`: 56.
- `--moira-color-focus-soft`: 54.
- `--moira-color-hairline-dark`: 447.
- `--moira-color-hairline-light`: 445.
- `--moira-color-shadow`: 608.
- `--moira-color-success-text`: 150, 392, 483, 587.
- `--moira-color-surface`: 175, 607.
- `--moira-color-surface-overlay`: 111, 356, 380, 430.
- `--moira-color-surface-overlay-strong`: 671.
- `--moira-color-surface-sunken`: 89, 575.
- `--moira-color-text-muted`: 139, 205, 257, 302, 379, 429, 464, 495, 581, 631.
- `--moira-color-text-on-action`: 65, 557.
- `--moira-color-text-primary`: 3, 32, 229, 368, 469, 513, 625.
- `--moira-color-text-subtle`: 43, 126, 192, 224, 250, 324, 414, 456, 537, 574.
- `--moira-color-warning-text`: 155, 487.
- `--moira-control-height-medium`: 78, 669.
- `--moira-control-height-small`: 107, 108.
- `--moira-font-family-mono`: 114, 127, 193, 235, 303, 457.
- `--moira-font-family-sans`: 2.
- `--moira-font-size-body`: 119, 452.
- `--moira-font-size-caption`: 244.
- `--moira-font-size-compact`: 140, 296, 632.
- `--moira-font-size-detail`: 206, 235, 364, 431, 457, 465, 515, 538, 559, 648.
- `--moira-font-size-label`: 193, 251, 303, 325, 381, 415, 497, 526, 576.
- `--moira-font-size-micro`: 127.
- `--moira-font-size-title-medium`: 613.
- `--moira-font-size-title-small`: 114.
- `--moira-motion-fast`: 36, 37, 38, 39.
- `--moira-motion-normal`: 319.
- `--moira-opacity-disabled`: 60.
- `--moira-radius-card`: 109, 355, 378.
- `--moira-radius-control`: 31, 289, 428, 623.
- `--moira-radius-panel`: 606.
- `--moira-radius-pill`: 149, 310, 317, 388, 475, 482.
- `--moira-space-1`: 198, 285, 286, 473, 525.
- `--moira-space-2`: 29, 135, 151, 222, 264, 426, 492, 525, 531, 544, 598, 655.
- `--moira-space-3`: 29, 221, 357, 432, 638.
- `--moira-space-4`: 216, 412, 491, 642.
- `--moira-space-5`: 174, 211, 216, 502, 551, 630.
- `--moira-space-6`: 113, 595, 604, 608.
- `--moira-space-7`: 571.

`apps/standalone/Mini-NSW/app/src/renderer/styles.css` uses 31 distinct shared property names:

- `--moira-color-action-primary`: 216, 292.
- `--moira-color-action-primary-border`: 299.
- `--moira-color-action-primary-hover`: 304.
- `--moira-color-action-primary-pressed`: 310.
- `--moira-color-border`: 38, 51, 78, 141, 212, 232, 243, 267.
- `--moira-color-border-strong`: 153, 196, 271.
- `--moira-color-canvas`: 18, 24.
- `--moira-color-control`: 155.
- `--moira-color-control-hover`: 300.
- `--moira-color-focus`: 254, 317.
- `--moira-color-focus-soft`: 319.
- `--moira-color-overlay`: 40, 53.
- `--moira-color-overlay-subtle`: 64.
- `--moira-color-shadow`: 41, 54.
- `--moira-color-surface`: 143, 234.
- `--moira-color-text-muted`: 65, 110, 119, 177, 278.
- `--moira-color-text-on-action`: 217, 311.
- `--moira-color-text-primary`: 17, 126, 144, 156, 182, 207.
- `--moira-font-family-sans`: 16.
- `--moira-font-size-caption`: 145, 176.
- `--moira-font-size-small`: 106, 158.
- `--moira-motion-fast`: 160, 161, 162.
- `--moira-opacity-disabled`: 326.
- `--moira-radius-card`: 52.
- `--moira-radius-control`: 39, 154, 197, 233.
- `--moira-radius-pill`: 142.
- `--moira-space-1`: 63.
- `--moira-space-2`: 34, 37, 77, 174.
- `--moira-space-3`: 75, 77, 104, 105, 181.
- `--moira-space-4`: 29, 30, 46, 47.
- `--moira-space-8`: 35, 48, 49.

Semiquaver Moira symbol call sites, relative to apps/standalone/Semiquaver:

- `MoiraColor.border`: Semiquaver/ContentView.swift:340, Semiquaver/Design/PlayerTheme.swift:22, Semiquaver/Models/MediaModels.swift:309, Semiquaver/Views/Detail/AlbumDetailView.swift:86, Semiquaver/Views/Detail/ArtistDetailView.swift:109, Semiquaver/Views/Detail/GenreDetailView.swift:85, Semiquaver/Views/Detail/PlaylistDetailView.swift:100, Semiquaver/Views/Shared/SharedPresentation.swift:117, Semiquaver/Views/Tabs/AudioTabView.swift:159, Semiquaver/Views/Tabs/AudioTabView.swift:183, Semiquaver/Views/Tabs/AudioTabView.swift:210, Semiquaver/Views/Tabs/AudioTabView.swift:256, Semiquaver/Views/Tabs/AudioTabView.swift:321, Semiquaver/Views/Tabs/PlaylistsTabView.swift:46, Semiquaver/Views/Tabs/SettingsTabView.swift:39, Semiquaver/Views/Tabs/SettingsTabView.swift:51, Semiquaver/Views/Tabs/SettingsTabView.swift:59, Semiquaver/Views/Tabs/SettingsTabView.swift:70, Semiquaver/Views/Tabs/SettingsTabView.swift:137, Semiquaver/Views/Tabs/SettingsTabView.swift:146, Semiquaver/Views/Tabs/SettingsTabView.swift:155, Semiquaver/Views/Tabs/SettingsTabView.swift:175, Semiquaver-macOSTests/PlayerThemeTests.swift:15.
- `MoiraColor.borderStrong`: Semiquaver/Models/MediaModels.swift:305, Semiquaver/Models/MediaModels.swift:308.
- `MoiraColor.canvas`: Semiquaver/Views/Detail/AlbumDetailView.swift:14, Semiquaver/Views/Detail/ArtistDetailView.swift:27, Semiquaver/Views/Detail/GenreDetailView.swift:12, Semiquaver/Views/Detail/PlaylistDetailView.swift:22, Semiquaver/Views/Shared/NowPlayingView.swift:21, Semiquaver/Views/Shared/QueueListView.swift:113, Semiquaver/Views/Shared/SharedPresentation.swift:21, Semiquaver/Views/Tabs/AudioTabView.swift:24, Semiquaver/Views/Tabs/AudioTabView.swift:300, Semiquaver/Views/Tabs/PlaylistsTabView.swift:18, Semiquaver/Views/Tabs/SettingsTabView.swift:22, Semiquaver/Views/Tabs/SettingsTabView.swift:189, Semiquaver-macOSTests/PlayerThemeTests.swift:13.
- `MoiraColor.controlHover`: Semiquaver-macOS/MacViews.swift:217.
- `MoiraColor.controlSelected`: Semiquaver/Views/Shared/MediaRow.swift:46, Semiquaver/Views/Shared/SharedPresentation.swift:100, Semiquaver/Views/Shared/SharedPresentation.swift:186.
- `MoiraColor.dangerAction`: Semiquaver/Models/MediaModels.swift:304, Semiquaver/Models/MediaModels.swift:307, Semiquaver/Views/Shared/NowPlayingView.swift:68.
- `MoiraColor.dangerSurface`: Semiquaver/Models/MediaModels.swift:310.
- `MoiraColor.dangerText`: Semiquaver/Models/MediaModels.swift:307.
- `MoiraColor.successSurface`: Semiquaver/Models/MediaModels.swift:306.
- `MoiraColor.successText`: Semiquaver/Models/MediaModels.swift:305, Semiquaver/Models/MediaModels.swift:311, Semiquaver/Views/Tabs/SettingsTabView.swift:120.
- `MoiraColor.surface`: Semiquaver/ContentView.swift:193, Semiquaver/Design/PlayerTheme.swift:20, Semiquaver/Views/Shared/SharedPresentation.swift:114, Semiquaver-macOSTests/PlayerThemeTests.swift:14, Semiquaver-macOSTests/PlayerThemeTests.swift:21, Semiquaver-macOSTests/PlayerThemeTests.swift:22.
- `MoiraColor.surfaceRaised`: Semiquaver/ContentView.swift:335, Semiquaver/Views/Tabs/AudioTabView.swift:156.
- `MoiraColor.textMuted`: Semiquaver/ContentView.swift:115, Semiquaver/ContentView.swift:297, Semiquaver/Models/MediaModels.swift:306, Semiquaver/Models/MediaModels.swift:309, Semiquaver/Views/Detail/AlbumDetailView.swift:53, Semiquaver/Views/Detail/ArtistDetailView.swift:75, Semiquaver/Views/Detail/PlaylistDetailView.swift:69, Semiquaver/Views/Shared/MediaRow.swift:27, Semiquaver/Views/Shared/NowPlayingView.swift:66, Semiquaver/Views/Shared/NowPlayingView.swift:105, Semiquaver/Views/Shared/PlaylistRow.swift:33, Semiquaver/Views/Shared/QueueListView.swift:23, Semiquaver/Views/Shared/QueueListView.swift:31, Semiquaver/Views/Shared/QueueListView.swift:56, Semiquaver/Views/Shared/QueueListView.swift:66, Semiquaver/Views/Shared/QueueListView.swift:91, Semiquaver/Views/Shared/SettingsRows.swift:19, Semiquaver/Views/Shared/SettingsRows.swift:28, Semiquaver/Views/Shared/SettingsRows.swift:56, Semiquaver/Views/Shared/SharedPresentation.swift:173, Semiquaver/Views/Shared/SharedPresentation.swift:181, Semiquaver/Views/Shared/SharedPresentation.swift:208, Semiquaver/Views/Shared/SharedPresentation.swift:243, Semiquaver/Views/Shared/SharedPresentation.swift:257, Semiquaver/Views/Shared/SharedPresentation.swift:260, Semiquaver/Views/Shared/SharedPresentation.swift:261, Semiquaver/Views/Shared/SharedPresentation.swift:293, Semiquaver/Views/Shared/SharedPresentation.swift:326, Semiquaver/Views/Shared/SharedPresentation.swift:351, Semiquaver/Views/Shared/SharedPresentation.swift:392, Semiquaver/Views/Shared/SharedPresentation.swift:395, Semiquaver/Views/Shared/SharedPresentation.swift:402, Semiquaver/Views/Shared/SharedPresentation.swift:432, Semiquaver/Views/Shared/SharedPresentation.swift:446, Semiquaver/Views/Tabs/AudioTabView.swift:58, Semiquaver/Views/Tabs/AudioTabView.swift:139, Semiquaver/Views/Tabs/AudioTabView.swift:151, Semiquaver/Views/Tabs/AudioTabView.swift:291, Semiquaver/Views/Tabs/AudioTabView.swift:330, Semiquaver/Views/Tabs/AudioTabView.swift:352, Semiquaver/Views/Tabs/SettingsTabView.swift:128, Semiquaver/Views/Tabs/SettingsTabView.swift:228.
- `MoiraColor.textPrimary`: Semiquaver/ContentView.swift:65, Semiquaver/ContentView.swift:67, Semiquaver/ContentView.swift:115, Semiquaver/ContentView.swift:314, Semiquaver/ContentView.swift:325, Semiquaver/Models/MediaModels.swift:260, Semiquaver/Models/MediaModels.swift:311, Semiquaver/Views/Detail/AlbumDetailView.swift:48, Semiquaver/Views/Detail/ArtistDetailView.swift:64, Semiquaver/Views/Detail/ArtistDetailView.swift:70, Semiquaver/Views/Detail/GenreDetailView.swift:49, Semiquaver/Views/Detail/GenreDetailView.swift:55, Semiquaver/Views/Detail/PlaylistDetailView.swift:59, Semiquaver/Views/Detail/PlaylistDetailView.swift:65, Semiquaver/Views/Shared/MediaRow.swift:22, Semiquaver/Views/Shared/MediaRow.swift:36, Semiquaver/Views/Shared/PlaylistRow.swift:22, Semiquaver/Views/Shared/PlaylistRow.swift:28, Semiquaver/Views/Shared/QueueListView.swift:104, Semiquaver/Views/Shared/QueueListView.swift:121, Semiquaver/Views/Shared/SettingsRows.swift:14, Semiquaver/Views/Shared/SettingsRows.swift:51, Semiquaver/Views/Shared/SharedPresentation.swift:141, Semiquaver/Views/Shared/SharedPresentation.swift:178, Semiquaver/Views/Shared/SharedPresentation.swift:242, Semiquaver/Views/Shared/SharedPresentation.swift:318, Semiquaver/Views/Shared/SharedPresentation.swift:326, Semiquaver/Views/Shared/SharedPresentation.swift:350, Semiquaver/Views/Shared/SharedPresentation.swift:429, Semiquaver/Views/Tabs/AudioTabView.swift:58, Semiquaver/Views/Tabs/AudioTabView.swift:287, Semiquaver/Views/Tabs/AudioTabView.swift:305, Semiquaver/Views/Tabs/AudioTabView.swift:348, Semiquaver/Views/Tabs/SettingsTabView.swift:125, Semiquaver/Views/Tabs/SettingsTabView.swift:199, Semiquaver/Views/Tabs/SettingsTabView.swift:203, Semiquaver/Views/Tabs/SettingsTabView.swift:219, Semiquaver-macOS/MacViews.swift:38.
- `MoiraColor.textSubtle`: Semiquaver/Models/MediaModels.swift:308, Semiquaver/Views/Detail/AlbumDetailView.swift:58, Semiquaver/Views/Detail/ArtistDetailView.swift:83, Semiquaver/Views/Detail/GenreDetailView.swift:59, Semiquaver/Views/Detail/PlaylistDetailView.swift:73, Semiquaver/Views/Shared/MediaRow.swift:41, Semiquaver/Views/Shared/PlaylistRow.swift:41, Semiquaver/Views/Shared/SettingsRows.swift:34, Semiquaver/Views/Shared/SharedPresentation.swift:211, Semiquaver/Views/Shared/SharedPresentation.swift:352, Semiquaver/Views/Shared/SharedPresentation.swift:426, Semiquaver/Views/Tabs/AudioTabView.swift:282, Semiquaver/Views/Tabs/AudioTabView.swift:343.
- `MoiraColor.warningSurface`: Semiquaver/Models/MediaModels.swift:310.
- `MoiraColor.warningText`: Semiquaver/Models/MediaModels.swift:304, Semiquaver/Views/Tabs/SettingsTabView.swift:120.
- `MoiraMotion.normal`: Semiquaver/Design/PlayerTheme.swift:33.
- `MoiraRadius.card`: Semiquaver/Views/Shared/MediaRow.swift:47, Semiquaver/Views/Shared/PlaylistRow.swift:10, Semiquaver/Views/Shared/PlaylistRow.swift:45, Semiquaver/Views/Shared/SharedPresentation.swift:187, Semiquaver-macOS/MacViews.swift:218.
- `MoiraRadius.panel`: Semiquaver/ContentView.swift:336, Semiquaver/ContentView.swift:339, Semiquaver/Design/PlayerTheme.swift:19, Semiquaver/Design/PlayerTheme.swift:21, Semiquaver/Views/Detail/ArtistDetailView.swift:52, Semiquaver/Views/Detail/GenreDetailView.swift:37, Semiquaver/Views/Detail/PlaylistDetailView.swift:47.
- `MoiraRadius.pill`: Semiquaver/Views/Tabs/AudioTabView.swift:304.
- `MoiraSpace.x1`: Semiquaver/Views/Shared/SharedPresentation.swift:171, Semiquaver/Views/Shared/SharedPresentation.swift:206, Semiquaver/Views/Shared/SharedPresentation.swift:279.
- `MoiraSpace.x2`: Semiquaver/Views/Shared/SharedPresentation.swift:175, Semiquaver/Views/Shared/SharedPresentation.swift:184, Semiquaver/Views/Shared/SharedPresentation.swift:241, Semiquaver/Views/Shared/SharedPresentation.swift:349.
- `MoiraSpace.x3`: Semiquaver/Views/Shared/SharedPresentation.swift:169, Semiquaver/Views/Shared/SharedPresentation.swift:199, Semiquaver/Views/Shared/SharedPresentation.swift:252, Semiquaver/Views/Shared/SharedPresentation.swift:423.
- `MoiraSpace.x4`: Semiquaver/Views/Shared/SharedPresentation.swift:230, Semiquaver/Views/Shared/SharedPresentation.swift:442.
- `MoiraSpace.x6`: Semiquaver/Views/Shared/SharedPresentation.swift:229, Semiquaver/Views/Shared/SharedPresentation.swift:233, Semiquaver/Views/Shared/SharedPresentation.swift:346, Semiquaver/Views/Shared/SharedPresentation.swift:378, Semiquaver/Views/Shared/SharedPresentation.swift:435.
- `MoiraType.body`: Semiquaver/ContentView.swift:66, Semiquaver/ContentView.swift:293, Semiquaver/Views/Detail/AlbumDetailView.swift:52, Semiquaver/Views/Detail/ArtistDetailView.swift:74, Semiquaver/Views/Detail/PlaylistDetailView.swift:68, Semiquaver/Views/Shared/MediaRow.swift:21, Semiquaver/Views/Shared/PlaylistRow.swift:27, Semiquaver/Views/Shared/QueueListView.swift:22, Semiquaver/Views/Shared/QueueListView.swift:65, Semiquaver/Views/Shared/SettingsRows.swift:13, Semiquaver/Views/Shared/SettingsRows.swift:50, Semiquaver/Views/Shared/SharedPresentation.swift:172, Semiquaver/Views/Shared/SharedPresentation.swift:207, Semiquaver/Views/Shared/SharedPresentation.swift:256, Semiquaver/Views/Shared/SharedPresentation.swift:261, Semiquaver/Views/Shared/SharedPresentation.swift:392, Semiquaver/Views/Shared/SharedPresentation.swift:395, Semiquaver/Views/Shared/SharedPresentation.swift:402, Semiquaver/Views/Shared/SharedPresentation.swift:431, Semiquaver/Views/Shared/SharedPresentation.swift:445, Semiquaver/Views/Tabs/AudioTabView.swift:290, Semiquaver/Views/Tabs/AudioTabView.swift:299, Semiquaver/Views/Tabs/AudioTabView.swift:329, Semiquaver/Views/Tabs/AudioTabView.swift:351, Semiquaver/Views/Tabs/SettingsTabView.swift:124.
- `MoiraType.bodyLarge`: Semiquaver/Views/Shared/SharedPresentation.swift:243, Semiquaver/Views/Shared/SharedPresentation.swift:351.
- `MoiraType.caption`: Semiquaver/Views/Shared/SharedPresentation.swift:211, Semiquaver/Views/Shared/SharedPresentation.swift:293.
- `MoiraType.small`: Semiquaver/ContentView.swift:113, Semiquaver/ContentView.swift:296, Semiquaver/Views/Detail/AlbumDetailView.swift:57, Semiquaver/Views/Detail/ArtistDetailView.swift:82, Semiquaver/Views/Detail/GenreDetailView.swift:58, Semiquaver/Views/Detail/PlaylistDetailView.swift:72, Semiquaver/Views/Shared/MediaRow.swift:26, Semiquaver/Views/Shared/NowPlayingView.swift:63, Semiquaver/Views/Shared/PlaylistRow.swift:32, Semiquaver/Views/Shared/QueueListView.swift:28, Semiquaver/Views/Shared/QueueListView.swift:53, Semiquaver/Views/Shared/QueueListView.swift:88, Semiquaver/Views/Shared/QueueListView.swift:103, Semiquaver/Views/Shared/SettingsRows.swift:18, Semiquaver/Views/Shared/SettingsRows.swift:55, Semiquaver/Views/Shared/SharedPresentation.swift:173, Semiquaver/Views/Shared/SharedPresentation.swift:181, Semiquaver/Views/Shared/SharedPresentation.swift:208, Semiquaver/Views/Shared/SharedPresentation.swift:257, Semiquaver/Views/Shared/SharedPresentation.swift:352, Semiquaver/Views/Tabs/AudioTabView.swift:57, Semiquaver/Views/Tabs/SettingsTabView.swift:127, Semiquaver/Views/Tabs/SettingsTabView.swift:227.
- `MoiraType.title`: Semiquaver/Views/Detail/AlbumDetailView.swift:47, Semiquaver/Views/Detail/ArtistDetailView.swift:69, Semiquaver/Views/Detail/GenreDetailView.swift:54, Semiquaver/Views/Detail/PlaylistDetailView.swift:64, Semiquaver/Views/Shared/SharedPresentation.swift:428, Semiquaver/Views/Tabs/AudioTabView.swift:286, Semiquaver/Views/Tabs/AudioTabView.swift:347.
- `MoiraType.titleLarge`: Semiquaver/Views/Shared/SharedPresentation.swift:242, Semiquaver/Views/Shared/SharedPresentation.swift:350.

React generator functions to preserve or replace: validateSource, stableJson, hash, cssVars, valueOf, tokenVars, presetCss, productCss, componentsJson, mainTokens, buildOutputs, inputs, sync and check. Current presetCss includes 31 light/dark core roles, derived radius roles, translucent color-mix menus, blur/saturation, shadows and explicit .light inheritance resets. Product paths are amove shelf-only and vox/exithibition/bonded/yn360 adaptive light/dark. Keep menu expressions valid for web; Swift conversion must consume resolved solid colors rather than trying to parse arbitrary CSS color-mix/filter/shadow strings. Unsupported product names and malformed groups must fail rather than falling through to the current unused base-mode branch.
