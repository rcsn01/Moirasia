# Standalone iOS pixel Pokémon companion

## Status and product goal

The personal-use implementation is complete in `apps/standalone/Pixim/`. It includes five Pokémon, original-timing animated catalog previews, persisted preference, one mutable Live Activity, recovery, removal, retry, attribution and source hashes. The user approved local personal use despite unresolved redistribution rights and initially accepted ten sampled Island poses over ten seconds. After confirming faster Pokémon playback on Iphen, the user requested fast mode as the default. iOS 18+ now requests 100 ms text precision for a one-second ten-pose loop; iOS 17 retains the seconds fallback. This scope decision does not authorize publication.

The initial UIImage and timeline probes stayed static. System-managed text measuring actual session age with bitmap digit glyphs now advances frames with the host terminated. Earlier original-art Simulator sampling passed before and after five minutes. All five Pokémon passed actual SpringBoard pixel-motion checks with the host terminated. The user also confirmed sustained motion on their physical iPhone through leaving/locking and waiting five minutes, without supplying independent model/OS/video/power evidence.

The latest default-fast verification passed seventeen unit/integration tests and three catalog UI tests. Earlier diagnostic regression checks also passed. Subsecond sampling measured at least 7.1 changes/sec before and after five minutes with the host terminated, limited by capture rate; all five Pokémon passed actual compact motion checks under the new default. Unsigned Release build, byte-idempotent asset generation and shared UI ownership checks passed. See [verification](apps/standalone/Pixim/VERIFICATION.md). The existing root `plan.md` remains unchanged.

### Completion and remaining acceptance

- [x] Independent native app and Live Activity extension with all four layouts.
- [x] Five pinned personal-only assets, stable canvases, full original preview timing and sampled Island fonts.
- [x] User-initiated start/change/remove, latest-intent ordering, recovery, preference, retry and lifecycle observation.
- [x] Accessibility labels, minimum touch targets, paused/inactive/offscreen previews and motion-freeze branches.
- [x] Actual Simulator catalog workflow and terminated-host motion evidence for every companion.
- [ ] Independently record physical model/OS/video and test power, eight-hour expiry, AOD, minimal/competing activities, Lock Screen and native accessibility Settings.
- [ ] Exercise the minimum supported iOS runtime.
- [ ] Clear artwork/branding rights and review suitability before any redistribution.

The sections below retain the original research and acceptance requirements. The user-approved personal prototype is delivered; the unperformed hardware and distribution checks are not marked complete.

Build an independent native iPhone app whose main interface is a small catalog of pixel Pokémon animations. Choosing one starts or changes the companion shown through a Live Activity in the Dynamic Island. The app is not embedded in, launched by, or controlled by Moirasia. Use the shared `MoirasiaUI` package for the app's controls, typography, spacing and semantic colors.

Working directory name: `apps/standalone/Pixim/`. This is a provisional internal name, not an approved public brand.

**The original feasibility requirement follows. Simulator motion now passes and the user reports physical-device success; independent hardware acceptance remains open.** Apple provides a supported way to display content in the Dynamic Island, but its documentation does not establish an autonomous, continuously looping ten-frame sprite there. Do not describe a static companion or an animation that only runs inside the app as completion of the requested animated Island feature. First prove the animation on a real iPhone. If that fails, ask the user whether to accept a static Island companion with animated catalog previews or stop development.

## 1. Getting content into the Dynamic Island

Use ActivityKit to manage a Live Activity and a WidgetKit extension to render it with SwiftUI. There is no installation slot, arbitrary overlay API or permanent ownership of the camera cutout. Apple's system controls the presentation and which activities are visible. [A1, A2]

Required project setup:

- Native SwiftUI iPhone application and WidgetKit Live Activity extension.
- `NSSupportsLiveActivities = YES` on the app target.
- Shared `ActivityAttributes` definition compiled into both targets.
- `ActivityConfiguration` with Lock Screen, compact leading/trailing, minimal and expanded presentations.
- Foreground, user-initiated `Activity.request`; `update` for a new selection; `end` when the user removes the companion.
- Check `ActivityAuthorizationInfo().areActivitiesEnabled` before starting and handle request errors. Live Activity authorization is separate from notification permission. Do not add a notification permission request merely to show a local activity. [A1, A3]

Use iOS 17 as the initial minimum because modern custom Live Activity animation support differs from iOS 16. Verify deployment compatibility against the current Xcode SDK before project creation. Test the latest available iOS as well as the minimum supported version. Do not mistake an OS version check for a Dynamic Island hardware check. [A4]

