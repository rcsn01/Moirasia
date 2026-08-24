# Orbis scan optimization plan

This plan turns the SquirrelDisk and PDU research into independently testable implementation stages. Complete and measure each stage before starting the next one. Do not combine stages in one change.

Supporting research: [`docs/research/squirreldisk-orbis-optimizations.md`](docs/research/squirreldisk-orbis-optimizations.md)

## Goals

- Reduce full-scan time without changing reported allocated sizes.
- Keep memory bounded on startup-volume scans.
- Keep the UI responsive and preserve cancellation.
- Continue skipping symlinks, nested mounts, unreadable entries, and duplicate hard links.
- Keep partial indexes private to the worker until atomic publication.
- Preserve the previous completed index during rescans and cancellation.

## Non-goals for the initial stages

- Do not copy SquirrelDisk's full in-memory tree or whole-result JSON transfer.
- Do not replace allocated-block accounting with apparent file length.
- Do not weaken mount detection or hard-link deduplication.
- Do not persist indexes across normal application shutdown yet.
- Do not introduce a native helper until measurements show Node traversal is still the bottleneck.

## Rules for every stage

1. Capture baseline and post-change measurements with the same fixture and machine state.
2. Keep each stage separately reviewable and reversible.
3. Run the focused Orbis tests before the full verification commands.
4. Do not accept speed improvements that change scan totals or leave partial databases behind.
5. Record results in the measurement table at the end of this document.

---

## Stage 0: build the benchmark and timing baseline

### Purpose

Determine whether traversal, SQLite writes, finalization, or main-process snapshot construction dominates on representative scans. Browser rendering requires a separate Electron measurement.

### Implementation

- [x] Add named timing boundaries for:
  - worker startup;
  - database creation;
  - filesystem traversal and node insertion;
  - directory aggregation;
  - SQLite index creation and metadata writing;
  - database close and atomic rename;
  - controller publication and first snapshot;
  - first chart and largest-items queries.
- [x] Record item, file, directory, skipped, and unreadable counts.
- [x] Record output database size and sampled process memory.
- [x] Keep user-facing progress snapshots compatible. Diagnostics use internal channels and a separate opt-in worker message.
- [x] Add deterministic fixture generators for:
  - a wide tree with many sibling files;
  - a deep directory tree;
  - many tiny files;
  - mixed large and small files;
  - symlinks and duplicate hard links;
  - simulated unreadable and disappearing entries.
- [x] Add a repeatable benchmark command that refuses live targets unless explicitly allowed.
- [ ] Run at least one manual cold-cache and warm-cache startup-volume comparison. Do not automate cache flushing in normal tests.

### Likely files

- `packages/feature-orbis/src/main/scanner.ts`
- `packages/feature-orbis/src/main/database.ts`
- `packages/feature-orbis/src/main/controller.ts`
- `apps/Orbis/tests/scanner.test.ts`
- A new benchmark script under `apps/Orbis/scripts/` or `packages/feature-orbis/scripts/`

### Verification

```sh
pnpm -C apps/Orbis test -- scanner.test.ts
pnpm -C apps/Orbis typecheck
```

### Exit criteria

- [x] The benchmark produces stage timings and throughput in items per second.
- [x] Five-sample fixture runs have a median absolute deviation below 7.1 percent; rerun noisy fixtures when a change is near that spread.
- [x] Baseline measurements are recorded here and in `docs/benchmarks/orbis-stage-0-baseline.md`.
- [x] Production scan results, snapshots, IPC, and progress contracts are unchanged.

---

## Stage 1: remove SQLite autocommit and prepare overhead

### Purpose

Fix the most obvious avoidable database cost before changing traversal behavior.

### Implementation

