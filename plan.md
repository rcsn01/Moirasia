# Plan — Deepen the runtime lease into one shared module

**Source:** architecture review (`/tmp/architecture-review-shout.html`), candidate 1 — "One runtime lease, not three implementations". User picked this candidate and pre-approved all recommended clarification answers.

**Scope:** consolidate the three per-app runtime-lease implementations (Shout, Bonded, Vox) into one deep module in `@moirasia/desktop-shell`, with per-app adapters that only name the lock and the host. Candidates 2–4 from the review stay out of scope.

---

## 1. Evidence (from the review)

- `apps/integrated/Shout/src/main/runtime-lease.ts` and `apps/integrated/Bonded/src/main/runtime-lease.ts` are clones: 94 and 95 lines (Shout lacks Bonded's trailing newline), and after substituting the app-name stem — the `ShoutRuntime*` type/error/function names, the `'Shout' | 'Moirasia'` host union, and both error-message strings — plus `shout-runtime.lock`→`bonded-runtime.lock`, the normalized diff is empty except that final newline.
- `apps/standalone/Vox/src/main/runtime-lease.ts` is a third, mechanically divergent implementation (123 lines): rename-CAS acquisition instead of mkdir-claim, injectable `{pid, now, token, probe}` dependencies, `acquiredAt` but no `version` in the owner record, unbounded retry loop, rename-aside release.
- Each app carries its own `tests/runtime-lease.test.ts`; Shout's and Bonded's are the same three cases under the same names. Vox has five richer cases (live-owner host identification, EPERM-as-live, dead-or-malformed recovery, concurrent recovery winner, old-holder release keeps a replacement lease).
- The concept is already named in the domain: CONTEXT.md says features "keep their controllers, IPC, leases…"; `docs/architecture/standalone-applications.md` describes each lease. The module behind the term is shallow and tripled.

## 2. Design decisions (grilling tree, recommended answers)

**Q1 — Where does the deep module live?**
➡️ `packages/desktop-shell/src/runtime-lease.ts`, exported as `@moirasia/desktop-shell/runtime-lease`.
Rationale: desktop-shell is the established home for shared main-process modules (`main.ts`, `standalone-launch.ts`, `login-item-control.ts`, `feature-surface-host.ts`); all three apps already depend on it (Shout and Bonded via `link:`, Vox via `file:` in devDependencies); the package's exports map already exposes subpaths (`./feature-surface-host` is the dedicated-subpath precedent, and every tsconfig uses `moduleResolution: "Bundler"`, so subpath exports typecheck). Pure Node module (`node:fs/promises`, `node:crypto`) — main-process-only, like `login-item-control`.

**Q2 — Which acquisition mechanism wins?**
➡️ Candidate-directory `rename` for an initial claim, plus a recovery marker for stale existing directories: build a candidate containing `owner.json` (written completely before publication), `rename()` it into place, and treat `EEXIST`/`ENOTEMPTY` as contention. Stale recovery first claims `recovery.json` inside the existing lock directory by publishing a complete temporary file with an atomic hard link. While that marker is held, re-read the owner and atomically install a new `owner.json` in place (exclusive hard-link when the file is absent; temp-file `rename` when replacing a stale record). New shared clients therefore never move the canonical directory during recovery, and the marker retains the legacy Shout/Bonded recovery filename and `{ pid, token }` shape.
Rationale: a bare `rename(lockPath → recoverySidecar)` is atomic as a move but is not a compare-and-swap against the stale owner that was observed earlier; a delayed recoverer could move a newer live lock. The marker plus in-place replacement closes that race among current shared clients without adding an external dependency. Stale-marker cleanup is bounded and revalidated, but Node's standard filesystem API has no conditional-delete primitive; the mixed-version limitation is recorded in §5.

**Q3 — What is the shared interface?**
➡️ One function, four small types, one error class:

```ts
// packages/desktop-shell/src/runtime-lease.ts
export interface RuntimeLeaseOwner {
  /** Version 1, or absent for legacy owner records (old Vox locks). Always 1 on records this module writes; the reader also tolerates version-less records as inputs. */
  version?: 1
  pid: number
  host: string
  token: string
  acquiredAt?: string
}

export interface RuntimeLease {
  readonly path: string
  readonly owner: RuntimeLeaseOwner
  /** Idempotent; never removes a lease this process does not own. */
  release(): Promise<void>
}

export class RuntimeLeaseInUseError extends Error {
  // `| undefined`, not `?`: every tsconfig sets exactOptionalPropertyTypes,
  // which forbids assigning undefined to an optional property.
  readonly owner: RuntimeLeaseOwner | undefined
  constructor(owner: RuntimeLeaseOwner | undefined, primaryLabel: string)
}

export interface RuntimeLeaseDependencies {
  pid: number
  now(): Date
  token(): string
  probe(pid: number): void        // throws EPERM ⇒ alive
  delay(ms: number): Promise<void>
}
export interface RuntimeLeaseOptions {
  /** File name of the lock directory, e.g. 'shout-runtime.lock'. The on-disk name is part of the lock identity — never change it for an existing app. */
  lockName: string
  /** Host label this caller acquires as; must be one of `hosts`. Stored in the owner record and echoed as `owner.host` in error text. The suite acquires as 'Moirasia', standalone apps as their own name. */
  host: string
  /** Allowed owner hosts; hosts[0] is the product label used in error text. */
  hosts: readonly [string, ...string[]]
  /** Injectable for tests; defaults to process.pid / clock / randomUUID / process.kill / setTimeout. */
  dependencies?: Partial<RuntimeLeaseDependencies>
}

export async function acquireRuntimeLease(appDataDirectory: string, options: RuntimeLeaseOptions): Promise<RuntimeLease>
```

Lock path is composed inside: `join(appDataDirectory, 'Moirasia', lockName)` — the composition stays in the module, not in N callers.

**Q4 — Retry policy?**
➡️ Bounded: 3 attempts with a 25 ms pause between attempts — a new unified policy, not an existing one: Shout/Bonded's loop is 3 attempts with no inter-attempt pause (their 25 ms pauses are the four-read retry inside `readOwner`, and their only inter-attempt pause is 50 ms after seeing a live recovery claimant), while Vox's unbounded `for(;;)` loop is a livelock hazard that does not carry over. `delay` is injectable so tests are instant. After exhaustion, throw `RuntimeLeaseInUseError(undefined, label)` ("another host is active" variant).

**Q5 — On-disk compatibility (the load-bearing constraint)?**
➡️ The lock directory names do not change (`shout-runtime.lock`, `bonded-runtime.lock`, `vox-runtime`), so an old app's lease and a new build's lease are the same on-disk lock. Owner-record validation in the shared module accepts every historical shape:
- `version === 1` (Shout/Bonded) or `version` absent (Vox),
- `pid` safe positive integer, `host ∈ options.hosts`, non-empty `token`,
- `acquiredAt` optional string.
Writes always use the full record: `{ version: 1, pid, host, token, acquiredAt }` — old code that reads old files is replaced together with the app, and the shared reader tolerates version-less files only as *inputs*, never as a downgrade. The reader is deliberately stricter than Shout/Bonded's current one (`pid` must be a safe positive integer and `token` non-empty — Vox's rules): the difference only affects corrupt records, which then recover as stale, the desired outcome.
`recovery.json` is retained as the compatibility recovery marker, not a recovery sidecar directory. A stale legacy marker is reclaimed after liveness checks, and a successful recovery removes the marker; no migration step or lock-name change is needed.