### Limits that the product must disclose

- A Live Activity is active for **up to eight hours**. At that limit it leaves the Dynamic Island. It can remain on the Lock Screen for up to four additional hours, for a maximum of twelve hours there. Twelve hours is not the Island lifetime. Users or the system can end it sooner. [A1]
- Multiple activities compete for space. The system can switch to minimal presentation or show another activity. Never promise that the companion is always visible. [A1, A2]
- Non-Island phones can still show the Lock Screen presentation. Explain that fallback instead of displaying a fake Dynamic Island. [A1]
- Live Activity views cannot fetch their own network assets. Bundle approved artwork locally in the extension. ActivityKit content should carry identifiers, not GIF bytes or frame arrays. [A1]
- Image assets must fit presentation constraints; oversized assets can prevent an activity from starting. Validate image resolution and asset scale metadata against the smallest supported presentation. A view's `.frame` alone is not proof that an oversized asset is safe. [A1, A2]
- Apple recommends tasks or events with a defined beginning and end. A decoration-only companion has an App Review suitability risk. Do not invent a delivery, workout or fake timer to evade that issue. [A2, A5]

The catalog should say “Show companion” rather than “Install permanently.” An active state means ActivityKit reports an ongoing activity, not that we know it is currently visible in the Island.

## 2. Animation research and feasibility gate

### What is documented

Apple's Live Activities HIG says animations have a **maximum duration of two seconds** and that animations are not performed on Always-On displays with reduced luminance. The animation documentation describes animations associated with content updates, including transitions, `.animation(_:value:)` and `.contentTransition`. These establish support for brief changes, not a sustained sprite player. [A2, A4]

A GIF containing ten frames is an asset format, not proof that `Image` will autoplay it in a Live Activity. Likewise, a repeating SwiftUI animation that works in the foreground app is not proof that it continues when WidgetKit hosts the view and the app is suspended.

Do not plan a frame-by-frame ActivityKit update loop. The app cannot rely on continuing timers after suspension, the extension does not use a widget timeline for Live Activity updates, and remote pushes have budgets and throttling. APNs is not a video transport. No backend, frequent-update entitlement, silent audio, fabricated location use, private API or jailbreak workaround belongs in this app. [A1, A6]

Existing products advertise animated pixel companions in this location, including SpritePals. That is useful evidence that similar products exist, but the product page does not disclose its animation mechanism, supported presentations or behavior during suspension. It does not prove our proposed implementation. [C1]

### Phase 0: small, time-boxed real-device spike

Before building the catalog or acquiring Pokémon assets, create the smallest app/extension with an original ten-frame test creature that we have rights to use.

1. Show one static frame in all four required presentations. Confirm permission, start, update and end behavior first.
2. Demonstrate a documented short transition when selection changes. Record the difference between this transition and the desired idle loop.
3. Test plausible public-API sprite techniques independently. A bundled animated image and a SwiftUI-only frame/sprite-sheet animation are experiments, not promised solutions. Record the exact method, SDK and OS version. Do not implement background frame-update spam to make a demo look successful.
4. Leave the app, open a different app, lock/unlock the phone and observe after at least five minutes. Check compact, minimal and expanded presentations separately. Always-On reduced luminance and Reduce Motion may legitimately suppress motion.
5. Capture real-device video with timestamps. Record whether the creature actually changes frames, how long it continues, whether the app is suspended and whether any CPU, network or background-mode workaround is needed.
6. If another public-API technique is found, trace it to its original source and test it under the same conditions. Marketing videos alone are insufficient evidence. Undocumented rendering tricks are not the default shipping architecture.

**Go/no-go:** the animated product proceeds only if a public-API implementation demonstrably loops while the host app is backgrounded/suspended, fits the actual Island presentations, has acceptable power use and has a defensible API/review story. Passing in a SwiftUI preview or only while the app is foregrounded is a failure for the requested feature.

If continuous playback cannot be demonstrated, bring the user the evidence and offer the static-Island/animated-preview alternative explicitly. Do not silently change the requirement. If the user requires continuous animation and rejects the alternative, stop after the spike.

## 3. Existing Pokémon pixel animation sources

These are research candidates, not cleared app assets. “About ten frames” is a preference, not a requirement to discard frames or change animation speed. Prefer a small readable idle loop over an exact frame count.

