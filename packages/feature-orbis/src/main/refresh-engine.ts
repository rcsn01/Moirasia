import { constants } from 'node:fs'
import { copyFile, lstat, open, rename, statfs } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ChangeJournal } from './change-journal'
import { createChangeJournal, nativeChangeJournalAddon } from './change-journal'
import { prepareDatabaseDirectory, readMetadata, removeDatabaseFiles } from './database'
import { measureScanAsync, runWithScanDiagnostics } from './diagnostics'
import type { IndexManifest, JournalCursor } from './index-manifest'
import { planDirtyScopes, scanReplacementScopes } from './incremental-scanner'
import { IncrementalFallbackError, replaceIndexSubtrees } from './persistent-index-database'
import { loadNativeOrbisAddon } from './scan-metadata'
import { ScanCanceledError, scanFilesystem, type ScanOptions, type ScanResult, type ScanTotals } from './scanner'

export interface ActivePersistentIndex {
  readonly manifest: IndexManifest
  readonly path: string
}

export interface RefreshRequest extends ScanOptions {
  readonly active?: ActivePersistentIndex
  readonly changeJournal?: ChangeJournal
}

export type RefreshOutcome =
  | { readonly kind: 'candidate'; readonly strategy: 'full' | 'incremental'; readonly result: ScanResult; readonly journal: JournalCursor | null; readonly basePublicationId?: string; readonly fallbackReason?: string }
  | { readonly kind: 'unchanged'; readonly strategy: 'incremental'; readonly journal: JournalCursor; readonly totals: ScanTotals; readonly basePublicationId: string }

const MAX_EVENTS = 50_000
const HISTORY_TIMEOUT_MS = 10_000

export function refreshPersistentIndex(request: RefreshRequest): Promise<RefreshOutcome> {
  return runWithScanDiagnostics(request.generation, () => measureScanAsync('refresh-total', () => refreshPersistentIndexImpl(request)))
}

async function refreshPersistentIndexImpl(request: RefreshRequest): Promise<RefreshOutcome> {
  const refreshStartedAt = Date.now()
  if (process.env.ORBIS_LEGACY_SCAN === '1') {
    return { kind: 'candidate', strategy: 'full', result: await scanFilesystem(request), journal: null }
  }
  const addon = request.changeJournal ? undefined : await loadNativeOrbisAddon(request.nativeAddonPath)
  const journal = request.changeJournal ?? createChangeJournal(nativeChangeJournalAddon(addon))
  const activeCursor = request.active?.manifest.journal
  if (process.env.ORBIS_DISABLE_INCREMENTAL_SCAN === '1' || !request.active || !journal || !activeCursor) {
    return fullRefresh(request, journal)
  }
  const active = request.active
  const identityFailure = await validateActiveTarget(active.manifest)
  if (identityFailure) return fullRefresh(request, journal, identityFailure)

  const batch = await measureScanAsync('journal-replay', async () => journal.readChanges(request.target, activeCursor, MAX_EVENTS, HISTORY_TIMEOUT_MS))
  if (batch.requiresFullScan) return fullRefresh(request, journal, batch.reason ?? 'history-unavailable')
  const nextCursor = { uuid: activeCursor.uuid, eventId: batch.throughEventId }
  if (batch.events.length === 0) {
    return {
      kind: 'unchanged', strategy: 'incremental', journal: nextCursor,
      totals: readTotals(active.path), basePublicationId: active.manifest.publicationId
    }
  }

  const lookup = createIdentityLookup(active.path, request.target)
  let plan
  try {
    plan = await planDirtyScopes({ target: request.target, indexDirectory: request.indexDirectory, events: batch.events, ...(request.startupRoot !== undefined ? { startupRoot: request.startupRoot } : {}), lookupIdentity: lookup.lookup })
  } finally { lookup.close() }
  if (plan.kind === 'full') return fullRefresh(request, journal, plan.reason)
  if (plan.scopes.length === 0) {
    return {
      kind: 'unchanged', strategy: 'incremental', journal: nextCursor,
      totals: readTotals(active.path), basePublicationId: active.manifest.publicationId
    }
  }

  try {
    throwIfCanceled(request.signal)
    await measureScanAsync('candidate-clone', () => cloneIndex(active.path, request.partialPath))
    const scans = await measureScanAsync('incremental-traversal', () => scanReplacementScopes({
      generation: request.generation,
      indexDirectory: request.indexDirectory,
      scopes: plan.scopes,
      ...(request.nativeAddonPath ? { nativeAddonPath: request.nativeAddonPath } : {}),
      ...(request.directoryMetadataSource ? { directoryMetadataSource: request.directoryMetadataSource } : {}),
      ...(request.fileSystem ? { fileSystem: request.fileSystem } : {}),
      ...(request.metadataConcurrency !== undefined ? { metadataConcurrency: request.metadataConcurrency } : {}),
      ...(request.signal ? { signal: request.signal } : {})
    }))
    try {
      throwIfCanceled(request.signal)
      const volume = await volumeFor(request.target)
      const result = replaceIndexSubtrees({
        candidatePath: request.partialPath, target: request.target, replacements: scans.replacements,
        indexRevision: active.manifest.indexRevision + 1, capacityBytes: volume.capacityBytes,
        freeBytes: volume.freeBytes, elapsedMs: Date.now() - refreshStartedAt, targetAllocatedBytes: volume.targetAllocatedBytes
      })
      throwIfCanceled(request.signal)
      await measureScanAsync('candidate-publication', () => publishCandidate(request.partialPath, request.publishedPath))
      return {
        kind: 'candidate', strategy: 'incremental', journal: nextCursor,
        basePublicationId: active.manifest.publicationId,
        result: {
          generation: request.generation, target: request.target, rootId: result.rootId,
          publishedPath: request.publishedPath, capacityBytes: volume.capacityBytes, freeBytes: volume.freeBytes,
          scannedBytes: result.scannedBytes, totals: result.totals
        }
      }
    } finally { await scans.cleanup() }
  } catch (error) {
    await Promise.all([removeDatabaseFiles(request.partialPath), removeDatabaseFiles(request.publishedPath)])
    if (error instanceof ScanCanceledError || request.signal?.aborted) throw error
    return fullRefresh(request, journal, error instanceof IncrementalFallbackError ? error.message : 'incremental-failed')
  }
}