**Q6 — Security posture?**
➡️ Shared module always: `mkdir(parent, { recursive: true, mode: 0o700 })`; new lock candidates use `mkdir(candidate, { mode: 0o700 })` + `chmod(candidate, 0o700)` and inherit that mode through the initial atomic `rename`; owner and recovery candidate files use `mode: 0o600`. Owner records are published atomically, and recovery replaces stale ownership in place without creating a less-private directory. This preserves Shout/Bonded's posture and hardens Vox's default-mode directories.

**Q7 — Error text and per-app error classes?**
➡️ Shared message: `${hosts[0]} is already in use by ${owner.host}. Quit ${owner.host}, then try again.` (ownerless variant: `Another ${hosts[0]} host is already active.`). Each app keeps a three-line subclass:

```ts
export class ShoutRuntimeInUseError extends RuntimeLeaseInUseError {
  constructor(owner?: RuntimeLeaseOwner) { super(owner, 'Shout'); this.name = 'ShoutRuntimeInUseError' }
}
```

The shared module throws only the base class, so each adapter rewraps it: catch `RuntimeLeaseInUseError` and rethrow `new <App>RuntimeInUseError(error.owner)` (owner and message derive identically; the ownerless exhaustion variant rewraps to the ownerless subclass message). That rewrap is what keeps `instanceof ShoutRuntimeInUseError` working at `apps/integrated/Shout/src/main/index.ts:21` — and `BondedRuntimeInUseError` at Bonded's `index.ts:21`, `VoxRuntimeInUseError` at Vox's `index.ts:30` — with zero call-site churn; a plain passthrough would throw the base class, every in-use dialog would fall through to the generic startup-error branch, and a user launching a second host would see the wrong dialog. All three apps' in-use dialog *message* text changes to the shared phrasing (Shout today: "Shout is already running in X."; Vox today: "X is already using Vox."; Bonded likewise) — accepted; dialog titles and the apps' own detail lines are unchanged.