| Source | What is available | Candidate example | Remaining checks |
| --- | --- | --- | --- |
| Pokémon Showdown / Smogon | Public Gen 5-style animated sprite GIF directory | `https://play.pokemonshowdown.com/sprites/gen5ani/bulbasaur.gif`; also screen Pikachu, Eevee, Charmander and Squirtle | Inspect dimensions, actual frame counts, transparency, timing and artwork rights. The directory lists GIF files but does not state these properties. [S1] |
| PokéAPI sprites | Sprite catalog and repository with animated collections, including Generation V and Showdown variants | Bulbasaur #1, repository path `sprites/pokemon/versions/generation-v/black-white/animated/1.gif` | Verify actual file metadata and provenance. This may duplicate another source, not provide a separate license. [S2] |
| PMD SpriteCollab | Credited Mystery Dungeon-style sprite sheets and animation data, potentially better suited to walking/idle poses | Search the starter Pokémon and inspect each available animation | Check the individual animation, sheet layout, frame timing, artist credits and non-commercial policy. Do not assume the site's 40×40 portrait size describes animated sprites. [S3] |
| Pokémon Database | Individual animated Black/White pixel sprites | `https://img.pokemondb.net/sprites/black-white/anim/normal/pikachu.gif` | Five actual GIFs were inspected successfully, as detailed below. These are existing animations, not cleared artwork. [S4] |

### What was and was not verified

The Showdown index visibly lists individual GIF assets. PMD SpriteCollab explicitly says to credit artists and not use its assets commercially.

Five Pokémon Database GIFs were fetched into memory and their GIF headers, image descriptors, control blocks and frame delays were parsed without installing dependencies. These are actual GIF image-frame counts, not counts of visually unique poses:

| Character | Logical canvas in pixels | GIF frames | Total cycle duration | Frame delays |
| --- | --- | --- | --- | --- |
| Pikachu | 50×46 | 112 | 5.8 seconds | 50, 100, 150 ms |
| Bulbasaur | 37×38 | 99 | 5.1 seconds | 50, 100, 150 ms |
| Charmander | 42×42 | 107 | 5.4 seconds | 50, 100 ms |
| Squirtle | 39×43 | 51 | 3.85 seconds | 50, 100, 150, 350, 800 ms |
| Eevee | 49×47 | 125 | 6.7 seconds | 50, 100, 150 ms |

The latter four include a Netscape loop field of zero, indicating indefinite repetition in a compatible GIF player. This says nothing about WidgetKit playback support. Their URLs use the same directory as Pikachu with the lowercase character name. No files were imported into the app or repository.

These are ready-made multi-frame pixel animations, although no approximately ten-frame example was confirmed. Squirtle is the shortest inspected candidate by frame count. Inspect actual composited frames before deciding whether its motion reads as an idle loop at Island size.

Direct binary inspection of five Showdown examples returned HTTP 403 in this environment. Pillow was unavailable; a dependency-free GIF metadata probe was attempted but could not receive the files. The GitHub snapshot helper also failed with “Unrecognized GitHub snapshot helper command” when acquiring `smogon/sprites`; no repository snapshot was acquired and no repository code was executed. Do not represent repository licensing as independently cleared. Public directory/catalog URLs can be revisited in a browser, and immutable source/asset revisions must be recorded before implementation imports any files.

### Asset acquisition and processing, after feasibility and rights approval

1. Choose a starter set of three to five creatures, not a full Pokédex. Pikachu, Eevee and Bulbasaur are initial candidates, subject to readability and rights.
2. For each source, record URL, revision where applicable, download hash, character/form, contributor and exact license/permission evidence in an asset manifest.
3. Inspect actual frame count, logical canvas size, per-frame delays, total loop duration, transparency and disposal behavior. Composite GIF subframes correctly before extraction; optimized GIFs often contain delta rectangles rather than complete independent frames.
4. Produce complete PNG frames with a stable shared bounding box and baseline across the loop. Avoid per-frame cropping that makes the creature jitter. Use nearest-neighbor rendering and avoid blurry filtering.
5. Keep original timing unless consciously adapting it after inspection. Do not turn an arbitrary animation into ten uniformly timed frames just because ten was mentioned in the brief.
6. Prepare separately sized assets for minimal/compact and expanded/Lock Screen presentations, including correct @2x/@3x scale metadata. Check legibility against the system's black Island background. Reject art that becomes unreadable when reduced.
7. Validate asset IDs, frame availability, timing, size/memory limits and provenance during the build. Bundle the same approved catalog into both targets. No runtime downloads or arbitrary user GIF imports in the first version.

