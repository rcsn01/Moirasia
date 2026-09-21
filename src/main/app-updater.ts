import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { idleUpdateState, type UpdateState } from '../shared/contracts'
import { compareSemver, parseSemver } from '../shared/semver'

export const GITHUB_UPDATE_FEED = { owner: 'rcsn01', repo: 'Moirasia' } as const

export interface AppUpdaterResponse {
  readonly ok: boolean
  readonly status: number
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface AppUpdaterHost {
  currentVersion(): string
  packaged(): boolean
  downloadsDirectory(): string
  fetch(url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<AppUpdaterResponse>
  writeFile(path: string, data: Uint8Array): Promise<void>
  openPath(path: string): Promise<string>
  openExternal(url: string): Promise<void>
}

interface ReleaseAssets {
  readonly version: string
  readonly releaseUrl: string
  readonly notes?: string
  readonly dmgName: string
  readonly dmgUrl: string
  readonly checksumUrl: string
}

const API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Moirasia',
  'X-GitHub-Api-Version': '2022-11-28'
}

/** Owns GitHub Release checks and checksummed ARM64 DMG download for the shell Updates UI. */
export class AppUpdater {
  #state: UpdateState
  #assets: ReleaseAssets | undefined
  #listeners = new Set<(state: UpdateState) => void>()
  #checkPromise: Promise<UpdateState> | undefined
  #downloadPromise: Promise<UpdateState> | undefined

  constructor(private readonly host: AppUpdaterHost, private readonly feed = GITHUB_UPDATE_FEED) {
    this.#state = idleUpdateState(host.currentVersion())
  }

  state(): UpdateState { return { ...this.#state } }
  subscribe(listener: (state: UpdateState) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  async check(): Promise<UpdateState> {
    if (this.#downloadPromise) return this.state()
    if (this.#checkPromise) return this.#checkPromise
    this.#checkPromise = this.#runCheck().finally(() => { this.#checkPromise = undefined })
    return this.#checkPromise
  }

  async download(): Promise<UpdateState> {
    if (this.#downloadPromise) return this.#downloadPromise
    if (this.#checkPromise) await this.#checkPromise
    this.#downloadPromise = this.#runDownload().finally(() => { this.#downloadPromise = undefined })
    return this.#downloadPromise
  }

  async openRelease(): Promise<void> {
    const url = this.#state.releaseUrl ?? `https://github.com/${this.feed.owner}/${this.feed.repo}/releases/latest`
    await this.host.openExternal(url)
  }

  async #runCheck(): Promise<UpdateState> {
    this.#set({ status: 'checking', currentVersion: this.host.currentVersion(), canDownload: false })
    try {
      const url = `https://api.github.com/repos/${this.feed.owner}/${this.feed.repo}/releases/latest`
      const response = await this.host.fetch(url, { headers: API_HEADERS, signal: AbortSignal.timeout(20_000) })
      const body = await response.text()
      if (!response.ok) return this.#fail(githubError(body, response.status))
      const assets = parseRelease(body)
      this.#assets = assets
      const currentVersion = this.host.currentVersion()
      if (compareSemver(assets.version, currentVersion) <= 0) {
        return this.#set({
          status: 'up-to-date',
          currentVersion,
          latestVersion: assets.version,
          releaseUrl: assets.releaseUrl,
          ...(assets.notes ? { notes: assets.notes } : {}),
          canDownload: false
        })
      }
      return this.#set({
        status: 'available',
        currentVersion,
        latestVersion: assets.version,
        releaseUrl: assets.releaseUrl,
        ...(assets.notes ? { notes: assets.notes } : {}),
        canDownload: this.host.packaged()
      })
    } catch (error) {
      this.#assets = undefined
      return this.#fail(message(error))
    }
  }

  async #runDownload(): Promise<UpdateState> {
    const assets = this.#assets
    if (!assets) return this.#fail('No update is available to download.')
    if (!this.host.packaged()) return this.#fail('Download the installer from a packaged Moirasia release.')
    const currentVersion = this.host.currentVersion()
    this.#set({
      status: 'downloading',
      currentVersion,
      latestVersion: assets.version,
      releaseUrl: assets.releaseUrl,
      ...(assets.notes ? { notes: assets.notes } : {}),
      progress: 0,
      canDownload: false
    })
    try {
      const checksumResponse = await this.host.fetch(assets.checksumUrl, { signal: AbortSignal.timeout(20_000) })
      if (!checksumResponse.ok) return this.#fail(`Could not download the installer checksum (${checksumResponse.status}).`)
      const expected = parseChecksum(await checksumResponse.text(), assets.dmgName)
      const dmgResponse = await this.host.fetch(assets.dmgUrl, { signal: AbortSignal.timeout(5 * 60_000) })
      if (!dmgResponse.ok) return this.#fail(`Could not download the installer (${dmgResponse.status}).`)
      const bytes = new Uint8Array(await dmgResponse.arrayBuffer())
      this.#set({
        status: 'downloading',
        currentVersion,
        latestVersion: assets.version,
        releaseUrl: assets.releaseUrl,
        ...(assets.notes ? { notes: assets.notes } : {}),
        progress: 1,
        canDownload: false
      })
      const digest = createHash('sha256').update(bytes).digest('hex')
      if (digest !== expected) return this.#fail('The downloaded installer did not match its SHA-256 checksum.')
      const destination = join(this.host.downloadsDirectory(), assets.dmgName)
      await this.host.writeFile(destination, bytes)
      const openError = await this.host.openPath(destination)
      if (openError) return this.#fail(openError)
      return this.#set({
        status: 'ready',
        currentVersion,
        latestVersion: assets.version,
        releaseUrl: assets.releaseUrl,
        ...(assets.notes ? { notes: assets.notes } : {}),
        canDownload: false
      })
    } catch (error) {
      return this.#fail(message(error))
    }
  }

  #fail(error: string): UpdateState {
    return this.#set({
      status: 'error',
      currentVersion: this.host.currentVersion(),
      ...(this.#assets ? { latestVersion: this.#assets.version, releaseUrl: this.#assets.releaseUrl, ...(this.#assets.notes ? { notes: this.#assets.notes } : {}) } : {}),
      error,
      canDownload: Boolean(this.#assets) && this.host.packaged()
    })
  }

  #set(state: UpdateState): UpdateState {
    this.#state = { ...state }
    const snapshot = this.state()
    for (const listener of this.#listeners) listener(snapshot)
    return snapshot
  }
}

