# Progressive Orbis scanning

Orbis uses the progressive scanner and persistent exact indexes by default. Set `ORBIS_DISABLE_INCREMENTAL_SCAN=1` to force persistent full progressive refreshes, or `ORBIS_LEGACY_SCAN=1` to bypass persistence and FSEvents with the Stage 5 scanner. `ORBIS_PROGRESSIVE_SCAN` is no longer read.

The progressive scanner keeps its construction database private to the worker and performs exact read-only filesystem traversal. It does not query Spotlight or maintain a live watcher. After a completed scan, the controller writes the root's exact direct-child totals to a private, volume-identity-bound cache. The next rescan or app launch applies that cache before traversal starts, so folders such as `Users` and `Applications` retain one pinned provisional value until their new exact totals are ready. Cache values are construction-only and never enter published exact totals. A first-ever scan with no cache says `Estimating…` rather than presenting growing confirmed bytes as an estimate. Exact traversal reads directory entries in pages of 32, limits Node metadata reads to four operations by default, and keeps at most eight directory handles open. On macOS the optional Rust/N-API addon supplies `getattrlistbulk` pages for the same exact traversal; failed or unavailable native calls fall back to bounded Node metadata reads. Normal work is breadth-first. Focused work gets three turns before one normal turn, so opening a folder makes its known subtree responsive without stopping the rest of the scan.

The estimate cache is an app-private `0600` file. It contains the canonical target, volume identity, capture time, and up to 400 direct-child names and byte totals; it expires after 30 days and is never sent to the renderer as a path-bearing payload. The worker sends an initial path-free preview after the first root page, including a root page made entirely of skipped or unreadable entries. Later previews are limited to 10 Hz. A preview contains opaque node IDs, display names, changing aggregate values, at most 400 chart segments, and at most 100 largest items. The chart builder keeps the largest visible directories and files, folds files below a 1% parent-size share or over-limit siblings into a single `Other` segment, and includes its represented item count without changing byte totals. Filesystem paths stay in the worker and the main process's private index.

The construction database updates ancestor sizes, descendant counts, unreadable counts, and node states after every page. Nodes expose confirmed bytes separately from an estimate-aware display size and report `estimated`, `partial`, or `exact` accuracy. Hard-link ownership uses the relative path as a deterministic tie-breaker, so focus order cannot change the final allocated-byte total or representative. Before publication, the scanner rejects queued work, removes its scheduling, hard-link, and estimate tables, commits, closes the database, and atomically renames it.

## Persistent refreshes

Completed progressive indexes use a persistent schema containing every accepted regular-file alias, lexical hard-link owners, and direct directory observations. `indexes/current.json` identifies one immutable `index-<uuid>.sqlite` publication and stores the target device/inode, schema and policy versions, revision, FSEvents UUID, and decimal-string cursor. Startup trusts only that manifest and its validated database. Recognized partial files and unreferenced index candidates are removed; unrelated files are never touched. Normal shutdown preserves the manifest, active index, and estimate cache.

On macOS, the worker replays bounded FSEvents history from the published cursor. Events only select dirty paths. The worker clones the active index, recursively traverses conservative scopes with the same exact progressive scanner, replaces those subtrees in one SQLite transaction, reconstructs global hard-link ownership from all aliases, repairs aggregates bottom-up, and validates foreign keys, aggregate equations, and owner allocation. A changed target identity, journal UUID mismatch, dropped or wrapped events, root or mount changes, malformed history, ambiguous rename, timeout, event limit, or candidate validation failure triggers a full progressive scan. `MustScanSubDirs` expands the exact reconciliation scope without deriving byte deltas from events.

A full refresh captures a pre-traversal journal checkpoint and replays through a post-scan fence. If bounded subtree reconciliation closes that window, the applied fence is published with the candidate. If FSEvents is unavailable before traversal, the exact full index may publish without a cursor and later refreshes remain full. If a captured window is still untrustworthy after one bounded full retry, the candidate is discarded and the previous publication remains authoritative. A batch with no relevant events atomically advances only `current.json` and retains the same index file.

Publication fsyncs and renames the candidate, validates it read-only, then fsyncs and renames `current.json`; the manifest rename is the commit point. The cursor never advances beyond the manifest's index. Cancellation, failure, stale base publication, or a stale generation deletes only that run's candidate and leaves the previous index and cursor authoritative. A disconnected target remains displayable from the prior index and reports refresh failure.

During a refresh, the controller keeps the previous completed `DiskIndex` open. Full scans show a provisional snapshot only after a preview arrives; incremental candidates do not expose geometry before commit. The new database replaces the old one only after it opens and validates successfully. A stale generation cannot complete a pending reveal or replace the active index.

Snapshot version 3 marks provisional data with `committed: false` and published data with `committed: true`. Nodes, chart segments, and volumes carry `sizeAccuracy`; this prevents an estimated or partial byte count from being presented as exact. Directory nodes report `queued`, `scanning`, `complete`, or `unreadable`. Queued and scanning chart segments use crossed hatching and remain drillable even when their known size is zero. The preload bridge rejects older or structurally incomplete snapshots.

## Rollout checks

Run matched benchmark samples with `--scanner progressive` and `--scanner legacy` at metadata concurrency 4. The benchmark records scanner mode, first-preview latency and p95, scan/controller timings, payload size, RSS, total scan time, native bulk-entry count, and Node fallback-entry count.

Before removing the rollback variable, check the following:

- Progressive and legacy fixture indexes match after opaque IDs are normalized by relative path.
- Injected focus requests do not change rows, totals, hard-link ownership, or final allocated bytes.
- Cached first-preview p95 is at most 250 ms on each baseline fixture.
- Progressive median full-scan time is no more than 10 percent slower than legacy.
- Preview payloads stay within 400 chart segments and 100 largest items.
- Directory handles, metadata operations, queue work, RSS, cancellation cleanup, and external-volume scans stay within their limits.
- No scan reports an `EMFILE` failure.
- Native and Node fallback counts are explicit in the benchmark report; a native-path failure must not change the exact fixture totals.

Useful controls during rollout are `ORBIS_SCAN_DIAGNOSTICS=1`, `ORBIS_DISABLE_BULK_METADATA=1`, `ORBIS_DISABLE_INCREMENTAL_SCAN=1`, and `ORBIS_LEGACY_SCAN=1`. `ORBIS_DISABLE_BULK_METADATA=1` affects only directory metadata acceleration and does not disable FSEvents. Native build and staging are wired through `apps/Orbis/native:mac`, `pnpm features:stage`, and the `features/orbis/native` packaged resource.

The checked-in report in `docs/benchmarks/orbis-progressive-rollout.md` records both quick and baseline matched runs. The full-scan ≤10% gate is currently unresolved, so keep `ORBIS_LEGACY_SCAN=1` until a production-like performance decision is made.