### Pokémon rights gate

Public availability does not license Pokémon characters, names or artwork for app distribution. A repository's software license is not a license to its sprites. Community artist permission and attribution also do not automatically clear underlying Pokémon IP.

The Pokémon Company's legal page explicitly says its fan-art terms do not grant use beyond personal, noncommercial home use. PMD SpriteCollab's visible non-commercial/credit policy is an additional constraint, not commercial clearance. Free distribution is not automatically authorized either. [S3, L1]

Use original placeholder artwork for engineering. Before bundling Pokémon assets for TestFlight or public distribution, obtain an applicable rights grant or legal clearance for the exact assets and intended distribution. If this cannot be obtained, ask whether original, non-Pokémon pixel creatures are acceptable. Do not rename recognizable Pokémon and assume that fixes the rights issue. App branding must not suggest Nintendo or Pokémon affiliation. [A5, L1]

## 4. App interface

Keep one primary screen:

- A compact title and one-line explanation of temporary Island/Lock Screen display.
- A grid of animation cards, each with a pixel preview, character/animation name and accessible selection label.
- Tap a card to start the first activity or update the existing one. Show pending state during the operation, then mark the actual active selection only after success.
- A small activity status and “Remove companion” action while active. These are necessary lifecycle controls, not a separate management dashboard.
- Inline permission, unsupported-presentation and start/update failure messages. Preserve the preview and allow retry. Guide users to app Settings when Live Activities are disabled.
- A concise first-use explanation that the system controls visibility and activities expire. Reopening after expiry permits a new user-initiated start; never silently restart indefinitely.

No accounts, pet simulation, feeding, battles, purchases, sharing, notifications, web renderer or backend. Do not add a focus timer or other ongoing-task product without user approval.

Animated previews run only while visible in the foreground app. Use SwiftUI and a small native frame player driven from a monotonic time source, respecting the asset's frame durations. Pause offscreen/background previews and show a representative static frame for Reduce Motion. This foreground player is independent of the Island feasibility result and must never be presented as evidence that Island animation works.

Reuse `MoirasiaUI` in native contexts. Use native minimum touch targets of at least 44pt, semantic Dynamic Type and VoiceOver labels. The system owns Island chrome; do not recreate shared window chrome there or force a custom background that the system does not support.

## 5. Minimal architecture

Proposed app-owned organization:

```text
apps/standalone/Pixim/
  IslandCompanion.xcodeproj
  App/
    CatalogView.swift
    CompanionActivityController.swift
    PreviewAnimationView.swift
  Shared/
    CompanionAttributes.swift
    AnimationCatalog.swift
    Assets/
    asset-provenance.json
  LiveActivity/
    CompanionLiveActivity.swift
  Tests/
  UITests/
```

Use a local Swift package reference to `packages/ui-swift`. Do not add ActivityKit or animation playback to the shared UI package; they are app behavior.

- `CompanionAttributes` stores immutable session identity/start information. Its Codable/Hashable content state carries the selected animation ID and a selection revision if required by the proven rendering technique. Selection must be mutable content, not an immutable attribute requiring a new activity every time.
- `AnimationCatalog` maps stable IDs to approved local frame assets, timing, display names and provenance. Reject unknown IDs at boundaries and supply a safe placeholder for old activities referring to retired assets.
- `CompanionActivityController` serializes start/update/end actions, checks authorization and reconciles with `Activity<CompanionAttributes>.activities` on launch/foreground. Keep at most one activity belonging to this app. Observe lifecycle/authorization changes and recover from dismissal, expiry and request failures.
- Rapid taps use the latest user selection without producing duplicate activities or racing updates. If an update fails, the UI must distinguish the desired selection from the last successful active state.
- Store the preferred catalog selection locally. The activity's content state is the extension's display input. Since assets are bundled and no shared mutable files are needed, do not add an App Group unless the proven implementation actually requires it.
- The extension provides all system presentations, uses local assets and opens the catalog when tapped. It does not run the foreground preview player or own a network service.

## 6. Implementation sequence