- [ ] Keep aggregation updates, metadata inserts, and index creation inside an explicit transaction.
- [ ] Prefer one transaction covering construction of the unpublished partial database. A second finalization transaction is acceptable if it benchmarks better or makes error handling clearer.
- [ ] Prepare the node insertion statement once per scan instead of once per node.
- [ ] Prepare and reuse directory update and metadata statements.
- [ ] Finalize statements before closing the database.
- [ ] Preserve rollback and cleanup behavior for cancellation and errors.
- [ ] Keep the `.partial.sqlite` to `.sqlite` rename after commit and database close.
- [ ] Add a test proving a canceled scan leaves neither partial nor published files.
- [ ] Add a test proving a failed finalization cannot replace the active completed index.

### Likely files

- `packages/feature-orbis/src/main/database.ts`
- `packages/feature-orbis/src/main/scanner.ts`
- `apps/Orbis/tests/scanner.test.ts`
- `apps/Orbis/tests/controller.test.ts`

### Verification

```sh
pnpm -C apps/Orbis test -- scanner.test.ts controller.test.ts
pnpm -C apps/Orbis verify
pnpm test -- tests/orbis-feature.test.ts
```

### Exit criteria

- [ ] SQL writes during a scan use explicit transactions and reused statements.
- [ ] Scan totals and database query results match the Stage 0 baseline fixture.
- [ ] Cancellation, failure cleanup, and atomic publication tests pass.
- [ ] Finalization time is recorded. If it does not improve, document why before continuing.

---

## Stage 2: aggregate directory totals during traversal

### Purpose

Remove the full-table JavaScript reconstruction and second recursive aggregation pass.

### Implementation

- [ ] Make each directory traversal return its aggregate result:
  - allocated bytes;
  - direct child count;
  - descendant count;
  - unreadable count.
- [ ] Update a directory row when its subtree finishes.
- [ ] Include the directory's own allocated blocks in its total, matching current behavior.
- [ ] Preserve unreadable-directory accounting.
- [ ] Remove the all-row `SELECT`, node map, child map, and recursive `finalizeDatabase()` walk once equivalence tests pass.
- [ ] Create the `nodes_parent_size` index only after node and directory writes finish.
- [ ] Ensure deep trees do not add a new synchronous recursion limit. Add a deep-tree test.
- [ ] Compare root size, every fixture directory size, descendant counts, and unreadable counts against the old implementation.

### Likely files

- `packages/feature-orbis/src/main/scanner.ts`
- `packages/feature-orbis/src/main/database.ts`
- `apps/Orbis/tests/scanner.test.ts`

### Verification

```sh
pnpm -C apps/Orbis test -- scanner.test.ts
pnpm -C apps/Orbis verify
```

### Exit criteria

- [ ] Finalization no longer loads every node into a JavaScript map.
- [ ] Fixture results are identical to Stage 1.
- [ ] Peak memory and finalization time are recorded.
- [ ] Cancellation still rolls back and removes the partial database.

---

## Stage 3: compact the scan database

### Purpose

Reduce bytes written per item and shrink the parent-size index before adding concurrency.

### Part A: remove repeated absolute paths

- [ ] Store the scan target once in metadata.
- [ ] Store each node's parent and basename, not its complete absolute path.
- [ ] Reconstruct a node path by walking its ancestors when Reveal in Finder is used.
- [ ] Validate reconstructed paths remain inside the scan target.
- [ ] Keep paths out of renderer snapshots.
- [ ] Test root, nested, Unicode, and unusual filename reconstruction.

### Part B: compact internal IDs

- [ ] Replace text database keys such as `n-123` with SQLite integer keys.
- [ ] Keep the renderer contract opaque. Convert IDs at the main-process boundary if string IDs remain useful there.
- [ ] Update parent queries, breadcrumbs, focus, reveal, and chart lookups.
- [ ] Confirm stale or malformed renderer IDs cannot select arbitrary rows.

### Likely files

- `packages/feature-orbis/src/main/database.ts`
- `packages/feature-orbis/src/main/index-store.ts`
- `packages/feature-orbis/src/main/controller.ts`
- `packages/feature-orbis/src/shared/contracts.ts`
- `apps/Orbis/tests/scanner.test.ts`
- `apps/Orbis/tests/controller.test.ts`
- `apps/Orbis/tests/ipc.test.ts`

