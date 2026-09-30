# Implementation plan: share Semiquaver's music-library browse projection

**Status:** Final implementation plan. No implementation is included in this task.

## Goal

Replace the duplicated iOS and macOS music-library browse projection with one pure, in-process shared implementation compiled into both existing app targets. Keep each platform's scanning, cache, persistence, and observable state in its current `AppMusicLibrary`. Preserve current browse output, including the different album subtitle shown for `Unknown Artist` on each platform.

The projection implementation owns the common track ordering, artist and album grouping, group-track lookup maps, stable summary IDs, artwork selection, and song-count text. Its interface lets either platform obtain the complete derived browse state without learning those rules individually.

## Decisions

These are the selected design choices for the refactor.

1. **One shared projection namespace, no new target or package.** Add `MusicLibraryProjection` as a pure namespace in a source file compiled into both existing app targets. Keep the iOS and macOS `AppMusicLibrary` classes as separate owners of scanning, cache state, persistence, and `@Published` properties. They call the shared projection implementation directly. Do not add a new Swift module, package, target, or injected adapter seam.
2. **Keep the platform display difference.** iOS omits `Unknown Artist` from an album subtitle; macOS includes it. Preserve both existing outputs and represent that choice explicitly with a small `AlbumArtistSubtitlePolicy` value passed to the projection module. Do not infer policy from `#if os(...)` inside the shared module.
3. **Preserve identity and ordering.** Keep every existing artist and album ID, the album lookup key format, localized case-insensitive sorting, song-count wording, and artwork selection behavior. Do not change view navigation or saved playlist identities.
4. **Test the actual seam.** Test the pure module directly, then test that both platform library modules apply its result. Build and run both shared Xcode schemes so the new source is verified in both targets.

## Current architecture and evidence

Both targets define a class named `AppMusicLibrary`, compiled into separate products.

- iOS `AppMusicLibrary.rebuildDerivedCollections()` in `apps/standalone/Semiquaver/Semiquaver/Storage/AppMusicLibrary.swift:40-81` sorts songs, groups tracks by artist and album, creates `AudioGroupSummary` values, and builds the lookup maps. The class also sorts scan output in its incremental and full scans at lines 204 and 254. Its sort and song-count helpers are at lines 364-386.
- macOS `AppMusicLibrary.rebuild()` in `apps/standalone/Semiquaver/Semiquaver-macOS/MacMusicLibrary.swift:66-81` repeats the grouping, sorting, IDs, maps, and summary creation. The macOS scan caller sorts visible tracks at line 44; its duplicate sorting and count helpers are at lines 148-152.
- Both targets use `AudioTrack`, `AudioGroupSummary`, and `AudioMetadataFallbacks` from `apps/standalone/Semiquaver/Semiquaver/Models/MediaModels.swift`. `AudioTrack` and `AudioGroupSummary` are `Sendable` values.
- iOS album browsing has two live layouts. `SemiquaverApp` launches `ContentView`; its compact layout presents `Views/Tabs/AudioTabView.swift`, while its regular-width layout uses `IOSExpandedShell` in `ContentView.swift`. The album lookup strips the `album::` prefix twice in `AudioTabView.swift` and once in `ContentView.swift`; `Semiquaver-macOS/MacViews.swift` does this once. `LibrarySearch.groups` also uses these maps when filtering. Both iOS layouts display the summary subtitle, but only compact `AudioTabView` derives `AlbumDetailView.artistName` from its first component. For the fallback artist, that subtitle is `1 song`, and `components(separatedBy: " • ").first` returns `1 song`, not `Unknown Artist`. An artist name containing ` • ` is also truncated at its first occurrence by the same parser. These are existing compact-detail bugs; keep the subtitle and view code unchanged in this refactor. The regular-width iOS layout and macOS derive album playback context from the first mapped track.
- The current tests cover scans and deletion, cache and playlist persistence, library search, queue cleanup, and presentation. They do not assert generated artist or album summaries or their lookup maps. Relevant tests are `Semiquaver-iOSTests/IOSModelTests.swift:116-176`, `Semiquaver-macOSTests/MacLibraryTests.swift:35-71`, and `Semiquaver-macOSTests/SharedPresentationTests.swift`.
- `Semiquaver.xcodeproj` uses a synchronized source folder for the iOS target, but the macOS target manually includes shared sources through the `Shared Sources` group and its Sources phase (`project.pbxproj:116-127, 282-292`). The shared schemes are `Semiquaver` and `Semiquaver-macOS`; each includes its corresponding test target.