async function fullRefresh(request: RefreshRequest, journal: ChangeJournal | undefined, fallbackReason?: string, raceRetry = 0): Promise<RefreshOutcome> {
  await Promise.all([removeDatabaseFiles(request.partialPath), removeDatabaseFiles(request.publishedPath)])
  const checkpoint = journal && process.env.ORBIS_DISABLE_INCREMENTAL_SCAN !== '1'
    ? safeCheckpoint(journal, request.target)
    : undefined
  let result = await scanFilesystem(request)
  let cursor = checkpoint?.journalUuid && checkpoint.device === metadataTargetDevice(result.publishedPath)
    ? { uuid: checkpoint.journalUuid, eventId: checkpoint.eventId }
    : null

  // Reconcile changes after the pre-traversal fence. Retry one full traversal
  // when that fence is untrustworthy; a repeated failure discards the candidate
  // rather than publishing a snapshot invalidated during traversal.
  if (cursor && journal) {
    const batch = await measureScanAsync('journal-replay', async () => journal.readChanges(request.target, cursor!, MAX_EVENTS, HISTORY_TIMEOUT_MS))
    if (batch.requiresFullScan) return retryFullRefresh(request, journal, batch.reason ?? 'post-scan-history-unavailable', raceRetry)
    else if (batch.events.length === 0) cursor = { uuid: cursor.uuid, eventId: batch.throughEventId }
    else {
      try {
        const lookup = createIdentityLookup(result.publishedPath, request.target)
        let plan
        try { plan = await planDirtyScopes({ target: request.target, indexDirectory: request.indexDirectory, events: batch.events, ...(request.startupRoot !== undefined ? { startupRoot: request.startupRoot } : {}), lookupIdentity: lookup.lookup }) }
        finally { lookup.close() }
        if (plan.kind === 'full') return retryFullRefresh(request, journal, plan.reason, raceRetry)
        if (plan.scopes.length === 0) cursor = { uuid: cursor.uuid, eventId: batch.throughEventId }
        else {
          const scans = await scanReplacementScopes({
            generation: request.generation, indexDirectory: request.indexDirectory, scopes: plan.scopes,
            ...(request.nativeAddonPath ? { nativeAddonPath: request.nativeAddonPath } : {}),
            ...(request.directoryMetadataSource ? { directoryMetadataSource: request.directoryMetadataSource } : {}),
            ...(request.fileSystem ? { fileSystem: request.fileSystem } : {}),
            ...(request.metadataConcurrency !== undefined ? { metadataConcurrency: request.metadataConcurrency } : {}),
            ...(request.signal ? { signal: request.signal } : {})
          })
          try {
            const volume = await volumeFor(request.target)
            const updated = replaceIndexSubtrees({
              candidatePath: result.publishedPath, target: request.target, replacements: scans.replacements,
              indexRevision: metadataRevision(result.publishedPath) + 1,
              capacityBytes: volume.capacityBytes, freeBytes: volume.freeBytes, elapsedMs: result.totals.elapsedMs,
              targetAllocatedBytes: volume.targetAllocatedBytes
            })
            cursor = { uuid: cursor.uuid, eventId: batch.throughEventId }
            result = { ...result, rootId: updated.rootId, scannedBytes: updated.scannedBytes, totals: updated.totals, capacityBytes: volume.capacityBytes, freeBytes: volume.freeBytes }
          } finally { await scans.cleanup() }
        }
      } catch (error) {
        if (error instanceof ScanCanceledError || request.signal?.aborted) throw error
        return retryFullRefresh(request, journal, 'post-scan-reconciliation-failed', raceRetry)
      }
    }
  }
  return {
    kind: 'candidate', strategy: 'full', result, journal: cursor,
    ...(fallbackReason ? { fallbackReason } : {})
  }
}