### Verification

```sh
pnpm -C apps/Orbis test
pnpm -C apps/Orbis verify
pnpm test -- tests/orbis-feature.test.ts
```

### Exit criteria

- [ ] Reveal in Finder resolves the same path as before for every fixture node.
- [ ] Renderer snapshots still contain opaque IDs and no filesystem paths.
- [ ] Database size per indexed item is recorded and lower than Stage 2.
- [ ] Chart, breadcrumbs, largest-items, focus, and reveal tests pass.

---

## Stage 4: remove unnecessary traversal sorting

### Purpose

Avoid the numeric, case-insensitive locale sort performed in every directory.

### Implementation

- [ ] Confirm no product behavior depends on lexical traversal order or stable generated IDs.
- [ ] Add tests that define the actual required ordering at query and renderer boundaries.
- [ ] Remove scan-time sorting and use directory enumeration order, or replace it with a cheaper comparison if deterministic traversal remains required.
- [ ] Keep displayed children ordered by size and name through SQLite.
- [ ] Measure separately on wide directories, where sort cost is easiest to see.

### Likely files

- `packages/feature-orbis/src/main/scanner.ts`
- `packages/feature-orbis/src/main/index-store.ts`
- `apps/Orbis/tests/scanner.test.ts`

### Verification

```sh
pnpm -C apps/Orbis test -- scanner.test.ts renderer.test.tsx
pnpm -C apps/Orbis typecheck
```

### Exit criteria

- [ ] User-visible ordering remains deterministic where required.
- [ ] Internal traversal no longer performs an expensive locale sort without a product reason.
- [ ] Wide-tree benchmark results are recorded.

---

## Stage 5: add bounded parallel metadata traversal

### Purpose

Apply PDU's strongest technique without copying its full in-memory result model.

### Design constraints

- One coordinator owns cancellation, counters, IDs, and database writes.
- Filesystem metadata reads and directory enumeration may run concurrently.
- The number of active and queued tasks must remain bounded.
- Hard-link identity is global across the scan.
- Only the root device is accepted.
- A late task from a canceled generation cannot write or publish data.

### Implementation

- [ ] Introduce a bounded queue or semaphore for metadata operations.
- [ ] Start with configurable concurrency behind an internal option or environment variable.
- [ ] Benchmark concurrency values 1, 4, 8, 16, and 32.
- [ ] Separate concurrent metadata collection from serialized database writes.
- [ ] Keep a shared hard-link identity set with atomic check-and-add semantics at the coordinator.
- [ ] Stop queue admission immediately on cancellation.
- [ ] Drain or safely discard in-flight results before database cleanup.
- [ ] Bound queued records and open directory handles.
- [ ] Preserve nested-mount, symlink, special-file, unreadable, and disappearing-item counts.
- [ ] Add race-focused tests for cancellation, rescan replacement, worker exit, and stale completion.
- [ ] Test hard links placed in different top-level subtrees.

### Likely files

- `packages/feature-orbis/src/main/scanner.ts`
- A new queue helper under `packages/feature-orbis/src/main/`
- `packages/feature-orbis/src/main/scan-worker.ts`
- `apps/Orbis/tests/scanner.test.ts`
- `apps/Orbis/tests/controller.test.ts`

### Verification

```sh
pnpm -C apps/Orbis test
pnpm -C apps/Orbis verify
pnpm test -- tests/orbis-feature.test.ts
pnpm -C apps/Orbis test:smoke
```

### Exit criteria

- [ ] Concurrency is bounded and has a measured default.
- [ ] The default beats concurrency 1 on the target internal SSD without materially hurting external-disk scans.
- [ ] Results match the serial scanner for all correctness fixtures.
- [ ] Cancellation and stale-generation tests pass under repeated runs.
- [ ] No `EMFILE`, unbounded queue growth, or large memory regression appears in stress tests.