The browse derivation is duplicated in the two library classes, while their scanning and persistence behavior is genuinely platform-specific. Sharing only the repeated derivation removes copied grouping, summary, and sorting rules. Removing either `AppMusicLibrary` would remove real platform-specific behavior; removing the shared projection would put the repeated rules back in both callers.

## Projection implementation

Add `apps/standalone/Semiquaver/Semiquaver/Models/MusicLibraryProjection.swift`.

Keep the implementation independent of AVFoundation, Combine, SwiftUI, file access, and caches. Import Foundation for localized string ordering, accept existing `AudioTrack` values, and return immutable derived values. Match the project's default `MainActor` isolation settings by marking pure entry points `nonisolated`, following the existing helper pattern. Make the result and policy values `Sendable`.

Use an internal `enum MusicLibraryProjection` as the namespace. Its two operations are the two existing duplicated behaviors: one replaces both library rebuild methods, and the other replaces the two iOS scan sorts and the macOS visible-track sort.

- `nonisolated static func build(tracks: [AudioTrack], albumArtistSubtitlePolicy: AlbumArtistSubtitlePolicy) -> MusicBrowseProjection`
- `nonisolated static func sortedTracks(_ tracks: [AudioTrack]) -> [AudioTrack]`

`build` returns the complete browse projection. `sortedTracks` returns a new array in the title-then-artist order without mutating its input.

The projection value contains:

- `songs`, sorted by localized case-insensitive title, then artist;
- `artists`, sorted by localized case-insensitive title;
- `albums`, sorted by localized case-insensitive title;
- `tracksByArtist`, with each value sorted by the shared track ordering;
- `tracksByAlbumID`, with each value sorted by the shared track ordering.

Use an explicit `AlbumArtistSubtitlePolicy` with two cases matching current behavior, one that omits the fallback artist and one that includes it. Require the caller to pass the policy. Do not provide a default that could silently make both targets use the same output.

### Compatibility rules

Treat these as observable behavior, not implementation details.

- Artist IDs remain `artist::<artist>`.
- Album summary IDs remain `album::<artist>::<album>`. Album lookup-map keys remain `<artist>::<album>`. The UI strips `album::` at four lookup sites: twice in `Views/Tabs/AudioTabView.swift`, once in `ContentView.swift`, and once in macOS `MacViews.swift`. `LibrarySearch.groups` also depends on the group-track maps.
- Group by the raw artist and album strings. Do not trim, normalize, or case-fold metadata, and do not drop empty values. iOS scanning cleans empty metadata; macOS scanning can pass empty strings through, so the projection must preserve the values each caller supplies. Case-insensitive comparison applies only to sorting.
- Track order remains localized case-insensitive title, then localized case-insensitive artist. Artist and album summaries remain sorted by title only. Do not add a new tie-breaker in this refactor.
- Each artist and album group keeps the same tracks and the same per-group order.
- Artist and album artwork continues to come from the first track in the original grouped input. Compute summary artwork before sorting lookup-map values; sorting those values must not change the selected artwork.
- Song counts keep the current singular and plural strings, `1 song` and `<count> songs`.
- Preserve the exact album subtitle format and separator. iOS emits `<artist> • <count>` except when the artist exactly equals `AudioMetadataFallbacks.artist`, when it emits only `<count>`. macOS always emits `<artist> • <count>`, including `Unknown Artist`. Do not change the existing compact-view parsing behavior noted above.
- Do not change `AudioGroupSummary`, the serialized library cache, playlist storage, track IDs, or view code.