async function retryFullRefresh(request: RefreshRequest, journal: ChangeJournal, reason: string, raceRetry: number): Promise<RefreshOutcome> {
  if (raceRetry < 1) return fullRefresh(request, journal, reason, raceRetry + 1)
  await Promise.all([removeDatabaseFiles(request.partialPath), removeDatabaseFiles(request.publishedPath)])
  throw new Error(`Unable to close the full-scan FSEvents window: ${reason}`)
}

function createIdentityLookup(path: string, target: string): { lookup(path: string): { device: string; inode: string } | undefined; close(): void } {
  const database = new DatabaseSync(path, { readOnly: true })
  const node = database.prepare('SELECT device, inode FROM nodes WHERE path = ?')
  const alias = database.prepare('SELECT device, inode FROM file_aliases WHERE path_key = ?')
  return {
    lookup: (absolutePath) => {
      const direct = node.get(absolutePath) as { device?: string; inode?: string } | undefined
      if (direct?.device && direct.inode) return { device: direct.device, inode: direct.inode }
      const pathKey = relative(target, absolutePath)
      const stored = alias.get(pathKey) as { device?: string; inode?: string } | undefined
      return stored?.device && stored.inode ? { device: stored.device, inode: stored.inode } : undefined
    },
    close: () => database.close()
  }
}

async function cloneIndex(source: string, destination: string): Promise<void> {
  await prepareDatabaseDirectory(destination)
  await removeDatabaseFiles(destination)
  try { await copyFile(source, destination, constants.COPYFILE_FICLONE) }
  catch { await copyFile(source, destination) }
}

async function publishCandidate(partialPath: string, publishedPath: string): Promise<void> {
  const file = await open(partialPath, 'r')
  try { await file.sync() } finally { await file.close() }
  await rename(partialPath, publishedPath)
  const directory = await open(dirname(publishedPath), 'r')
  try { await directory.sync() } finally { await directory.close() }
}

function safeCheckpoint(journal: ChangeJournal, target: string) {
  try { return journal.captureCheckpoint(target) } catch { return undefined }
}

async function validateActiveTarget(manifest: IndexManifest): Promise<string | undefined> {
  try {
    const stats = await lstat(manifest.target)
    if (!stats.isDirectory() || stats.isSymbolicLink()) return 'target-replaced'
    return String(stats.dev) === manifest.targetDevice && String(stats.ino) === manifest.targetInode ? undefined : 'target-replaced'
  } catch { return 'target-unavailable' }
}

function readTotals(path: string): ScanTotals {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const metadata = readMetadata(database)
    return JSON.parse(metadata.totals ?? '{}') as ScanTotals
  } finally { database.close() }
}

function metadataTargetDevice(path: string): string | undefined {
  const database = new DatabaseSync(path, { readOnly: true })
  try { return readMetadata(database).targetDevice }
  finally { database.close() }
}

function metadataRevision(path: string): number {
  const database = new DatabaseSync(path, { readOnly: true })
  try { return Number(readMetadata(database).indexRevision ?? 1) }
  finally { database.close() }
}

async function volumeFor(target: string): Promise<{ capacityBytes: number; freeBytes: number; targetAllocatedBytes: number }> {
  const [value, targetStats] = await Promise.all([statfs(target), lstat(target)])
  return {
    capacityBytes: Number(value.blocks) * Number(value.bsize),
    freeBytes: Number(value.bfree) * Number(value.bsize),
    targetAllocatedBytes: Number(targetStats.blocks) * 512
  }
}

function throwIfCanceled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ScanCanceledError()
}