---

## Stage 6: tune temporary SQLite durability

### Purpose

Reduce journal and sync work for an unpublished, regenerable index without weakening atomic publication.

### Implementation

- [ ] Benchmark the current `journal_mode=DELETE; synchronous=FULL` configuration.
- [ ] Benchmark `synchronous=NORMAL`.
- [ ] Benchmark an in-memory journal for the partial database.
- [ ] Do not use a mode that allows readers to see an incomplete database.
- [ ] Simulate worker termination during traversal, finalization, close, and publication.
- [ ] Confirm startup or the next scan removes corrupt partial files.
- [ ] Add cleanup for stale generation files left by crashes, limited strictly to the owned indexes directory.
- [ ] Document that deletion is ordinary filesystem deletion, not secure erasure.

### Likely files

- `packages/feature-orbis/src/main/database.ts`
- `packages/feature-orbis/src/main/controller.ts`
- `apps/Orbis/tests/scanner.test.ts`
- `apps/Orbis/tests/controller.test.ts`
- `apps/Orbis/README.md`

### Verification

```sh
pnpm -C apps/Orbis test -- scanner.test.ts controller.test.ts
pnpm -C apps/Orbis verify
```

### Exit criteria

- [ ] The selected pragmas have benchmark evidence.
- [ ] A crash can leave only an owned partial or stale index, which later cleanup removes.
- [ ] A completed index is never opened before commit, close, and rename.
- [ ] Cleanup cannot remove files outside the Orbis indexes directory.

---

## Stage 7: decide on selective indexing

### Purpose

Reduce storage and query costs when users care about large items more than every small file.

This is a product decision. Do not implement it automatically as a hidden optimization.

### Proposed fast mode

- Store every directory.
- Calculate exact totals from every visited file.
- Store only the largest N files per directory.
- Store omitted file count and bytes as an aggregate row.
- Keep the existing complete index as a full mode.

### Implementation checklist

- [ ] Prototype database size and scan-time savings with several N values.
- [ ] Define how aggregated files appear in the sunburst and largest-items list.
- [ ] Prevent Reveal in Finder on aggregate rows.
- [ ] Label incomplete file listings clearly.
- [ ] Keep skipped or unreadable data separate from intentionally aggregated data.
- [ ] Decide whether users select fast or full mode before scanning.
- [ ] Add mode and aggregation fields to the shared snapshot contract only after the product decision.

### Exit criteria

- [ ] A written product decision records whether fast mode is worth the loss of per-file drilldown.
- [ ] If implemented, exact directory totals match full mode.
- [ ] The UI distinguishes indexed, aggregated, and unreadable space.
- [ ] Database and scan-time savings justify the extra product complexity.

---

## Stage 8: evaluate a native scanner

### Purpose

Determine whether a Rust or Swift scanner is justified after the Node implementation has been optimized.

### Entry requirement

Do not start this stage unless Stage 5 measurements show filesystem traversal still dominates and misses the agreed performance target.

### Prototype

- [ ] Define a small versioned protocol for start, progress, cancellation, error, and completion.
- [ ] Compare a Rust Rayon implementation with the optimized Node scanner.
- [ ] For a macOS-specific helper, investigate bulk metadata APIs such as `getattrlistbulk`.
- [ ] Preserve allocated-block accounting, device boundaries, hard-link deduplication, and typed errors.
- [ ] Stream compact batches or write the SQLite partial index directly. Do not emit one full JSON tree.
- [ ] Include helper launch, IPC, database publication, and renderer readiness in benchmarks.
- [ ] Evaluate packaging, code signing, crash reporting, and architecture support before adoption.

### Exit criteria