The current composite album key can merge distinct pairs. For example, artist `A` with album `B::C` and artist `A::B` with album `C` both produce `A::B::C`. Today they become one group under that lookup key and one summary ID, `album::A::B::C`; the first input track supplies its title, artist subtitle, and artwork, while the map value is sorted. Preserve and regression-test this behavior. Fixing the collision requires changing the key representation and coordinating summary IDs with all four UI lookup sites, so it remains outside this refactor.

## Implementation steps

### 1. Add projection tests first

Create `apps/standalone/Semiquaver/Semiquaver-macOSTests/MusicLibraryProjectionTests.swift` with `final class MusicLibraryProjectionTests: XCTestCase`. The macOS test target already compiles the shared `Semiquaver` module and its test folder is synchronized, so the test file needs no manual test-source entry in the project file.

Write tests against `MusicLibraryProjection`'s interface, not its private grouping helpers. Start with cases that fail to compile or fail assertions until the projection exists:

1. Empty tracks produce empty songs, summaries, and both maps.
2. `sortedTracks`, `songs`, and every artist- and album-map value preserve all input tracks and use the current localized case-insensitive title-then-artist order. Include an empty title to prove it is retained, and titles that compare equal ignoring case but have different artists to exercise the artist tie-break. Do not rely on order when both title and artist compare equal.
3. Artist groups retain exact input strings, including case-distinct and empty artist names. Assert that `Artist` and `artist` remain separate map keys and IDs, and that an empty artist remains under key `""` with ID `artist::`. Check `kind: .artist`, title ordering, counts, and map contents. Give a group's first input track different artwork from the track that sorts first; the summary must keep the first input artwork while the map value is sorted.
4. Albums with the same title from different artists remain separate groups with the existing summary IDs and lookup keys. Case-distinct album names for the same artist remain separate too. Check `kind: .album`, the album map contents, including the exact empty-album key `::` and summary ID `album::::`, and use input order that differs from sort order to prove the summary keeps the first input track's artwork.
5. Summary IDs and lookup keys retain their different string forms: `album::<artist>::<album>` versus `<artist>::<album>`.
6. One-track and multi-track artist and album groups use the exact existing count strings, `1 song` and `<count> songs`.
7. Subtitle tests assert the exact strings and separator. The iOS policy omits only an artist exactly equal to `AudioMetadataFallbacks.artist`; the macOS policy includes it. Both policies include an ordinary artist, and a case-different near-match such as `unknown artist` is not treated as the fallback. An ordinary artist containing ` • ` is emitted without escaping before the count. An empty artist remains empty and produces ` • 1 song`; it is not replaced with the fallback.
8. Assert artist and album summary ordering for distinct ASCII titles. The comparator uses localized case-insensitive title ordering only; do not assert an order between equal titles.
9. Preserve the delimiter collision described above: assert both pairs share one album map entry and summary ID, the map value uses track order, and the first input track still supplies summary title, subtitle artist, and artwork.

Use distinct ASCII titles for ordering assertions so the expected order does not depend on locale-specific accent handling. Include empty artist and album strings in the raw-grouping cases; do not normalize or discard them.

### 2. Implement the pure projection module

In `MusicLibraryProjection.swift`:

1. Add the internal `AlbumArtistSubtitlePolicy` enum and immutable `MusicBrowseProjection` result value. Give the policy two explicit cases, `.omitFallbackArtist` and `.includeArtist`.
2. Implement the shared track ordering once in `sortedTracks`. Keep the current comparison sequence exactly: localized case-insensitive title first, artist only when titles compare equal.
3. Implement `build` from tracks. Group by the raw artist string and by the existing raw artist-plus-album key. Create the existing `AudioGroupSummary` values, keep summary artwork from the first input track, build map values sorted with `sortedTracks`, and sort summary arrays by localized case-insensitive title only.
4. Apply the explicit policy only when formatting album summaries. Preserve the exact ` • ` separator and existing artist-before-count order; leave all other output independent of platform.
5. Keep the implementation pure. Do not trim or normalize input metadata, mutate the input array, read environment state, inspect the current OS, or create framework objects.

