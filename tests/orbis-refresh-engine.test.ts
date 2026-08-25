import { DatabaseSync } from 'node:sqlite'
import { access, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FSEVENT_FLAGS, type ChangeJournal } from '../packages/feature-orbis/src/main/change-journal'
import type { IndexManifest } from '../packages/feature-orbis/src/main/index-manifest'
import { refreshPersistentIndex } from '../packages/feature-orbis/src/main/refresh-engine'
import { scanFilesystem } from '../packages/feature-orbis/src/main/scanner'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('Orbis refresh engine', () => {
  it('publishes a full baseline and then an exact incremental candidate', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orbis-refresh-'))
    cleanup.push(directory)
    const target = join(directory, 'target')
    const indexes = join(directory, 'indexes')
    await mkdir(join(target, 'a', 'nested'), { recursive: true })
    await mkdir(join(target, 'clean'), { recursive: true })
    await writeFile(join(target, 'a', 'nested', 'file'), Buffer.alloc(512, 1))
    await writeFile(join(target, 'clean', 'stable'), Buffer.alloc(4096, 2))

    const targetStats = await import('node:fs/promises').then(({ lstat }) => lstat(target))
    let phase: 'baseline' | 'incremental' = 'baseline'
    const journal: ChangeJournal = {
      captureCheckpoint: () => ({ device: String(targetStats.dev), journalUuid: 'volume-journal', eventId: '10' }),
      readChanges: () => phase === 'baseline'
        ? { throughEventId: '10', events: [], requiresFullScan: false }
        : { throughEventId: '12', requiresFullScan: false, events: [
          { relativePath: 'a/nested/file', eventId: '11', flags: FSEVENT_FLAGS.itemModified | FSEVENT_FLAGS.itemIsFile },
          { relativePath: 'a/added', eventId: '12', flags: FSEVENT_FLAGS.itemCreated | FSEVENT_FLAGS.itemIsFile }
        ] }
    }
    const baseline = await refreshPersistentIndex({
      generation: 1, target, indexDirectory: indexes, partialPath: join(indexes, 'baseline.partial.sqlite'),
      publishedPath: join(indexes, 'baseline.sqlite'), changeJournal: journal
    })
    expect(baseline).toMatchObject({ kind: 'candidate', strategy: 'full', journal: { uuid: 'volume-journal', eventId: '10' } })
    if (baseline.kind !== 'candidate') throw new Error('Expected a baseline candidate')
    phase = 'incremental'
    await writeFile(join(target, 'a', 'nested', 'file'), Buffer.alloc(16_384, 3))
    await writeFile(join(target, 'a', 'added'), Buffer.alloc(2048, 4))
    const manifest = manifestFor(baseline.result.publishedPath, baseline.journal)
    const updated = await refreshPersistentIndex({
      generation: 2, target, indexDirectory: indexes, partialPath: join(indexes, 'updated.partial.sqlite'),
      publishedPath: join(indexes, 'updated.sqlite'), changeJournal: journal,
      active: { manifest, path: baseline.result.publishedPath }
    })
    expect(updated).toMatchObject({ kind: 'candidate', strategy: 'incremental', journal: { uuid: 'volume-journal', eventId: '12' } })
    if (updated.kind !== 'candidate') throw new Error('Expected an incremental candidate')
    const fresh = await scanFilesystem({
      generation: 3, target, indexDirectory: indexes, partialPath: join(indexes, 'fresh.partial.sqlite'), publishedPath: join(indexes, 'fresh.sqlite')
    })
    expect(rows(updated.result.publishedPath)).toEqual(rows(fresh.publishedPath))
  })

  it('matches a fresh scan after an identity-paired cross-parent directory move', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orbis-refresh-rename-'))
    cleanup.push(directory)
    const target = join(directory, 'target')
    const indexes = join(directory, 'indexes')
    const oldTree = join(target, 'left', 'tree')
    const newTree = join(target, 'right', 'tree')
    await mkdir(join(oldTree, 'nested'), { recursive: true })
    await mkdir(join(target, 'right'), { recursive: true })
    await writeFile(join(oldTree, 'nested', 'file'), Buffer.alloc(4096, 1))
    const baseline = await scanFilesystem({ generation: 1, target, indexDirectory: indexes, partialPath: join(indexes, 'rename-base.partial.sqlite'), publishedPath: join(indexes, 'rename-base.sqlite') })
    await rename(oldTree, newTree)
    await symlink(join(target, 'right'), join(target, 'left', 'ignored-link'))
    const manifest = manifestFor(baseline.publishedPath, { uuid: 'journal', eventId: '20' })
    const journal: ChangeJournal = {
      captureCheckpoint: () => ({ device: manifest.targetDevice, journalUuid: 'journal', eventId: '20' }),
      readChanges: () => ({
        throughEventId: '24', requiresFullScan: false,
        events: [
          { relativePath: 'left/tree', eventId: '21', flags: FSEVENT_FLAGS.itemRenamed | FSEVENT_FLAGS.itemIsDir },
          { relativePath: 'right/tree', eventId: '22', flags: FSEVENT_FLAGS.itemRenamed | FSEVENT_FLAGS.itemIsDir },
          { relativePath: 'left/ignored-link', eventId: '24', flags: FSEVENT_FLAGS.itemCreated | FSEVENT_FLAGS.itemIsFile }
        ]
      })
    }
    const updated = await refreshPersistentIndex({
      generation: 2, target, indexDirectory: indexes, partialPath: join(indexes, 'rename-updated.partial.sqlite'),
      publishedPath: join(indexes, 'rename-updated.sqlite'), active: { manifest, path: baseline.publishedPath }, changeJournal: journal
    })
    expect(updated).toMatchObject({ kind: 'candidate', strategy: 'incremental' })
    if (updated.kind !== 'candidate') throw new Error('Expected an incremental rename candidate')
    const fresh = await scanFilesystem({ generation: 3, target, indexDirectory: indexes, partialPath: join(indexes, 'rename-fresh.partial.sqlite'), publishedPath: join(indexes, 'rename-fresh.sqlite') })
    expect(rows(updated.result.publishedPath)).toEqual(rows(fresh.publishedPath))
    const database = new DatabaseSync(updated.result.publishedPath, { readOnly: true })
    try { expect(database.prepare("SELECT COUNT(*) AS count FROM nodes WHERE path LIKE '%ignored-link%'").get()).toEqual({ count: 0 }) }
    finally { database.close() }
  })

  it('retries a full scan when its post-scan history fence is untrustworthy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orbis-refresh-full-retry-'))
    cleanup.push(directory)
    const target = join(directory, 'target')
    const indexes = join(directory, 'indexes')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'file'), 'value')
    const stats = await import('node:fs/promises').then(({ lstat }) => lstat(target))
    let captures = 0
    let reads = 0
    const journal: ChangeJournal = {
      captureCheckpoint: () => ({ device: String(stats.dev), journalUuid: 'journal', eventId: String(++captures * 10) }),
      readChanges: (_target, cursor) => ++reads === 1
        ? { throughEventId: cursor.eventId, events: [], requiresFullScan: true, reason: 'kernel-dropped' }
        : { throughEventId: String(Number(cursor.eventId) + 1), events: [], requiresFullScan: false }
    }
    const outcome = await refreshPersistentIndex({
      generation: 1, target, indexDirectory: indexes, partialPath: join(indexes, 'retry.partial.sqlite'),
      publishedPath: join(indexes, 'retry.sqlite'), changeJournal: journal
    })
    expect(outcome).toMatchObject({ kind: 'candidate', strategy: 'full', journal: { uuid: 'journal', eventId: '21' }, fallbackReason: 'kernel-dropped' })
    expect(captures).toBe(2)
    expect(reads).toBe(2)
  })

  it('removes an unfenced full candidate after the bounded retry is exhausted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orbis-refresh-full-retry-fail-'))
    cleanup.push(directory)
    const target = join(directory, 'target')
    const indexes = join(directory, 'indexes')
    const publishedPath = join(indexes, 'failed.sqlite')
    await mkdir(target, { recursive: true })
    const stats = await import('node:fs/promises').then(({ lstat }) => lstat(target))
    const journal: ChangeJournal = {
      captureCheckpoint: () => ({ device: String(stats.dev), journalUuid: 'journal', eventId: '10' }),
      readChanges: (_target, cursor) => ({ throughEventId: cursor.eventId, events: [], requiresFullScan: true, reason: 'kernel-dropped' })
    }
    await expect(refreshPersistentIndex({
      generation: 1, target, indexDirectory: indexes, partialPath: join(indexes, 'failed.partial.sqlite'),
      publishedPath, changeJournal: journal
    })).rejects.toThrow('Unable to close the full-scan FSEvents window')
    await expect(access(publishedPath)).rejects.toThrow()
  })

  it('advances only the manifest cursor when no target events exist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orbis-refresh-empty-'))
    cleanup.push(directory)
    const target = join(directory, 'target')
    const indexes = join(directory, 'indexes')
    await mkdir(target, { recursive: true })
    const baseline = await scanFilesystem({ generation: 1, target, indexDirectory: indexes, partialPath: join(indexes, 'base.partial.sqlite'), publishedPath: join(indexes, 'base.sqlite') })
    const manifest = manifestFor(baseline.publishedPath, { uuid: 'journal', eventId: '4' })
    const journal: ChangeJournal = {
      captureCheckpoint: () => ({ device: manifest.targetDevice, journalUuid: 'journal', eventId: '5' }),
      readChanges: () => ({ throughEventId: '9', events: [], requiresFullScan: false })
    }
    const outcome = await refreshPersistentIndex({
      generation: 2, target, indexDirectory: indexes, partialPath: join(indexes, 'unused.partial.sqlite'),
      publishedPath: join(indexes, 'unused.sqlite'), active: { manifest, path: baseline.publishedPath }, changeJournal: journal
    })
    expect(outcome).toEqual({ kind: 'unchanged', strategy: 'incremental', journal: { uuid: 'journal', eventId: '9' }, totals: baseline.totals, basePublicationId: manifest.publicationId })
  })
})

function manifestFor(path: string, journal: IndexManifest['journal']): IndexManifest {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const values = Object.fromEntries((database.prepare('SELECT key, value FROM metadata').all() as unknown as Array<{ key: string; value: string }>).map((row) => [row.key, row.value]))
    return {
      version: 1, publicationId: '00000000-0000-4000-8000-000000000001', indexFile: 'index-00000000-0000-4000-8000-000000000001.sqlite',
      target: values.target!, targetDevice: values.targetDevice!, targetInode: values.targetInode!, schemaVersion: 2,
      indexRevision: Number(values.indexRevision), journal
    }
  } finally { database.close() }
}

function rows(path: string): unknown[] {
  const database = new DatabaseSync(path, { readOnly: true })
  try { return database.prepare('SELECT path, kind, own_bytes, size_bytes, direct_children, descendant_count, unreadable_count FROM nodes ORDER BY path').all() }
  finally { database.close() }
}
