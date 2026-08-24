import { mkdir, rm } from 'node:fs/promises'
import { basename, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import type { OrbisSnapshot, ProgressSnapshot } from '../shared/contracts'
import { buildChart } from './chart'
import { removeDatabaseFiles } from './database'
import { measureController, measureControllerAsync } from './diagnostics'
import { DiskIndex } from './index-store'
import type { ScanResult, ScanTotals } from './scanner'

export interface OrbisWorker {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): OrbisWorker
  on(event: 'error', listener: (error: unknown) => void): OrbisWorker
  on(event: 'exit', listener: (code: number) => void): OrbisWorker
  terminate(): Promise<number> | void
}

export interface OrbisWorkerFactory { create(): OrbisWorker }
export interface OrbisDialog { showOpenDialog(options: { readonly properties: Array<'openDirectory'> }): Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }> }
export interface OrbisShell { showItemInFolder(path: string): void; openExternal(url: string): Promise<void> }

export interface OrbisControllerOptions {
  /** The feature removes this directory during shutdown. It must be the feature's indexes directory. */
  readonly indexDirectory?: string
  /** When supplied, indexes are stored at `${dataDirectory}/indexes`. */
  readonly dataDirectory?: string
  readonly initialTarget?: string
  readonly dialog?: OrbisDialog
  readonly shell?: OrbisShell
}

interface WorkerProgressMessage { readonly type: 'progress'; readonly generation: number; readonly progress: ProgressSnapshot }
interface WorkerCompleteMessage { readonly type: 'complete'; readonly generation: number; readonly result: ScanResult }
interface WorkerCanceledMessage { readonly type: 'canceled'; readonly generation: number }
interface WorkerErrorMessage { readonly type: 'error'; readonly generation: number; readonly error: { readonly message: string; readonly code?: string } }
type WorkerResultMessage = WorkerProgressMessage | WorkerCompleteMessage | WorkerCanceledMessage | WorkerErrorMessage

interface ScanRun {
  readonly generation: number
  readonly partialPath: string
  readonly publishedPath: string
  readonly worker: OrbisWorker
  completed: boolean
  terminated: boolean
}

const EMPTY_TOTALS: ScanTotals = {
  scannedItems: 0,
  discoveredBytes: 0,
  elapsedMs: 0,
  skippedItems: 0,
  unreadableItems: 0,
  nestedMounts: 0,
  symlinks: 0,
  duplicateHardLinks: 0,
  disappearingItems: 0
}

export class OrbisController {
  readonly indexDirectory: string
  #active: DiskIndex | undefined
  #target: string
  #focusId: string | undefined
  #generation = 0
  #run: ScanRun | undefined
  #scanStatus: OrbisSnapshot['scan'] = { status: 'idle', generation: 0, progress: null, totals: null, error: null }
  #listeners = new Set<(snapshot: OrbisSnapshot) => void>()
  #pendingTasks = new Set<Promise<void>>()
  #closed = false
  #dialog: OrbisDialog | undefined
  #shell: OrbisShell | undefined

  constructor(
    private readonly workers: OrbisWorkerFactory,
    options: OrbisControllerOptions
  ) {
    const dataDirectory = options.dataDirectory ? resolve(options.dataDirectory) : undefined
    if (!options.indexDirectory && !dataDirectory) throw new Error('Orbis requires a writable data directory')
    this.indexDirectory = resolve(options.indexDirectory ?? join(dataDirectory!, 'indexes'))
    this.#target = normalize(resolve(options.initialTarget ?? process.env.ORBIS_SCAN_ROOT ?? '/'))
    this.#dialog = options.dialog
    this.#shell = options.shell
  }