Run only `MusicLibraryProjectionTests` through the `Semiquaver-macOS` scheme before rewiring either library class:

```sh
xcodebuild -project Semiquaver.xcodeproj \
  -scheme Semiquaver-macOS \
  -configuration Debug \
  -destination 'platform=macOS' \
  -derivedDataPath /tmp/Semiquaver-plan-projection \
  -only-testing:Semiquaver-macOSTests/MusicLibraryProjectionTests \
  test
```

This isolates failures in the projection implementation; the full macOS test suite runs after both callers are wired.

### 3. Wire the macOS music library

In `Semiquaver-macOS/MacMusicLibrary.swift`:

1. Replace the body of `rebuild()` with one call to `MusicLibraryProjection` using the include-artist subtitle policy.
2. Assign all five existing published browse values from the returned projection. Keep `tracks` and its `didSet` behavior intact.
3. Replace the local scan-output sort at line 44 with the shared track-ordering operation.
4. Delete `MacMusicLibrary.sortTracks` and `MacMusicLibrary.songCount` after replacing their rebuild and scan call sites. Leave scanning, multi-root filtering, cache persistence, source removal, track removal, and error behavior unchanged.

Extend the existing multi-root scan test. Its generated `silentWAV()` files have no metadata, so their titles are `One` and `Two`, artist is `Unknown Artist`, album is `Unknown Album`, and artwork is nil. After scanning both roots, assert sorted `tracks` and `songs` titles `["One", "Two"]`, the single artist summary (ID `artist::Unknown Artist`, title `Unknown Artist`, subtitle `2 songs`, nil artwork), the single album summary (ID `album::Unknown Artist::Unknown Album`, title `Unknown Album`, subtitle `Unknown Artist • 2 songs`, nil artwork), `tracksByArtist["Unknown Artist"]`, and `tracksByAlbumID["Unknown Artist::Unknown Album"]` each holding `One`, `Two` in that order. After scanning only the first available root, assert the songs and both map values shrink to `One` and both summary counts become singular. Keep the existing source-availability assertions.

### 4. Wire the iOS music library

In `Semiquaver/Storage/AppMusicLibrary.swift`:

1. Replace `rebuildDerivedCollections()` with one call to `MusicLibraryProjection` using the omit-fallback-artist policy.
2. Assign the existing published songs, artists, albums, and lookup maps from the result. Keep the tracks property, `didSet`, loading states, and cache behavior unchanged.
3. Replace the incremental-scan and full-scan sort calls at lines 204 and 254 with the shared ordering operation. This keeps serialized cache order and playlist input order stable while removing the second comparator implementation.
4. Delete the old grouping and summary body in `rebuildDerivedCollections`, plus `sortTracks`, `sortTitles`, and `songCountLabel`. The two scan-sort call sites and all projection uses are replaced in the preceding steps, and grep confirms these private helpers have no other callers. Keep metadata extraction, scanning, cache validation, and track-list equality behavior local.

Extend `testReloadFromScansChosenFolderAndClearsOnNil`. Its `silentWAV()` fixture yields title `One`, artist `Unknown Artist`, album `Unknown Album`, and nil artwork. After scanning it, assert songs, the artist summary (ID `artist::Unknown Artist`, title `Unknown Artist`, subtitle `1 song`, nil artwork), the album summary (ID `album::Unknown Artist::Unknown Album`, title `Unknown Album`, subtitle `1 song`, nil artwork), `tracksByArtist["Unknown Artist"]`, and `tracksByAlbumID["Unknown Artist::Unknown Album"]` each holding `One`. Then call `reload(from: nil)` while the library is populated and assert tracks, songs, summaries, and both maps are empty. Call `reload(from: folder, force: true)` to restore `currentFolderURL`, then retain the existing deleted-file rescan and empty-library assertions.