- [ ] The prototype has an end-to-end comparison against Stage 5, not only traversal microbenchmarks.
- [ ] The speedup is large enough to justify a native binary and protocol.
- [ ] Cancellation, errors, and publication are at least as safe as the Node implementation.
- [ ] If the benefit is insufficient, record the result and stop without integrating the helper.

---

## Stage 9: evaluate persistent and incremental indexes

### Purpose

Improve perceived startup and repeat-scan speed after full scans are already efficient.

This stage changes Orbis's current privacy and retention behavior. Treat it as a separate feature.

### Product decisions required first

- [ ] Decide whether persistence is opt-in or default.
- [ ] Set a retention period.
- [ ] Define when an index is considered stale.
- [ ] Define how the UI displays index age and refresh status.
- [ ] Provide a Clear Index action.

### Technical work

- [ ] Load the last completed index immediately, then refresh in the background.
- [ ] Investigate FSEvents for changed-subtree detection.
- [ ] Define reconciliation for renames, deletes, mount changes, hard links, and permission changes.
- [ ] Refresh volume capacity and free-space metadata independently.
- [ ] Fall back to a full scan whenever incremental correctness is uncertain.
- [ ] Clean stale and crash-leftover databases on startup.
- [ ] Document that the retained database contains filenames and directory structure.

### Exit criteria

- [ ] Users can see when the displayed index was captured.
- [ ] Users can delete retained scan data.
- [ ] Incremental and full scans converge on the same fixture results.
- [ ] Privacy and retention behavior is documented in the UI and README.

---

## Final verification after each implementation stage

Use the narrow commands during development, then run the complete checks before considering a stage finished:

```sh
pnpm -C apps/Orbis verify
pnpm typecheck
pnpm test
```

Run the standalone smoke test for worker, IPC, renderer, or publication changes:

```sh
pnpm -C apps/Orbis test:smoke
```

## Measurement log

Fill in one row after each stage using the same primary fixture. Add separate tables for materially different disks or fixtures.

| Stage | Fixture | Cache | Items | Scan ms | Traverse ms | Aggregate ms | Controller publish ms | DB MiB | RSS increase MiB | Notes |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 0 baseline | wide | warm | 2,001 | 75.92 | 67.35 | 4.10 | 0.89 | 0.42 | 10.58 | 5 instrumented runs; highest variance |
| 0 baseline | deep | warm | 257 | 55.75 | 22.81 | 28.46 | 0.57 | 0.16 | 10.36 | Directory-heavy aggregation |
| 0 baseline | tiny | warm | 10,101 | 281.57 | 238.11 | 34.15 | 1.64 | 2.14 | 23.59 | Many one-byte files |
| 0 baseline | mixed | warm | 2,021 | 65.22 | 53.96 | 7.52 | 1.30 | 0.46 | 10.30 | 62.98 MiB file data |
| 0 baseline | semantics | warm | 7 | 5.56 | 1.52 | 0.80 | 0.41 | 0.03 | 0.00 | Too short for the 20 ms RSS sampler |
| 0 baseline | startup volume | cold-manual | | | | | | | | Pending a restart and prepared manual run |
| 1 SQLite transaction | | cold | | | | | | | | |
| 2 bottom-up totals | | cold | | | | | | | | |
| 3 compact schema | | cold | | | | | | | | |
| 4 no scan sort | | cold | | | | | | | | |
| 5 bounded concurrency | | cold | | | | | | | | |
| 6 SQLite durability | | cold | | | | | | | | |

## Decision log

Record decisions that affect later stages.

| Date | Stage | Decision | Evidence | Consequences |
|---|---:|---|---|---|
| 2026-08-24 | 0 | Keep diagnostics internal and opt-in | Production result and snapshot contracts do not need benchmark data | Worker sends a separate diagnostics message only when enabled |
| 2026-08-24 | 0 | Proceed with transaction and statement reuse before concurrency | Traversal used 82-88% on wide, tiny, and mixed fixtures; aggregation used 52.5% on the deep fixture | Stage 1 can address both measured costs without changing traversal behavior |
