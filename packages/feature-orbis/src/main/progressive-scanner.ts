import { createHmac, randomBytes } from "node:crypto"
import { lstat, open, opendir, realpath, rename, statfs } from "node:fs/promises"
import { basename, dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path"
import type { Breadcrumb, ChartSegment, NodeSummary, VolumeSnapshot } from "../shared/contracts"
import { buildChart } from "./chart"
import { prepareDatabaseDirectory, removeDatabaseFiles } from "./database"
import { createScanTimingAccumulator, measureScan, measureScanAsync, runWithScanDiagnostics } from "./diagnostics"
import { ProgressiveScanDatabase, type DirectoryTask } from "./progressive-database"
import {
  createDirectoryMetadataSource, loadNativeMetadataAddon, NodeDirectoryMetadataSource,
  type DirectoryMetadataCursor, type DirectoryMetadataEntry, type DirectoryMetadataSource, type FolderSizeEstimate
} from "./scan-metadata"
import {
  DEFAULT_METADATA_CONCURRENCY, STARTUP_EXCLUSIONS, ScanCanceledError,
  type ScanFileSystem, type ScanOptions, type ScanProgress, type ScanResult, type ScanStats, type ScanTotals
} from "./legacy-scanner"

interface ActiveCursor {
  readonly cursor: DirectoryMetadataCursor
  readonly source: "bulk" | "node"
}

export interface ProgressivePreview {
  readonly generation: number
  readonly revision: number
  readonly committed: false
  readonly target: { readonly name: string; readonly isStartup: boolean }
  readonly focus: NodeSummary
  readonly breadcrumbs: readonly Breadcrumb[]
  readonly chart: readonly ChartSegment[]
  readonly largestItems: readonly NodeSummary[]
  readonly volume: VolumeSnapshot
}

export interface ProgressiveScanOptions extends ScanOptions {
  readonly control: ProgressiveScanControl
  readonly onPreview?: (preview: ProgressivePreview) => void
  readonly initialEstimate?: FolderSizeEstimate
  readonly directoryMetadataSource?: DirectoryMetadataSource
  readonly nativeAddonPath?: string
}

export class ProgressiveScanControl {
  #database: ProgressiveScanDatabase | undefined
  #focusId: string | undefined
  #focusRequested = false
  #onFocus: (() => void) | undefined

  attach(database: ProgressiveScanDatabase, rootId: string, onFocus?: () => void): void {
    this.#database = database
    this.#focusId = rootId
    this.#focusRequested = false
    this.#onFocus = onFocus
  }
  detach(): void {
    this.#database = undefined
    this.#onFocus = undefined
  }
  focus(id: string): boolean {
    const database = this.#database
    const node = database?.getNode(id)
    if (!database || !node || node.kind !== "directory") return false
    database.promoteSubtree(id)
    database.bumpRevision()
    this.#focusId = id
    this.#focusRequested = true
    this.#onFocus?.()
    return true
  }
  consumeFocusRequest(): boolean { const value = this.#focusRequested; this.#focusRequested = false; return value }
  get focusId(): string | undefined { return this.#focusId }
  resolveNode(id: string): string | undefined { return this.#database?.resolvePath(id) }
}

const PAGE_SIZE = 32
const MAX_OPEN_HANDLES = 8
const PREVIEW_INTERVAL_MS = 100

const nativeFileSystem: ScanFileSystem & { opendir(path: string): Promise<NodeDirectoryHandle> } = {
  lstat: async (path) => lstat(path),
  readdir: async () => { throw new Error("Progressive scans use opendir") },
  statfs: async (path) => statfs(path),
  realpath: async (path) => realpath(path),
  opendir: async (path) => opendir(path)
}

export function scanFilesystemProgressive(options: ProgressiveScanOptions): Promise<ScanResult> {
  return runWithScanDiagnostics(options.generation, () => measureScanAsync("scan-total", () => scanImpl(options)))
}

async function scanImpl(options: ProgressiveScanOptions): Promise<ScanResult> {
  if (!isAbsolute(options.target)) throw new Error("Scan target must be an absolute path")
  const fileSystem = options.fileSystem ?? nativeFileSystem
  const metadataConcurrency = resolveConcurrency(options.metadataConcurrency)
  const nativeAddon = await loadNativeMetadataAddon(options.nativeAddonPath)
  const nodeMetadataSource = new NodeDirectoryMetadataSource(fileSystem, metadataConcurrency)
  const bulkMetadataSource = options.directoryMetadataSource ?? createDirectoryMetadataSource(nativeAddon, fileSystem, metadataConcurrency)
  const startedAt = Date.now()
  const totals = mutableTotals()
  const reporter = new PreviewReporter(options, startedAt, totals)
  const key = randomBytes(32)
  const nodeId = (parentId: string, name: string): string => `n-${createHmac("sha256", key).update(parentId).update("\0").update(name).digest("hex").slice(0, 32)}`
  const cursors = new Map<string, ActiveCursor>()
  const bulkFallbackDirectories = new Set<string>()
  let database: ProgressiveScanDatabase | undefined
  let constructionActive = true

  let preflight: Awaited<ReturnType<typeof preflightShape>>
  try {
    preflight = await measureScanAsync("preflight", async () => {
      await prepareDatabaseDirectory(options.partialPath)
      const indexRoot = await fileSystem.realpath(options.indexDirectory).catch(() => resolve(options.indexDirectory))
      const indexStats = await fileSystem.lstat(indexRoot).catch(() => undefined)
      const indexIdentity = indexStats?.isDirectory() ? identity(indexStats) : undefined
      const target = normalize(resolve(options.target))
      const rootStats = await fileSystem.lstat(target)
      throwIfCanceled(options.signal)
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error("Scan target must be a directory")
      const volume = await fileSystem.statfs(target)
      await removeDatabaseFiles(options.partialPath)
      return {
        indexRoot, indexIdentity, target, rootStats, rootDevice: part(rootStats.dev),
        targetRealpath: await fileSystem.realpath(target),
        capacityBytes: blockBytes(volume.blocks, volume.bsize), freeBytes: blockBytes(volume.bfree, volume.bsize)
      }
    })
  } catch (error) {
    options.control.detach()
    await removeDatabaseFiles(options.partialPath)
    throw error
  }

  const rootId = nodeId("root", preflight.target)
  try {
    database = measureScan("database-create", () => new ProgressiveScanDatabase(options.partialPath))
    const rootBytes = allocatedBytes(preflight.rootStats)
    database.insertRoot({ id: rootId, parentId: null, name: displayName(preflight.target), path: preflight.target, kind: "directory", ownBytes: rootBytes, device: preflight.rootDevice, inode: part(preflight.rootStats.ino) })
    database.setHardLinkOwner(part(preflight.rootStats.dev), part(preflight.rootStats.ino), rootId, "")
    options.control.attach(database, rootId, () => {
      queueMicrotask(() => { if (database && constructionActive) reporter.focus(database, preflight) })
    })
    totals.scannedItems = 1
    totals.discoveredBytes = rootBytes
    reporter.progress(displayName(preflight.target), true)

    if (options.initialEstimate) {
      database.applyEstimates(options.initialEstimate)
      database.bumpRevision()
    }

    const aggregationTiming = createScanTimingAccumulator("aggregation")
    let focusTurns = 0

    await measureScanAsync("traversal", async () => {
      while (database!.hasPendingTasks()) {
        throwIfCanceled(options.signal)
        const focusedAvailable = database!.hasPendingTasks(true)
        const normalAvailable = database!.hasPendingTasks(false)
        const takeFocused = focusedAvailable && (focusTurns < 3 || !normalAvailable)
        let task = database!.nextTask(takeFocused)
        if (!task) task = database!.nextTask(!takeFocused)
        if (!task) throw new Error("Directory queue is inconsistent")
        if (task.focused) focusTurns += 1
        else focusTurns = 0
        if (task.focused && focusTurns >= 3 && database!.hasPendingTasks(false)) focusTurns = 3

        database!.startTask(task.id)
        let activeCursor = cursors.get(task.id)
        if (!activeCursor) {
          if (cursors.size >= MAX_OPEN_HANDLES) await closeOneCursor(cursors, task.id)
          try {
            activeCursor = await openCursor(task.path, preflight.targetRealpath, bulkMetadataSource, nodeMetadataSource, bulkFallbackDirectories)
            await skipEntries(activeCursor.cursor, task.entriesRead, options.signal)
            cursors.set(task.id, activeCursor)
          } catch (error) {
            if (activeCursor) await activeCursor.cursor.close().catch(() => undefined)
            throwIfCanceled(options.signal)
            const disappearing = isDisappearing(error)
            database!.markUnreadable(task.id, disappearing)
            totals.skippedItems += 1
            totals.unreadableItems += 1
            if (disappearing) totals.disappearingItems += 1
            database!.bumpRevision()
            reporter.batch(database!, task.id, preflight, task.id === rootId)
            continue
          }
        }

        let page
        try {
          page = await activeCursor.cursor.readPage(PAGE_SIZE, options.signal ?? new AbortController().signal)
        } catch (error) {
          if (activeCursor.source === "bulk" && !options.signal?.aborted) {
            await closeCursor(cursors, task.id)
            bulkFallbackDirectories.add(task.path)
            try {
              const fallback = await nodeMetadataSource.open(task.path, preflight.targetRealpath)
              await skipEntries(fallback, task.entriesRead, options.signal)
              activeCursor = { cursor: fallback, source: "node" }
              cursors.set(task.id, activeCursor)
              continue
            } catch (fallbackError) {
              await fallbackErrorCursor(fallbackError, options, database!, task, totals, reporter, preflight, rootId)
              continue
            }
          }
          await closeCursor(cursors, task.id)
          throwIfCanceled(options.signal)
          const disappearing = isDisappearing(error)
          database!.markUnreadable(task.id, disappearing)
          totals.skippedItems += 1
          totals.unreadableItems += 1
          if (disappearing) totals.disappearingItems += 1
          database!.bumpRevision()
          reporter.batch(database!, task.id, preflight, task.id === rootId)
          continue
        }
        totals.bulkMetadataEntries += page.bulkEntries
        totals.fallbackMetadataEntries += page.fallbackEntries
        database!.advanceTask(task.id, page.entries.length)
        await processPage(page.entries, task, database!, options, preflight, totals, nodeId, aggregationTiming.measure)
        database!.bumpRevision()
        if (page.done) {
          await closeCursor(cursors, task.id)
          database!.finishEnumeration(task.id)
        } else database!.yieldTask(task.id)
        reporter.batch(database!, task.id, preflight, task.id === rootId)
      }
    })
    aggregationTiming.publish()
    await closeAll(cursors)
    constructionActive = false
    throwIfCanceled(options.signal)
    const root = database.getNode(rootId)
    if (!root || root.scanState !== "complete" && root.scanState !== "unreadable") throw new Error("Progressive scan root did not reach a terminal state")
    reporter.progress(displayName(preflight.target), true, "indexing")
    measureScan("index-create", () => database!.finalize())
    const elapsedMs = Date.now() - startedAt
    const finalTotals: ScanTotals = {
      scannedItems: totals.scannedItems, discoveredBytes: root.confirmedBytes, elapsedMs, skippedItems: totals.skippedItems,
      unreadableItems: totals.unreadableItems, nestedMounts: totals.nestedMounts, symlinks: totals.symlinks,
      duplicateHardLinks: totals.duplicateHardLinks, disappearingItems: totals.disappearingItems
    }
    const capturedAt = new Date().toISOString()
    measureScan("metadata-write", () => database!.writeMetadata({
      target: preflight.target, rootId, capacityBytes: preflight.capacityBytes, freeBytes: preflight.freeBytes,
      scannedBytes: root.confirmedBytes, totals: finalTotals, targetDevice: preflight.rootDevice,
      targetInode: part(preflight.rootStats.ino), ...(preflight.indexIdentity ? { indexDirectoryIdentity: preflight.indexIdentity } : {}),
      indexRevision: 1, capturedAt, refreshedAt: capturedAt
    }))
    database.complete()
    database = undefined
    options.control.detach()
    throwIfCanceled(options.signal)
    await measureScanAsync("publish-rename", () => durableRename(options.partialPath, options.publishedPath))
    reporter.progress(displayName(preflight.target), true, "indexing")
    throwIfCanceled(options.signal)
    return {
      generation: options.generation, target: preflight.target, rootId, publishedPath: options.publishedPath,
      capacityBytes: preflight.capacityBytes, freeBytes: preflight.freeBytes, scannedBytes: root.confirmedBytes, totals: finalTotals,
      metadata: {
        bulkMetadataEntries: totals.bulkMetadataEntries, fallbackMetadataEntries: totals.fallbackMetadataEntries
      }
    }
  } catch (error) {
    constructionActive = false
    await closeAll(cursors)
    options.control.detach()
    const failedDatabase = database
    database = undefined
    failedDatabase?.abort()
    await removeDatabaseFiles(options.partialPath)
    await removeDatabaseFiles(options.publishedPath)
    throw error
  }
}

async function durableRename(partialPath: string, publishedPath: string): Promise<void> {
  const partial = await open(partialPath, 'r')
  try { await partial.sync() } finally { await partial.close() }
  await rename(partialPath, publishedPath)
  const directory = await open(dirname(publishedPath), 'r')
  try { await directory.sync() } finally { await directory.close() }
}

async function openCursor(
  path: string,
  targetRealpath: string,
  bulk: DirectoryMetadataSource | undefined,
  node: DirectoryMetadataSource,
  fallbackDirectories: Set<string>
): Promise<ActiveCursor> {
  if (bulk && !fallbackDirectories.has(path)) {
    try { return { cursor: await bulk.open(path, targetRealpath), source: "bulk" } }
    catch { fallbackDirectories.add(path) }
  }
  return { cursor: await node.open(path, targetRealpath), source: "node" }
}

async function skipEntries(cursor: DirectoryMetadataCursor, count: number, signal: AbortSignal | undefined): Promise<void> {
  let remaining = Math.max(0, Math.floor(count))
  while (remaining > 0) {
    const page = await cursor.readPage(Math.min(PAGE_SIZE, remaining), signal ?? new AbortController().signal)
    if (page.entries.length === 0) return
    remaining -= page.entries.length
    if (page.done) return
  }
}

async function fallbackErrorCursor(
  error: unknown, options: ProgressiveScanOptions, database: ProgressiveScanDatabase, task: DirectoryTask,
  totals: ReturnType<typeof mutableTotals>, reporter: PreviewReporter, preflight: Awaited<ReturnType<typeof preflightShape>>, rootId: string
): Promise<void> {
  throwIfCanceled(options.signal)
  const disappearing = isDisappearing(error)
  database.markUnreadable(task.id, disappearing)
  totals.skippedItems += 1
  totals.unreadableItems += 1
  if (disappearing) totals.disappearingItems += 1
  database.bumpRevision()
  reporter.batch(database, task.id, preflight, task.id === rootId)
}

async function processPage(
  entries: readonly DirectoryMetadataEntry[], task: DirectoryTask, database: ProgressiveScanDatabase, options: ProgressiveScanOptions,
  preflight: Awaited<ReturnType<typeof preflightShape>>, totals: ReturnType<typeof mutableTotals>,
  nodeId: (parentId: string, name: string) => string, recordAggregation: (operation: () => void) => void
): Promise<number> {
  let accepted = 0
  for (const entry of entries) {
    throwIfCanceled(options.signal)
    const path = normalize(resolve(task.path, entry.name))
    if (entry.error) {
      const disappearing = isDisappearing(entry.error)
      totals.skippedItems += 1
      database.observeSkipped(task.id, disappearing ? { disappearing: true } : { unreadable: true })
      if (disappearing) totals.disappearingItems += 1
      else totals.unreadableItems += 1
      continue
    }
    if (!isWithin(path, preflight.target) || shouldExclude(path, options, preflight.indexRoot)) { totals.skippedItems += 1; database.observeSkipped(task.id); continue }
    if (entry.kind === "symlink") { totals.skippedItems += 1; totals.symlinks += 1; database.observeSkipped(task.id, { symlink: true }); continue }
    if (entry.mountPoint || entry.device !== "" && entry.device !== preflight.rootDevice) { totals.skippedItems += 1; totals.nestedMounts += 1; database.observeSkipped(task.id, { nestedMount: true }); continue }
    if (preflight.indexIdentity && entry.kind === "directory" && identity({ dev: entry.device, ino: entry.inode }) === preflight.indexIdentity) { totals.skippedItems += 1; database.observeSkipped(task.id); continue }
    const kind = entry.kind === "directory" || entry.kind === "file" ? entry.kind : undefined
    if (!kind) { totals.skippedItems += 1; database.observeSkipped(task.id); continue }
    const id = nodeId(task.id, entry.name)
    const bytes = Math.max(0, entry.allocatedBytes)
    const pathKey = relative(preflight.target, path)
    let replacingOwner = false
    if (kind === "file") database.insertFileAlias(task.id, entry.name, pathKey, entry.device, entry.inode, bytes)
    if (kind === "file" && entry.device !== "" && entry.inode !== "") {
      const owner = database.getHardLinkOwner(entry.device, entry.inode)
      if (owner) {
        totals.skippedItems += 1
        totals.duplicateHardLinks += 1
        if (comparePaths(pathKey, owner.pathKey) >= 0) {
          database.observeSkipped(task.id, { duplicate: true })
          continue
        }
        const previousParentId = database.getNode(owner.nodeId)?.parentId
        if (previousParentId) database.observeSkipped(previousParentId, { duplicate: true })
        replacingOwner = true
        recordAggregation(() => database.removeOwnedFile(owner.nodeId))
      }
    }
    const focused = task.focused || database.taskIsFocused(task.id)
    recordAggregation(() => database.insertChild({ id, parentId: task.id, name: entry.name, path, kind, ownBytes: bytes, device: entry.device, inode: entry.inode }, task.depth + 1, focused))
    if (entry.device !== "" && entry.inode !== "") database.setHardLinkOwner(entry.device, entry.inode, id, pathKey)
    if (!replacingOwner) {
      totals.scannedItems += 1
      totals.discoveredBytes += bytes
    }
    accepted += 1
  }
  return accepted
}

// Gives TypeScript a named structural type for preflight data without exporting private paths.
async function preflightShape() {
  return { indexRoot: "", indexIdentity: undefined as string | undefined, target: "", targetRealpath: "", rootStats: {} as ScanStats, rootDevice: "", capacityBytes: 0, freeBytes: 0 }
}

class PreviewReporter {
  #lastProgress = 0
  #lastPreview = 0
  #firstPreview = false
  constructor(private readonly options: ProgressiveScanOptions, private readonly startedAt: number, private readonly totals: ReturnType<typeof mutableTotals>) {}
  progress(item: string, force = false, stage: ScanProgress["stage"] = "traversing"): void {
    const now = Date.now()
    if (!force && now - this.#lastProgress < PREVIEW_INTERVAL_MS) return
    this.#lastProgress = now
    this.options.onProgress?.({ stage, scannedItems: this.totals.scannedItems, discoveredBytes: this.totals.discoveredBytes, elapsedMs: now - this.startedAt, currentItem: item })
  }
  focus(database: ProgressiveScanDatabase, volume: { target: string; capacityBytes: number; freeBytes: number }): void {
    if (!this.#firstPreview) return
    this.emit(database, volume, false)
  }
  estimate(database: ProgressiveScanDatabase, volume: { target: string; capacityBytes: number; freeBytes: number }): void {
    if (!this.#firstPreview) return
    this.emit(database, volume, false)
  }
  batch(database: ProgressiveScanDatabase, taskId: string, volume: { target: string; capacityBytes: number; freeBytes: number }, rootPageCompleted: boolean): void {
    this.progress(database.getNode(taskId)?.name ?? "")
    this.options.control.consumeFocusRequest()
    if (!this.options.onPreview) return
    const now = Date.now()
    if (!this.#firstPreview) {
      if (!rootPageCompleted) return
      this.emit(database, volume, true)
      return
    }
    if (now - this.#lastPreview < PREVIEW_INTERVAL_MS) return
    this.emit(database, volume, false)
  }
  private emit(database: ProgressiveScanDatabase, volume: { target: string; capacityBytes: number; freeBytes: number }, first: boolean): void {
    const now = Date.now()
    if (!first && now - this.#lastPreview < PREVIEW_INTERVAL_MS) return
    const onPreview = this.options.onPreview
    if (!onPreview) return
    const focusId = this.options.control.focusId
    const focus = focusId ? database.getNode(focusId) : undefined
    if (!focus || focus.kind !== "directory") return
    this.#firstPreview = true
    this.#lastPreview = now
    const breadcrumbs = database.getBreadcrumbs(focus.id)
    const rootId = breadcrumbs[0]?.id ?? focus.id
    const root = database.getNode(rootId)
    const scannedBytes = root?.confirmedBytes ?? focus.confirmedBytes
    const unscannedBytes = volume.target === "/" ? Math.max(0, volume.capacityBytes - volume.freeBytes - scannedBytes) : 0
    onPreview({
      generation: this.options.generation, revision: database.revision, committed: false,
      target: { name: displayName(volume.target), isStartup: volume.target === "/" },
      focus: summary(focus), breadcrumbs, chart: buildChart(database, focus), largestItems: database.getLargestItems(focus.id),
      volume: { capacityBytes: volume.capacityBytes, freeBytes: volume.freeBytes, scannedBytes, unscannedBytes, sizeAccuracy: unscannedBytes > 0 ? "estimated" : focus.sizeAccuracy }
    })
  }
}

function summary(node: NonNullable<ReturnType<ProgressiveScanDatabase["getNode"]>>): NodeSummary {
  return { id: node.id, parentId: node.parentId, name: node.name, kind: node.kind, sizeBytes: node.sizeBytes, ...(node.estimatedBytes > 0 ? { estimatedSizeBytes: node.estimatedBytes } : {}), directChildren: node.directChildren, descendantCount: node.descendantCount, unreadableCount: node.unreadableCount, scanState: node.scanState, sizeAccuracy: node.sizeAccuracy }
}

async function closeCursor(cursors: Map<string, ActiveCursor>, id: string): Promise<void> {
  const handle = cursors.get(id)
  cursors.delete(id)
  if (handle) await handle.cursor.close().catch(() => undefined)
}
async function closeOneCursor(cursors: Map<string, ActiveCursor>, except: string): Promise<void> { const id = [...cursors.keys()].find((value) => value !== except); if (id) await closeCursor(cursors, id) }
async function closeAll(cursors: Map<string, ActiveCursor>): Promise<void> { await Promise.all([...cursors.keys()].map((id) => closeCursor(cursors, id))) }

function mutableTotals() {
  return {
    scannedItems: 0, discoveredBytes: 0, skippedItems: 0, unreadableItems: 0, nestedMounts: 0, symlinks: 0,
    duplicateHardLinks: 0, disappearingItems: 0, bulkMetadataEntries: 0, fallbackMetadataEntries: 0
  }
}
function resolveConcurrency(value: number | undefined): number { const configured = value ?? Number(process.env.ORBIS_SCAN_CONCURRENCY ?? DEFAULT_METADATA_CONCURRENCY); return Number.isFinite(configured) ? Math.max(1, Math.min(64, Math.floor(configured))) : DEFAULT_METADATA_CONCURRENCY }
function shouldExclude(path: string, options: ScanOptions, indexRoot: string): boolean { return isWithin(path, indexRoot) || options.startupRoot !== false && normalize(options.target) === "/" && STARTUP_EXCLUSIONS.some((excluded) => isWithin(path, excluded)) }
function isWithin(path: string, parent: string): boolean { const child = normalize(path); const root = normalize(parent); const remainder = relative(root, child); return child === root || remainder !== "" && remainder !== ".." && !remainder.startsWith(`..${sep}`) }
function comparePaths(left: string, right: string): number { return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')) }
function displayName(path: string): string { return path === "/" ? "/" : basename(path) || path }
function part(value: number | bigint | string): string { return String(value) }
function identity(stats: { readonly dev: number | bigint | string; readonly ino: number | bigint | string }): string { return `${part(stats.dev)}:${part(stats.ino)}` }
function allocatedBytes(stats: Pick<ScanStats, "blocks">): number { return numberValue(stats.blocks ?? 0) * 512 }
function blockBytes(blocks: number | bigint, size: number | bigint): number { return numberValue(blocks) * numberValue(size) }
function numberValue(value: number | bigint): number { const number = typeof value === "bigint" ? Number(value) : Number(value); return Number.isFinite(number) && number > 0 ? number : 0 }
function throwIfCanceled(signal: AbortSignal | undefined): void { if (signal?.aborted) throw new ScanCanceledError() }
function isDisappearing(error: unknown): boolean { const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : ""; return code === "ENOENT" || code === "ENOTDIR" }

type NodeDirectoryHandle = { read(): Promise<{ name: string } | null>; close(): Promise<void> }

export type { ScanProgress, ScanResult, ScanTotals }