### 5. Add the shared file to the macOS target

Update `Semiquaver.xcodeproj/project.pbxproj`:

1. Add a `PBXFileReference` for `Semiquaver/Models/MusicLibraryProjection.swift` and a corresponding `PBXBuildFile`.
2. Add the file to the existing `Shared Sources` group.
3. Add its build-file reference to the `Semiquaver-macOS` Sources phase.
4. Do not add a duplicate explicit entry to the iOS Sources phase. The new file is under the iOS target's synchronized `Semiquaver` source folder and is discovered there automatically.
5. Use unique project object IDs. From the Semiquaver repository root, run `plutil -lint Semiquaver.xcodeproj/project.pbxproj` and require `OK` before building.

The macOS test target imports the app module with `@testable import Semiquaver`; its synchronized test folder includes the new test file automatically. Do not add a new target or change shared-scheme membership.

### 6. Review and verify the integration

Review the final diff for unintended changes to:

- iOS and macOS scan or cache behavior;
- `tracks` ordering, playlist search, or cleanup behavior;
- album summary IDs and lookup keys consumed by compact and regular iOS layouts and the macOS layout;
- artwork choice, summary order, and subtitle text;
- `AudioTrack`, `AudioGroupSummary`, persistence formats, or UI navigation;
- project source membership or app deployment settings.

No UI redesign, package extraction, adapter seam, dependency, or release-script change is part of this plan.

## Test and validation plan

Run from `apps/standalone/Semiquaver` with separate DerivedData paths so generated files do not mix with existing build artifacts.

1. Run the full macOS test suite through the macOS scheme:

   ```sh
   xcodebuild -project Semiquaver.xcodeproj \
     -scheme Semiquaver-macOS \
     -configuration Debug \
     -destination 'platform=macOS' \
     -derivedDataPath /tmp/Semiquaver-plan-macOS \
     test
   ```

2. Run the iOS test suite, including the new integration assertions, through the iOS simulator scheme:

   ```sh
   xcodebuild -project Semiquaver.xcodeproj \
     -scheme Semiquaver \
     -configuration Debug \
     -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' \
     -derivedDataPath /tmp/Semiquaver-plan-iOS \
     CODE_SIGNING_ALLOWED=NO \
     test
   ```

3. Inspect the test results and confirm both schemes compiled `MusicLibraryProjection.swift`. The iOS target gets it through its synchronized source folder; the macOS target gets it through the manually maintained shared-source list.
4. From the Semiquaver repository root, run `git diff --check` and inspect its full diff. The app has its own nested Git repository; keep implementation changes in that repository and do not inspect or alter unrelated parent-repository changes.

The specified iPhone 17 / iOS 26.5 destination is available in the current environment (Xcode 27.0; confirmed by `xcodebuild -showdestinations` and `xcrun simctl list devices available`). Use that destination, with no substitution. The project minimum is iOS 26.4, but no fallback destination is needed here. No browser test, release packaging, Swift package change, or Moirasia root test run is relevant to this pure Swift projection refactor.

## Acceptance criteria

- Both platform library modules use the same implementation for track ordering, browse grouping, summary construction, and lookup-map generation.
- Each platform retains its existing album subtitle for `Unknown Artist` through an explicit policy argument.
- Track order, artist and album IDs, album map keys, title ordering, counts, artwork selection, and lookup behavior remain unchanged.
- Platform scanning, caching, persistence, `@Published` property names, loading/error state, view code, and playlist behavior remain platform-owned and unchanged.
- The projection implementation has no I/O or framework dependencies beyond the existing domain types and Foundation string ordering.
- Pure module tests cover its full observable output. iOS and macOS integration tests verify each caller's policy and wiring.
- Both shared schemes build and pass their tests. The Semiquaver repository diff passes `git diff --check` and contains only the planned source, test, and project-file changes.