1. **Feasibility prototype.** Original test art, real ActivityKit activity, all required presentations, short transitions and continuous-playback experiments. Deliver evidence and a go/no-go decision.
2. **Rights and asset shortlist.** Inspect three to five candidate loops. Record actual frame counts/timing and rights evidence. Import no Pokémon assets into a distributable target until cleared.
3. **Native project and catalog.** Add the standalone app/extension, shared UI dependency, local catalog and animation previews. No Moirasia integration.
4. **Selection lifecycle.** Start/update/end, permission/error states, launch reconciliation and rapid-selection protection. Add only the Island rendering technique proven in phase 0, or the explicitly approved static fallback.
5. **Device verification.** Test lifecycle, actual system presentation, accessibility, animation continuity and power use. Fix clipping and illegible assets before increasing the catalog.
6. **Distribution review.** Confirm rights, intended-purpose suitability and honest descriptions of duration/animation limits. Signing, provisioning, TestFlight and App Store submission require separate user authorization.

## 7. Verification and acceptance

Automated tests:

- Catalog integrity, frame durations, bounds, asset scale metadata and complete provenance records.
- Frame selection at timing boundaries, loop wrap, nonuniform delays and reduced-motion behavior in foreground previews.
- Controller start/update/end success and errors, disabled authorization, rapid taps, existing activity recovery, system dismissal and expiry reconciliation.
- App UI selection/status, retry/removal, VoiceOver names, Dynamic Type and 44pt touch targets.
- SwiftUI previews/snapshots for compact, minimal, expanded and Lock Screen layouts. These do not prove actual Island behavior.

Real-device matrix:

- Dynamic Island iPhone at the minimum supported iOS and latest available release. A non-Island iPhone for the Lock Screen fallback.
- First start, change selection, remove, relaunch, disabled Live Activities and permission changes.
- Competing Live Activity, compact/minimal switch, long-press expansion, foreground/background, suspension, device lock/unlock and Always-On reduced luminance.
- Reduce Motion, increased text size, dark/light Lock Screen context and Low Power Mode. Assess power without fabricated background execution.
- Long-duration run approaching the eight-hour limit, user dismissal and reconnection to the catalog afterward. No automatic permanent restart.

The requested product is accepted only when a chosen creature actually animates in the real Dynamic Island under the agreed background conditions, selection reliably changes that creature, and required system/permission/expiry behavior is honest. If only static rendering is feasible, acceptance requires the user's explicit revised scope. Rights clearance is a separate distribution gate, not something a successful technical demo resolves.

## Sources

Apple primary sources:

- [A1] [Displaying live data with Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities). Architecture, presentations, lifecycle, eight/twelve-hour distinction, image constraints and network sandbox.
- [A2] [Live Activities HIG](https://developer.apple.com/design/human-interface-guidelines/live-activities). Defined-duration guidance, system presentation, black Island background, two-second animation limit and reduced-luminance behavior.
- [A3] [ActivityAuthorizationInfo.areActivitiesEnabled](https://developer.apple.com/documentation/activitykit/activityauthorizationinfo/areactivitiesenabled). Authorization check.
- [A4] [Animating data updates in widgets and Live Activities](https://developer.apple.com/documentation/widgetkit/animating-data-updates-in-widgets-and-live-activities). Update-driven transitions and the iOS 16 animation differences.
- [A5] [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/). Review intended-purpose/minimum-functionality requirements and intellectual property, especially sections 2.5.1, 4.2 and 5.2.
- [A6] [Starting and updating Live Activities with ActivityKit push notifications](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications). Remote update model and throttling constraints.

Asset publishers and rights holder:

- [S1] [Showdown animated GIF directory](https://play.pokemonshowdown.com/sprites/gen5ani/) and [Smogon sprite repository](https://github.com/smogon/sprites). Repository rights terms still require independent verification before acquisition.
- [S2] [PokéAPI Sprite Finder](https://pokeapi.github.io/sprites/) and [sprite repository](https://github.com/PokeAPI/sprites). Collection discovery, not a redistribution license.
- [S3] [PMD SpriteCollab](https://sprites.pmdcollab.org/) and its [About/credits policy](https://sprites.pmdcollab.org/#/About). Visible credit and non-commercial restrictions; inspect exact asset terms before use.
- [S4] [Pokémon Database Pikachu sprite catalog](https://pokemondb.net/sprites/pikachu) and [animated GIF](https://img.pokemondb.net/sprites/black-white/anim/normal/pikachu.gif). The direct binary files supplied the measured metadata above; their distribution rights remain unresolved.
- [L1] [Pokémon legal information](https://www.pokemon.com/us/legal/information). Rights-holder statement about fan art and personal, noncommercial home use.
- [C1] [SpritePals product site](https://spritepals.app/). First-party marketing of an analogous product, not implementation or continuous-playback evidence.