function parseRelease(body: string): ReleaseAssets {
  let payload: unknown
  try { payload = JSON.parse(body) as unknown }
  catch { throw new Error('GitHub returned an invalid release payload.') }
  if (!payload || typeof payload !== 'object') throw new Error('GitHub returned an invalid release payload.')
  const record = payload as Record<string, unknown>
  const tag = typeof record.tag_name === 'string' ? record.tag_name : ''
  const version = versionFromTag(tag)
  if (!version) throw new Error('The latest GitHub Release is not a semantic version.')
  const releaseUrl = typeof record.html_url === 'string' && record.html_url ? record.html_url : undefined
  if (!releaseUrl) throw new Error('The latest GitHub Release is missing a page URL.')
  const assets = Array.isArray(record.assets) ? record.assets : []
  const dmgName = `Moirasia-${version}-arm64.dmg`
  const dmg = findAsset(assets, dmgName)
  const checksum = findAsset(assets, `${dmgName}.sha256`)
  if (!dmg) throw new Error('The latest GitHub Release does not include an ARM64 DMG.')
  if (!checksum) throw new Error('The latest GitHub Release does not include a SHA-256 checksum.')
  const notes = typeof record.body === 'string' && record.body.trim() ? record.body.trim() : undefined
  return { version, releaseUrl, ...(notes ? { notes } : {}), dmgName, dmgUrl: dmg, checksumUrl: checksum }
}

function findAsset(assets: unknown[], name: string): string | undefined {
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object') continue
    const record = asset as Record<string, unknown>
    if (record.name === name && typeof record.browser_download_url === 'string' && record.browser_download_url) return record.browser_download_url
  }
  return undefined
}

function versionFromTag(tag: string): string | undefined {
  const value = tag.startsWith('v') ? tag.slice(1) : tag
  return parseSemver(value) ? value : undefined
}

function parseChecksum(text: string, filename: string): string {
  const line = text.trim().split(/\r?\n/, 1)[0] ?? ''
  const match = /^([a-fA-F0-9]{64})(?:\s+\*?(\S+))?$/.exec(line)
  if (!match) throw new Error('The installer checksum file is malformed.')
  const digest = match[1]
  const named = match[2]
  if (!digest) throw new Error('The installer checksum file is malformed.')
  if (named && named !== filename && named !== `./${filename}`) throw new Error('The installer checksum file does not match the ARM64 DMG.')
  return digest.toLowerCase()
}

function githubError(body: string, status: number): string {
  try {
    const payload = JSON.parse(body) as { message?: unknown }
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim()
  } catch { /* Use the status code. */ }
  return `GitHub returned ${status}.`
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
