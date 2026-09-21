import { describe, expect, it, vi } from 'vitest'
import { AppUpdater, type AppUpdaterHost, type AppUpdaterResponse } from '../src/main/app-updater'

describe('AppUpdater', () => {
  it('reports up-to-date when the latest release matches the running version', async () => {
    const host = makeHost({ version: '0.1.0', release: githubRelease('0.1.0') })
    const updater = new AppUpdater(host)
    const first = updater.check()
    const second = updater.check()
    const state = await first
    expect(await second).toEqual(state)
    expect(state).toMatchObject({ status: 'up-to-date', currentVersion: '0.1.0', latestVersion: '0.1.0', releaseUrl: 'https://github.com/rcsn01/Moirasia/releases/tag/v0.1.0' })
    expect(host.fetch.mock.calls.filter(([url]) => String(url).includes('/releases/latest'))).toHaveLength(1)
  })

  it('exposes the GitHub release page when a newer version exists', async () => {
    const host = makeHost({ version: '0.1.0', release: githubRelease('0.2.0') })
    const updater = new AppUpdater(host)
    const state = await updater.check()
    expect(state).toMatchObject({
      status: 'available',
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      releaseUrl: 'https://github.com/rcsn01/Moirasia/releases/tag/v0.2.0',
      notes: 'Release notes'
    })
    await updater.openRelease()
    expect(host.openExternal).toHaveBeenCalledWith('https://github.com/rcsn01/Moirasia/releases/tag/v0.2.0')
  })

  it('opens the latest-releases page when no check has run', async () => {
    const host = makeHost({ version: '0.1.0' })
    await new AppUpdater(host).openRelease()
    expect(host.openExternal).toHaveBeenCalledWith('https://github.com/rcsn01/Moirasia/releases/latest')
  })

  it('fails on a malformed release tag', async () => {
    const host = makeHost({
      version: '0.1.0',
      release: { tag_name: 'nightly', html_url: 'https://example.test/nightly' }
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
    body: 'Release notes'
  }
}

function makeHost(options: {
  version: string
  release?: unknown
  latestStatus?: number
  latestBody?: string
}): AppUpdaterHost & { fetch: ReturnType<typeof vi.fn>; openExternal: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn(async (url: string): Promise<AppUpdaterResponse> => {
    if (!url.includes('/releases/latest')) throw new Error(`Unexpected URL ${url}`)
    const status = options.latestStatus ?? 200
    return response(options.latestBody ?? JSON.stringify(options.release ?? {}), status)
  })
  return {
    currentVersion: () => options.version,
    fetch,
    openExternal: vi.fn(async () => undefined)
  }
}

function response(body: string, status = 200): AppUpdaterResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}
