import { createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AppUpdater, type AppUpdaterHost, type AppUpdaterResponse } from '../src/main/app-updater'

const DMG = new Uint8Array([1, 2, 3, 4, 5])
const DIGEST = createHash('sha256').update(DMG).digest('hex')

describe('AppUpdater', () => {
  it('reports up-to-date when the latest release matches the running version', async () => {
    const host = makeHost({ version: '0.1.0', release: githubRelease('0.1.0') })
    const updater = new AppUpdater(host)
    const first = updater.check()
    const second = updater.check()
    const state = await first
    expect(await second).toEqual(state)
    expect(state).toMatchObject({ status: 'up-to-date', currentVersion: '0.1.0', latestVersion: '0.1.0', canDownload: false })
    expect(host.fetch.mock.calls.filter(([url]) => String(url).includes('/releases/latest'))).toHaveLength(1)
  })

  it('exposes a packaged download when a newer ARM64 DMG exists', async () => {
    const host = makeHost({ version: '0.1.0', packaged: true, release: githubRelease('0.2.0') })
    const state = await new AppUpdater(host).check()
    expect(state).toMatchObject({
      status: 'available',
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      releaseUrl: 'https://github.com/rcsn01/Moirasia/releases/tag/v0.2.0',
      notes: 'Release notes',
      canDownload: true
    })
  })

  it('hides download in unpackaged builds and still allows opening the release', async () => {
    const host = makeHost({ version: '0.1.0', packaged: false, release: githubRelease('0.2.0') })
    const updater = new AppUpdater(host)
    const state = await updater.check()
    expect(state.canDownload).toBe(false)
    await updater.openRelease()
    expect(host.openExternal).toHaveBeenCalledWith('https://github.com/rcsn01/Moirasia/releases/tag/v0.2.0')
    const download = await updater.download()
    expect(download).toMatchObject({ status: 'error', error: 'Download the installer from a packaged Moirasia release.' })
    expect(host.writeFile).not.toHaveBeenCalled()
  })

  it('downloads, verifies the checksum, and opens the DMG', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moirasia-updater-'))
    const host = makeHost({ version: '0.1.0', packaged: true, release: githubRelease('0.2.0'), directory })
    const updater = new AppUpdater(host)
    await updater.check()
    const state = await updater.download()
    const destination = join(directory, 'Moirasia-0.2.0-arm64.dmg')
    expect(state.status).toBe('ready')
    expect(host.openPath).toHaveBeenCalledWith(destination)
    expect(await readFile(destination)).toEqual(Buffer.from(DMG))
  })

  it('rejects a checksum mismatch without writing the installer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moirasia-updater-'))
    const host = makeHost({
      version: '0.1.0',
      packaged: true,
      release: githubRelease('0.2.0'),
      directory,
      checksum: `${'a'.repeat(64)}  Moirasia-0.2.0-arm64.dmg\n`
    })
    const updater = new AppUpdater(host)
    await updater.check()
    const state = await updater.download()
    expect(state).toMatchObject({ status: 'error', error: 'The downloaded installer did not match its SHA-256 checksum.', canDownload: true })
    expect(host.writeFile).not.toHaveBeenCalled()
  })

  it('fails when the latest release has no ARM64 DMG', async () => {
    const host = makeHost({
      version: '0.1.0',
      release: {
        tag_name: 'v0.2.0',
        html_url: 'https://github.com/rcsn01/Moirasia/releases/tag/v0.2.0',
        body: '',
        assets: []
      }
    })
    await expect(new AppUpdater(host).check()).resolves.toMatchObject({
      status: 'error',
      error: 'The latest GitHub Release does not include an ARM64 DMG.'
    })
  })

  it('fails on a malformed release tag', async () => {
    const host = makeHost({
      version: '0.1.0',
      release: { tag_name: 'nightly', html_url: 'https://example.test/nightly', assets: [] }
    })
    await expect(new AppUpdater(host).check()).resolves.toMatchObject({
      status: 'error',
      error: 'The latest GitHub Release is not a semantic version.'
    })
  })

  it('surfaces GitHub error messages', async () => {
    const host = makeHost({ version: '0.1.0', latestStatus: 403, latestBody: JSON.stringify({ message: 'API rate limit exceeded' }) })
    await expect(new AppUpdater(host).check()).resolves.toMatchObject({
      status: 'error',
      error: 'API rate limit exceeded'
    })
  })
})

function githubRelease(version: string) {
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/rcsn01/Moirasia/releases/tag/v${version}`,
    body: 'Release notes',
    assets: [
      { name: `Moirasia-${version}-arm64.dmg`, browser_download_url: `https://example.test/${version}.dmg` },
      { name: `Moirasia-${version}-arm64.dmg.sha256`, browser_download_url: `https://example.test/${version}.dmg.sha256` }
    ]
  }
}

function makeHost(options: {
  version: string
  packaged?: boolean
  directory?: string
  release?: unknown
  latestStatus?: number
  latestBody?: string
  checksum?: string
}): AppUpdaterHost & { fetch: ReturnType<typeof vi.fn>; writeFile: ReturnType<typeof vi.fn>; openPath: ReturnType<typeof vi.fn>; openExternal: ReturnType<typeof vi.fn> } {
  const writeFile = vi.fn(async (path: string, data: Uint8Array) => {
    const { writeFile: write } = await import('node:fs/promises')
    await write(path, data)
  })
  const fetch = vi.fn(async (url: string): Promise<AppUpdaterResponse> => {
    if (url.includes('/releases/latest')) {
      const status = options.latestStatus ?? 200
      return response(options.latestBody ?? JSON.stringify(options.release ?? {}), status)
    }
    if (url.endsWith('.sha256')) {
      const version = url.match(/\/(\d+\.\d+\.\d+)\.dmg\.sha256$/)?.[1] ?? '0.2.0'
      return response(options.checksum ?? `${DIGEST}  Moirasia-${version}-arm64.dmg\n`)
    }
    if (url.endsWith('.dmg')) return binary(DMG)
    throw new Error(`Unexpected URL ${url}`)
  })
  return {
    currentVersion: () => options.version,
    packaged: () => options.packaged === true,
    downloadsDirectory: () => options.directory ?? tmpdir(),
    fetch,
    writeFile,
    openPath: vi.fn(async () => ''),
    openExternal: vi.fn(async () => undefined)
  }
}

function response(body: string, status = 200): AppUpdaterResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer
  }
}

function binary(data: Uint8Array): AppUpdaterResponse {
  return {
    ok: true,
    status: 200,
    text: async () => new TextDecoder().decode(data),
    arrayBuffer: async () => {
      const copy = new Uint8Array(data.byteLength)
      copy.set(data)
      return copy.buffer
    }
  }
}
