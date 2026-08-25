import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from "vitest"
import {
  BulkExactMetadataSource,
  loadNativeMetadataAddon,
  loadNativeOrbisAddon,
  type NativeMetadataAddon,
  type NativeDirectoryCursor,
  type ScanStats
} from "../packages/feature-orbis/src/main/scan-metadata"
import type { ScanFileSystem } from "../packages/feature-orbis/src/main/legacy-scanner"

function stats(kind: "directory" | "file", blocks: number, inode: number): ScanStats {
  return {
    blocks,
    dev: 7,
    ino: inode,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => false
  }
}

describe("Orbis scan metadata adapters", () => {
  it("maps native bulk pages and preserves native counters", async () => {
    const cursor: NativeDirectoryCursor = {
      readPage: vi.fn(() => ({
        entries: [
          { name: "folder", kind: "directory", device: "7", inode: "2", allocatedBytes: 512, mountPoint: false, errorCode: null },
          { name: "unreadable", kind: "other", device: "", inode: "", allocatedBytes: 0, mountPoint: false, errorCode: 13 }
        ],
        done: true,
        bulkEntries: 2,
        fallbackEntries: 0
      })),
      close: vi.fn()
    }
    const addon: NativeMetadataAddon = { openDirectory: vi.fn(() => cursor) }
    const fileSystem = minimalFileSystem()
    const source = new BulkExactMetadataSource(addon, fileSystem)
    const page = await (await source.open("/target", "/target")).readPage(32, new AbortController().signal)

    expect(page.bulkEntries).toBe(2)
    expect(page.fallbackEntries).toBe(0)
    expect(page.entries[0]).toMatchObject({ name: "folder", kind: "directory", allocatedBytes: 512 })
    expect(page.entries[1]?.error).toBeInstanceOf(Error)
  })

  it('can disable bulk metadata without disabling the FSEvents addon API', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orbis-native-loader-'))
    const addonPath = join(directory, 'addon.cjs')
    await writeFile(addonPath, `module.exports = {
      openDirectory() {}, captureVolumeCheckpoint() {}, readChanges() {}
    }\n`)
    const previous = process.env.ORBIS_DISABLE_BULK_METADATA
    process.env.ORBIS_DISABLE_BULK_METADATA = '1'
    try {
      expect(await loadNativeMetadataAddon(addonPath)).toBeUndefined()
      expect(await loadNativeOrbisAddon(addonPath)).toMatchObject({
        openDirectory: expect.any(Function), captureVolumeCheckpoint: expect.any(Function), readChanges: expect.any(Function)
      })
    } finally {
      if (previous === undefined) delete process.env.ORBIS_DISABLE_BULK_METADATA
      else process.env.ORBIS_DISABLE_BULK_METADATA = previous
      await rm(directory, { recursive: true, force: true })
    }
  })

})

function minimalFileSystem(): ScanFileSystem {
  return {
    lstat: async () => stats("directory", 1, 1),
    readdir: async () => [],
    statfs: async () => ({ blocks: 1, bfree: 1, bsize: 512 }),
    realpath: async (path) => path
  }
}
