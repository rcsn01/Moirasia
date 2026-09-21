import { idleUpdateState, type UpdateState } from '../shared/contracts'
import { compareSemver, parseSemver } from '../shared/semver'

export const GITHUB_UPDATE_FEED = { owner: 'rcsn01', repo: 'Moirasia' } as const

export interface AppUpdaterResponse {
  readonly ok: boolean
  readonly status: number
  text(): Promise<string>
}

export interface AppUpdaterHost {
  currentVersion(): string
  fetch(url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<AppUpdaterResponse>
  openExternal(url: string): Promise<void>
}

interface ReleaseInfo {
  readonly version: string
  readonly releaseUrl: string
  readonly notes?: string
}

const API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Moirasia',
  'X-GitHub-Api-Version': '2022-11-28'
}

/** Owns GitHub Release checks for the shell Updates UI. Opening a release uses the system browser. */
export class AppUpdater {
  #state: UpdateState
  #listeners = new Set<(state: UpdateState) => void>()
  #checkPromise: Promise<UpdateState> | undefined

  constructor(private readonly host: AppUpdaterHost, private readonly feed = GITHUB_UPDATE_FEED) {
    this.#state = idleUpdateState(host.currentVersion())
  }

  state(): UpdateState { return { ...this.#state } }
  subscribe(listener: (state: UpdateState) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  async check(): Promise<UpdateState> {
    if (this.#checkPromise) return this.#checkPromise
    this.#checkPromise = this.#runCheck().finally(() => { this.#checkPromise = undefined })
    return this.#checkPromise
  }

  async openRelease(): Promise<void> {
    const url = this.#state.releaseUrl ?? `https://github.com/${this.feed.owner}/${this.feed.repo}/releases/latest`
    await this.host.openExternal(url)
  }

  async #runCheck(): Promise<UpdateState> {
    this.#set({ status: 'checking', currentVersion: this.host.currentVersion() })
    try {
      const url = `https://api.github.com/repos/${this.feed.owner}/${this.feed.repo}/releases/latest`
      const response = await this.host.fetch(url, { headers: API_HEADERS, signal: AbortSignal.timeout(20_000) })
      const body = await response.text()
      if (!response.ok) return this.#fail(githubError(body, response.status))
      const release = parseRelease(body)
      const currentVersion = this.host.currentVersion()
      if (compareSemver(release.version, currentVersion) <= 0) {
        return this.#set({
          status: 'up-to-date',
          currentVersion,
          latestVersion: release.version,
          releaseUrl: release.releaseUrl,
          ...(release.notes ? { notes: release.notes } : {})
        })
      }
      return this.#set({
        status: 'available',
        currentVersion,
        latestVersion: release.version,
        releaseUrl: release.releaseUrl,
        ...(release.notes ? { notes: release.notes } : {})
      })
    } catch (error) {
      return this.#fail(message(error))
    }
  }

  #fail(error: string): UpdateState {
    return this.#set({ status: 'error', currentVersion: this.host.currentVersion(), ...(this.#state.releaseUrl ? { releaseUrl: this.#state.releaseUrl } : {}), error })
  }

  #set(state: UpdateState): UpdateState {
    this.#state = { ...state }
    const snapshot = this.state()
    for (const listener of this.#listeners) listener(snapshot)
    return snapshot
  }
}

function parseRelease(body: string): ReleaseInfo {
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
  const notes = typeof record.body === 'string' && record.body.trim() ? record.body.trim() : undefined
  return { version, releaseUrl, ...(notes ? { notes } : {}) }
}

function versionFromTag(tag: string): string | undefined {
  const value = tag.startsWith('v') ? tag.slice(1) : tag
  return parseSemver(value) ? value : undefined
}

function githubError(body: string, status: number): string {
  try {
    const payload = JSON.parse(body) as { message?: unknown }
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim()
  } catch { /* Use the status code. */ }
  return `GitHub returned ${status}.`
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