**Q8 — What survives per app?**
➡️ Three thin adapters (per app `src/main/runtime-lease.ts`), each ~25 lines, uniform in shape:
- `acquire<App>RuntimeLease(appDataDirectory, host)` → try `acquireRuntimeLease(appDataDirectory, { lockName, host, hosts: [<App>, 'Moirasia'] })`, catching `RuntimeLeaseInUseError` and rethrowing the app subclass with the same `owner` (Q7),
- `export type <App>RuntimeLease = RuntimeLease` — a plain alias; widening Shout's/Bonded's current `release()`-only interface is call-site-safe because their callers only call `release()`, and Vox's controller already used the wider shape,
- `export class <App>RuntimeInUseError extends RuntimeLeaseInUseError` with the app's name string.
Vox's current third parameter (`Partial<LeaseDependencies>` overrides) and the `defaultVoxRuntimeLeasePath` helper are deleted: their only consumers are the tests moving to the root suite and the single `controller.ts:36` call site, updated to `acquireVoxRuntimeLease(app.getPath('appData'), 'Vox')`.

**Q9 — Test strategy?**
➡️ One conformance suite at the repo root (`tests/runtime-lease.test.ts`) exercising the shared module through injected dependencies (instant, no real clocks); per-app adapter-pin tests that keep the existing file names but shrink to the wiring facts. The three per-app behavioral suites are deleted (Shout's and Bonded's are clones of each other; Vox's cases are absorbed into the conformance list). Conformance cases (merged from the three current suites):

1. Rejects a second live owner, for every host in `hosts` (cross-host check: `Shout` owner blocks `Moirasia` and vice versa).
2. Recovers a stale owner (probe throws ESRCH) by claiming `recovery.json` and replacing `owner.json` in place; the marker is removed after recovery.
3. Concurrent recovery of one stale lease: two acquirers race for the recovery marker — exactly one wins, the loser gets `RuntimeLeaseInUseError`.
4. `EPERM` from the probe counts as live (macOS semantics).
5. Release is idempotent and never deletes a lease this process does not own (token mismatch, missing directory, already-released).
6. Garbage owner.json — and an owner-less lock directory, the legacy Shout/Bonded mkdir→writeFile torn-write shape — is treated as a stale owner and recovered. The shared reader retries up to four times with the injected delay so a legacy writer can finish its record; tests replace the delay with an immediate promise.
7. Exhaustion after 3 contended attempts throws the ownerless `InUseError`.
8. Pins: parent dir `0o700`, lock dir `0o700`, owner.json `0o600`, owner record carries `version: 1`, `host` (the `options.host` value), `acquiredAt`, and the caller's `lockName` in the returned `path`.
9. Accepts and recovers legacy shapes: version-less owner.json (old Vox), and a stale dir containing a legacy `recovery.json` marker (old Shout/Bonded).

Adapter pins (per app, real fs, no module mocking — deterministic without injection: a seeded dead pid `2_147_483_647` recovers, a seeded `process.pid` owner reads as live): (1) a stale lock seeded at `join(appData, 'Moirasia', '<name>')` is recovered, pinning the lock-name composition; (2) a live seeded owner rejects with `<App>RuntimeInUseError` (`instanceof RuntimeLeaseInUseError`, the app's `name`, message naming the app) — pinning `hosts[0]`, the subclass, and the rewrap; (3) one acquire→release round-trip proving the delegation.

**Q10 — Does anything else consume the leases?**
➡️ No beyond the tests. Grep confirmed consumers are: `apps/integrated/{Shout,Bonded}/src/main/feature.ts` (register/dispose), `<App>/src/main/index.ts` (dialog branch), `apps/standalone/Vox/src/main/controller.ts` (line 36 — the only `acquireVoxRuntimeLease` call site) + `index.ts` (dialog branch), and `apps/integrated/Bonded/tests/feature.test.ts:42`, which `vi.mock`s `../src/main/runtime-lease` with only `acquireBondedRuntimeLease`. That mock keeps working unchanged as long as the adapter preserves the export name and two-argument shape (the `type BondedRuntimeLease` import in `feature.ts` is erased at compile time). The suite root does not take leases; controller tests never touch the lease; Shout has no feature test and Bonded's feature tests mock the lease, so no register test exercises the real lock.

## 3. Implementation

### Phase 1 — Shared module + conformance suite

**New file `packages/desktop-shell/src/runtime-lease.ts`** (the deep implementation). Full behavior spec:

- `acquireRuntimeLease(appDataDirectory, options)`:
  0. Validate the file-name `lockName` and `options.host ∈ options.hosts` (programmer error ⇒ throw). Draw `token = dependencies.token()` once per acquire. The owner and all temporary names for this acquire derive from it.
  1. `parent = join(appDataDirectory, 'Moirasia')`; `lockPath = join(parent, options.lockName)`; `mkdir(parent, { recursive: true, mode: 0o700 })`.
  2. Loop up to 3 attempts:
     - Build `candidate = \`${lockPath}.candidate-${token}\``: remove only that private candidate, `mkdir(candidate, { mode: 0o700 })` + `chmod(candidate, 0o700)`, and write a complete `candidate/owner.json` (`wx`, 0o600, trailing newline) with `{ version: 1, pid: dependencies.pid, host: options.host, token, acquiredAt: now().toISOString() }`.
     - `rename(candidate, lockPath)`; success → return the lease.
     - On `EEXIST`/`ENOTEMPTY`: remove the candidate, read the current owner with up to four tolerant reads (25 ms injected delay between failed reads). A valid owner whose probe succeeds — or throws `EPERM` — yields `RuntimeLeaseInUseError(owner, hosts[0])`.
     - For an unreadable/invalid owner or a valid owner whose pid is dead, claim `lockPath/recovery.json`: write the complete `{ pid, token }` marker to a private temporary file, publish it with `link()` so another recovery claimant cannot overwrite it, and clean the temporary file. An existing live marker means contention; a stale marker is confirmed after one delay and removed before a later attempt. If the lock directory disappeared, retry.
     - Once this acquire owns the marker, re-read the owner. A live owner releases the marker and wins. Otherwise install this acquire's owner: use an exclusive hard link if `owner.json` is absent; if it exists as stale/garbage, write a complete temporary owner file and atomically `rename()` it over `owner.json`. Re-read to confirm this token, remove this acquire's marker, and return the lease. If the directory disappeared or another live owner appeared, release the marker and retry/throw accordingly.
     - Between attempts: `await delay(25)`.
  3. After 3 attempts: throw `RuntimeLeaseInUseError(undefined, hosts[0])`.
- `release()`: idempotent flag; read owner; if `observed?.token !== owner.token` → return (someone else owns it or it is gone). Otherwise `rename(lockPath, \`${lockPath}.release-${token}\`)`; `ENOENT` ⇒ done; re-read owner inside the private claim; token match ⇒ remove the claim; token mismatch ⇒ rename the claim back (ignore `EEXIST`/`ENOTEMPTY`, because the path was re-taken).
- `readOwner(path, allowedHosts)`: tolerantly parses JSON, retrying up to four times to bridge the legacy Shout/Bonded mkdir→writeFile window. Validates pid (safe positive int), `host ∈ allowedHosts`, non-empty token; `version` may be `1` or absent; `acquiredAt` optional string; anything else ⇒ `undefined` (treated as stale).
- `isLive(pid, probe)`: probe success ⇒ true; `EPERM` ⇒ true; any other throw ⇒ false.
- Recovery and owner candidate files are published complete before they become visible. Crash leftovers are private to their token and never become the canonical `lockPath`; stale recovery markers are reclaimed only through the bounded liveness path. No top-level mutable state; only injected clock/probe/delay make the conformance suite instant and deterministic.

**Export wiring:** add `"./runtime-lease": "./src/runtime-lease.ts"` to `packages/desktop-shell/package.json` `exports`.

**New file `tests/runtime-lease.test.ts`** (repo root, house pattern of importing `../packages/desktop-shell/src/...` — see `tests/standalone-launch.test.ts`): the nine conformance cases from Q9, all through `dependencies` overrides (`probe`, fixed `token`/`now`, immediate `delay`, and scripted pids).

### Phase 2 — Shout + Bonded adapters

**Rewrite `apps/integrated/Shout/src/main/runtime-lease.ts`** to:

```ts
import { acquireRuntimeLease, RuntimeLeaseInUseError, type RuntimeLease, type RuntimeLeaseOwner } from '@moirasia/desktop-shell/runtime-lease'

export type ShoutRuntimeHost = 'Shout' | 'Moirasia'
export type ShoutRuntimeLease = RuntimeLease

export class ShoutRuntimeInUseError extends RuntimeLeaseInUseError {
  constructor(owner?: RuntimeLeaseOwner) { super(owner, 'Shout'); this.name = 'ShoutRuntimeInUseError' }
}

export async function acquireShoutRuntimeLease(appDataDirectory: string, host: ShoutRuntimeHost): Promise<ShoutRuntimeLease> {
  try {
    return await acquireRuntimeLease(appDataDirectory, { lockName: 'shout-runtime.lock', host, hosts: ['Shout', 'Moirasia'] })
  } catch (error) {
    // The shared module throws only the base class; rewrap so that
    // `error instanceof ShoutRuntimeInUseError` in index.ts keeps working.
    if (error instanceof RuntimeLeaseInUseError) throw new ShoutRuntimeInUseError(error.owner)
    throw error
  }
}
```

Callers (`feature.ts`, `index.ts`) need **zero edits**: same function names, same `ShoutRuntimeLease` type, same `instanceof ShoutRuntimeInUseError`.

**Mirror for Bonded** (`bonded-runtime.lock`, hosts `['Bonded', 'Moirasia']`, `BondedRuntimeInUseError`).

**Replace both `tests/runtime-lease.test.ts` files** with the three adapter pins from Q9 (real fs, no injected dependencies — the adapters expose none). Delete the cloned behavioral cases (now at the root).

### Phase 3 — Vox adapter (separate commit-sized step)

**Rewrite `apps/standalone/Vox/src/main/runtime-lease.ts`** to the same uniform adapter shape as Phase 2: lockName `'vox-runtime'` (unchanged on-disk name — no `.lock` suffix on purpose), hosts `['Vox', 'Moirasia']`, `export type VoxRuntimeLease = RuntimeLease`, `VoxRuntimeInUseError` subclass with the same rewrap. The exported signature changes from `acquireVoxRuntimeLease(path, host, overrides?)` to `acquireVoxRuntimeLease(appDataDirectory, host)` — decided: `controller.ts:36` is the only call site (verified: `acquireVoxRuntimeLease(defaultVoxRuntimeLeasePath(app.getPath('appData')), 'Vox')`), so it becomes `acquireVoxRuntimeLease(app.getPath('appData'), 'Vox')`, and both `defaultVoxRuntimeLeasePath` and the `overrides` parameter are deleted (the overrides' only consumers were the Vox tests, which move to the root suite in Phase 1). Keeping a path-shaped signature would force a fragile `dirname(dirname(path))` round-trip and silently mis-lock for any non-default path. The transitional-guard comment above the call stays.
Behavior changes for Vox, accepted deliberately: bounded 3-attempt loop (was unbounded; exhaustion now surfaces the in-use dialog with the ownerless message instead of retrying forever), `version` added to owner records, `0o700`/`0o600` permissions added, unified error text, dependency injection moves into the shared module's `dependencies` option (the adapter exposes none), and Vox's unused `hostname` import from `node:os` disappears. Vox's richer test cases (EPERM-as-live, concurrent recovery winner, old-holder release) move to the root conformance suite; Vox's per-app file shrinks to adapter pins written with `bun:test`.

### Phase 4 — Docs

- `CONTEXT.md`: add glossary term **Runtime lease** — "the cross-host exclusive lock ensuring one host owns a feature's sensitive session at a time; owner record + PID liveness + recovery marker + stale recovery + token-checked release. One deep module in `@moirasia/desktop-shell/runtime-lease`; each app adds an adapter that names its lock and host."
- `docs/architecture/standalone-applications.md`: in "Vox, Bonded, and Shout transitions", note the three leases share one implementation at `@moirasia/desktop-shell/runtime-lease` (on-disk lock names and owner-record compatibility unchanged; per-app in-use dialog wording and Vox's retry bound change as recorded in Q4/Q7; recovery uses a legacy-compatible marker).
- No ADR needed: nothing is being rejected or reversed; this records consolidation, which the module docs themselves state.

## 4. Verification

1. `pnpm typecheck` (root — covers desktop-shell + all integrated apps) and `pnpm test` (root — new conformance suite; the adapter pins run under the per-app commands in items 2–3).
2. `pnpm -C apps/integrated/Shout verify` and `pnpm -C apps/integrated/Bonded verify` (their suites include the shrunk adapter tests; targeted typecheck/tests may be used when native build verification is unavailable).
3. `bun --cwd apps/standalone/Vox run typecheck && bun --cwd apps/standalone/Vox test` (Phase 3; refresh the ignored local `file:` dependency if Bun's copied package is stale).
4. Grep confirms deleted APIs and old liveness helpers are gone: `grep -R "defaultVoxRuntimeLeasePath\|processIsAlive" apps packages --include="*.ts"` → zero matches. `recovery.json` is intentionally present only in the shared implementation and its conformance fixtures; it is no longer app-owned lease logic.
5. Behavior spot-check with a real double-host scenario: launch suite Moirasia with Shout feature loaded, then launch standalone Shout → expect the in-use dialog (same title/detail as today; message wording per Q7); vice versa. Same for Bonded's two-host dialog and Vox's double-launch dialog.
6. Review and create only the scoped outer/Bonded/Vox commits explicitly authorized by the user; do not stage unrelated outer work or Shout's uninitialized application tree.

## 5. Risks and mitigations

- **Mixed-version protocol mismatch** (old Shout/Bonded/Vox binary + a new shared-module build): owner-record compatibility is symmetric — the shared reader accepts version-less (old Vox) and version-1 (old Shout/Bonded) records; old readers accept the new record fields. New clients publish complete owner files, and the recovery marker uses the legacy Shout/Bonded `recovery.json` shape, so current shared clients serialize recovery and old Shout/Bonded understand the marker. This does **not** make the old Vox rename-aside protocol interoperable: old Vox can read a stale owner, then later move a newly acquired canonical directory because it ignores the marker. Node's standard filesystem API has no compare-and-swap rename or advisory lock that an already-shipped old binary also takes. Therefore absolute mutual exclusion across an old Vox binary and a new build is not claimed; the new protocol avoids the unsafe bare-rename recovery among current clients, and this residual transition risk must be accepted or eliminated by retiring old binaries before relying on the guarantee. No amount of post-rename rereading can honestly close that incompatible-protocol race.
- **Stale recovery-marker cleanup**: marker publication is complete-before-visible via temp file + hard link, and reclaim performs a second read after the injected retry delay. A crashed marker can still leave a narrow conditional-delete race because standard Node fs promises do not expose compare-and-unlink; the bounded retry/error path prevents an unbounded livelock. An OS advisory lock would be the stronger primitive, but adding native support is outside this consolidation.
- **In-use dialog text changes in all three apps** (message line only): covered by Q7; dialog titles and the apps' own detail lines are app-owned and unchanged.
- **Vox loses its unbounded retry**: intentional (Q4); under genuine contention three attempts + visible error beats an infinite loop.
- **Vox on-disk lock name**: `'vox-runtime'` kept verbatim; a stranded old Vox lease (dir without version) is recovered by the shared module because the reader tolerates version-less records.
- **Renderer bundling**: `runtime-lease.ts` imports only Node built-ins and is imported only from main-process code; it must not be imported by any preload/renderer file (the feature-catalog's renderer-bundlability rule is unaffected).

## 6. File-change summary

| File | Change |
|---|---|
| `packages/desktop-shell/src/runtime-lease.ts` | **new** — the deep module |
| `packages/desktop-shell/package.json` | add `./runtime-lease` export |
| `tests/runtime-lease.test.ts` (root) | **new** — conformance suite |
| `apps/integrated/Shout/src/main/runtime-lease.ts` | rewrite → adapter |
| `apps/integrated/Shout/tests/runtime-lease.test.ts` | shrink → adapter pins |
| `apps/integrated/Bonded/src/main/runtime-lease.ts` | rewrite → adapter |
| `apps/integrated/Bonded/tests/runtime-lease.test.ts` | shrink → adapter pins |
| `apps/standalone/Vox/src/main/runtime-lease.ts` | rewrite → adapter (Phase 3) |
| `apps/standalone/Vox/src/main/controller.ts` | one-line call-site edit: `acquireVoxRuntimeLease(app.getPath('appData'), 'Vox')`; `defaultVoxRuntimeLeasePath` deleted |
| `CONTEXT.md`, `docs/architecture/standalone-applications.md` | glossary term + one-line pointer |

No changes to feature.ts / index.ts call sites in any app; `apps/integrated/Bonded/tests/feature.test.ts` needs no edit (its lease mock matches the unchanged `acquireBondedRuntimeLease` export); no IPC or catalog changes; no packaging changes.