  subscribe(listener: (snapshot: OrbisSnapshot) => void): () => void {
    if (this.#closed) return () => undefined
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  snapshot(): OrbisSnapshot { return this.#buildSnapshot() }

  #buildSnapshot(diagnosticGeneration?: number): OrbisSnapshot {
    const timed = <T>(phase: string, operation: () => T): T => diagnosticGeneration === undefined ? operation() : measureController(diagnosticGeneration, phase, operation)
    const active = this.#active
    const focus = timed('snapshot-focus-query', () => active && this.#focusId ? active.getNode(this.#focusId) : undefined)
    const target = active?.target ?? this.#target
    const activeTotals = active ? parseTotals(active.metadata.totals) : null
    const root = timed('snapshot-root-query', () => active?.root)
    const volume = active
      ? parseVolume(active.metadata.volume, root?.sizeBytes ?? 0, active.target)
      : { capacityBytes: 0, freeBytes: 0, scannedBytes: 0, unscannedBytes: 0 }
    const breadcrumbs = timed('snapshot-breadcrumbs-query', () => focus && active ? active.getBreadcrumbs(focus.id) : [])
    const chart = timed('snapshot-chart-query', () => focus && active ? buildChart(active, focus, { extraRootBytes: focus.id === active.rootId && active.target === '/' ? volume.unscannedBytes : 0 }) : [])
    const largestItems = timed('snapshot-largest-items-query', () => focus && active ? active.getLargestItems(focus.id) : [])
    return {
      version: 1,
      target: { name: root?.name ?? displayName(target), isStartup: target === '/' },
      focus: focus ? toSnapshotNode(focus) : null,
      breadcrumbs,
      chart,
      largestItems,
      volume,
      scan: { ...this.#scanStatus, totals: this.#scanStatus.totals ?? activeTotals }
    }
  }

  async startScan(): Promise<OrbisSnapshot> { return this.#startScanAt(this.#target) }
  async rescan(): Promise<OrbisSnapshot> { return this.#startScanAt(this.#target) }

  async chooseFolder(): Promise<OrbisSnapshot> {
    if (!this.#dialog) throw new Error('Folder selection is unavailable')
    const result = await this.#dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!result.canceled && result.filePaths[0]) return this.#startScanAt(result.filePaths[0])
    return this.snapshot()
  }

  async cancelScan(): Promise<OrbisSnapshot> {
    const run = this.#run
    if (!run) return this.snapshot()
    this.#run = undefined
    this.#scanStatus = { status: 'canceled', generation: run.generation, progress: null, totals: null, error: null }
    await this.#stopRun(run)
    await this.#removeRunFiles(run)
    this.#emit()
    return this.snapshot()
  }

  async focusNode(id: string): Promise<OrbisSnapshot> {
    const active = this.#active
    if (!active) throw new Error('No completed scan is available')
    const node = active.getNode(id)
    if (!node) throw new Error('Unknown Orbis node')
    if (node.kind !== 'directory') throw new Error('Only directories can become the chart root')
    this.#focusId = node.id
    this.#emit()
    return this.snapshot()
  }

  async revealNode(id: string): Promise<void> {
    if (!this.#active || !this.#shell) throw new Error('No completed scan is available')
    const path = this.#active.resolvePath(id)
    if (!path) throw new Error('Unknown Orbis node')
    this.#shell.showItemInFolder(path)
  }

  async openFullDiskAccess(): Promise<void> {
    if (!this.#shell) throw new Error('Full Disk Access settings are unavailable')
    await this.#shell.openExternal('x-apple.systempreferences:com.apple.settings.PrivacySecurity_Privacy_FullDiskAccess')
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const run = this.#run
    this.#run = undefined
    if (run) {
      await this.#stopRun(run)
      await this.#removeRunFiles(run)
    }
    await Promise.allSettled([...this.#pendingTasks])
    this.#active?.close()
    this.#active = undefined
    this.#focusId = undefined
    // The feature owns this directory. Its parent may contain unrelated host data.
    await rm(this.indexDirectory, { recursive: true, force: true })
    this.#listeners.clear()
  }

  #startTask(task: Promise<void>): void {
    this.#pendingTasks.add(task)
    void task.finally(() => this.#pendingTasks.delete(task)).catch(() => undefined)
  }

  async #stopRun(run: ScanRun): Promise<void> {
    if (run.terminated) return
    run.terminated = true
    try { run.worker.postMessage({ type: 'cancel' }) } catch { /* The worker may already be stopping. */ }
    await Promise.resolve(run.worker.terminate())
  }

  async #removeRunFiles(run: ScanRun): Promise<void> {
    await Promise.all([removeOwnedDatabaseFiles(run.partialPath, this.indexDirectory), removeOwnedDatabaseFiles(run.publishedPath, this.indexDirectory)])
  }

  async #startScanAt(value: string): Promise<OrbisSnapshot> {
    if (this.#closed) throw new Error('Orbis is shutting down')
    if (!isAbsolute(value) || value.includes('\u0000')) throw new Error('Choose an absolute folder')
    const previous = this.#run
    if (previous) {
      this.#run = undefined
      await this.#stopRun(previous)
      await this.#removeRunFiles(previous)
    }
    await mkdir(this.indexDirectory, { recursive: true })
    if (this.#closed) throw new Error('Orbis is shutting down')
    const generation = ++this.#generation
    const partialPath = resolve(this.indexDirectory, `scan-${generation}.partial.sqlite`)
    const publishedPath = resolve(this.indexDirectory, `scan-${generation}.sqlite`)
    await removeOwnedDatabaseFiles(partialPath, this.indexDirectory)
    await removeOwnedDatabaseFiles(publishedPath, this.indexDirectory)
    const worker = this.workers.create()
    const run: ScanRun = { generation, partialPath, publishedPath, worker, completed: false, terminated: false }
    this.#run = run
    this.#target = normalize(resolve(value))
    this.#scanStatus = { status: 'scanning', generation, progress: null, totals: null, error: null }
    this.#wireWorker(run)
    worker.postMessage({ type: 'start', generation, target: this.#target, partialPath, publishedPath, indexDirectory: this.indexDirectory, startupRoot: this.#target === '/' })
    this.#emit()
    return this.snapshot()
  }

  #wireWorker(run: ScanRun): void {
    run.worker.on('message', (message) => this.#handleWorkerMessage(run, message))
    run.worker.on('error', (error) => this.#handleWorkerError(run, error))
    run.worker.on('exit', (code) => {
      if (this.#run === run && !run.completed && !this.#closed) {
        this.#fail(run, code === 0 ? 'The scan worker exited before completing.' : `The scan worker stopped unexpectedly (code ${code}).`)
      }
    })
  }

  #handleWorkerMessage(run: ScanRun, unknownMessage: unknown): void {
    if (this.#run !== run || this.#closed) {
      if (isComplete(unknownMessage)) this.#startTask(removeOwnedDatabaseFiles(unknownMessage.result.publishedPath, this.indexDirectory))
      return
    }
    const message = unknownMessage as Partial<WorkerResultMessage>
    if (message.generation !== run.generation) {
      if (isComplete(unknownMessage)) this.#startTask(removeOwnedDatabaseFiles(unknownMessage.result.publishedPath, this.indexDirectory))
      return
    }
    if (message.type === 'progress' && message.progress) {
      this.#scanStatus = { status: 'scanning', generation: run.generation, progress: message.progress, totals: null, error: null }
      this.#emit()
    } else if (message.type === 'complete' && message.result) {
      run.completed = true
      this.#startTask(this.#publish(run, message.result))
    } else if (message.type === 'canceled') {
      this.#run = undefined
      this.#scanStatus = { status: 'canceled', generation: run.generation, progress: null, totals: null, error: null }
      this.#startTask(this.#removeRunFiles(run).then(() => this.#emit()))
    } else if (message.type === 'error' && message.error) {
      this.#fail(run, message.error.message)
    }
  }

  #handleWorkerError(run: ScanRun, error: unknown): void {
    if (this.#run !== run || this.#closed) return
    this.#fail(run, error instanceof Error ? error.message : String(error))
  }

  async #publish(run: ScanRun, result: ScanResult): Promise<void> {
    return measureControllerAsync(run.generation, 'publication-total', async () => {
      if (result.publishedPath !== run.publishedPath || !isOwnedIndexPath(result.publishedPath, this.indexDirectory)) {
        await this.#fail(run, 'The scan worker returned an invalid index path.')
        return
      }
      if (this.#run !== run || this.#closed) {
        await removeOwnedDatabaseFiles(result.publishedPath, this.indexDirectory)
        return
      }
      try {
        const next = measureController(run.generation, 'index-open', () => new DiskIndex(result.publishedPath))
        const old = this.#active
        this.#active = next
        this.#focusId = next.rootId
        this.#target = next.target
        this.#run = undefined
        this.#scanStatus = { status: 'completed', generation: run.generation, progress: null, totals: result.totals, error: null }
        old?.close()
        if (old) await measureControllerAsync(run.generation, 'previous-index-cleanup', () => removeOwnedDatabaseFiles(old.path, this.indexDirectory))
        await measureControllerAsync(run.generation, 'partial-index-cleanup', () => removeOwnedDatabaseFiles(run.partialPath, this.indexDirectory))
        const snapshot = measureController(run.generation, 'snapshot-total', () => this.#buildSnapshot(run.generation))
        measureController(run.generation, 'listener-notify', () => this.#emit(snapshot))
      } catch (error) {
        await removeOwnedDatabaseFiles(result.publishedPath, this.indexDirectory)
        this.#fail(run, error instanceof Error ? error.message : String(error))
      }
    })
  }

  #fail(run: ScanRun, error: string): void {
    if (this.#run !== run) return
    this.#run = undefined
    this.#scanStatus = { status: 'fatal-error', generation: run.generation, progress: null, totals: null, error }
    this.#startTask(this.#stopRun(run).then(() => this.#removeRunFiles(run)).then(() => this.#emit()))
  }

  #emit(snapshot = this.snapshot()): void {
    for (const listener of this.#listeners) listener(snapshot)
  }
}

function isComplete(value: unknown): value is WorkerCompleteMessage {
  return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'complete' && !!(value as { result?: unknown }).result
}

async function removeOwnedDatabaseFiles(path: string, indexDirectory: string): Promise<void> {
  if (isOwnedIndexPath(path, indexDirectory)) await removeDatabaseFiles(path)
}

function isOwnedIndexPath(path: string, indexDirectory: string): boolean {
  const child = resolve(path)
  const root = resolve(indexDirectory)
  const remainder = relative(root, child)
  return remainder !== '' && !remainder.startsWith(`..${sep}`) && remainder !== '..' && !remainder.includes(sep + sep)
}

function toSnapshotNode(node: { id: string; parentId: string | null; name: string; kind: 'directory' | 'file'; sizeBytes: number; directChildren: number; descendantCount: number; unreadableCount: number }) {
  return { id: node.id, parentId: node.parentId, name: node.name, kind: node.kind, sizeBytes: node.sizeBytes, directChildren: node.directChildren, descendantCount: node.descendantCount, unreadableCount: node.unreadableCount }
}

function parseVolume(value: string | undefined, scannedBytes: number, target: string): OrbisSnapshot['volume'] {
  try {
    const parsed = JSON.parse(value ?? '{}') as { capacityBytes?: unknown; freeBytes?: unknown }
    const capacityBytes = finite(parsed.capacityBytes)
    const freeBytes = finite(parsed.freeBytes)
    const unscannedBytes = target === '/' ? Math.max(0, capacityBytes - freeBytes - scannedBytes) : 0
    return { capacityBytes, freeBytes, scannedBytes, unscannedBytes }
  } catch { return { capacityBytes: 0, freeBytes: 0, scannedBytes, unscannedBytes: 0 } }
}

function parseTotals(value: string | undefined): ScanTotals {
  try {
    const parsed = JSON.parse(value ?? 'null') as Partial<ScanTotals> | null
    if (!parsed) return EMPTY_TOTALS
    return { ...EMPTY_TOTALS, ...Object.fromEntries(Object.keys(EMPTY_TOTALS).map((key) => [key, finite(parsed[key as keyof ScanTotals])])) } as ScanTotals
  } catch { return EMPTY_TOTALS }
}

function finite(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0 }
function displayName(path: string): string { return path === '/' ? '/' : basename(path) || path }
export type { WorkerResultMessage }
