export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'error'

export interface UpdateState {
  readonly status: UpdateStatus
  readonly currentVersion: string
  readonly latestVersion?: string
  readonly releaseUrl?: string
  readonly notes?: string
  readonly error?: string
}

export function idleUpdateState(currentVersion = ''): UpdateState {
  return { status: 'idle', currentVersion }
}

export interface GitHubReleaseFeed {
  readonly owner: string
  readonly repo: string
  readonly userAgent: string
}

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

export interface GitHubUpdatesApi {
  getUpdateState(): Promise<UpdateState>
  checkForUpdate(): Promise<UpdateState>
  openReleasePage(): Promise<void>
  onUpdateState(listener: (state: UpdateState) => void): () => void
}

export interface GitHubUpdaterChannels {
  readonly getState: string
  readonly check: string
  readonly openRelease: string
  readonly state: string
}

export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
}

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export interface Semver {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
}

export function parseSemver(version: string): Semver | undefined {
  const match = SEMVER.exec(version)
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? []
  }
}

export function compareSemver(leftVersion: string, rightVersion: string): number {
  const left = parseSemver(leftVersion)
  const right = parseSemver(rightVersion)
  if (!left || !right) throw new TypeError('Cannot compare invalid semantic versions.')

  for (const key of ['major', 'minor', 'patch'] as const) {
    const difference = left[key] - right[key]
    if (difference !== 0) return Math.sign(difference)
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1

  const identifierCount = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue

    const leftIsNumber = /^\d+$/.test(leftIdentifier)
    const rightIsNumber = /^\d+$/.test(rightIdentifier)
    if (leftIsNumber && rightIsNumber) return Math.sign(Number(leftIdentifier) - Number(rightIdentifier))
    if (leftIsNumber) return -1
    if (rightIsNumber) return 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }

  return 0
}

export function githubUpdaterChannels(prefix: string): GitHubUpdaterChannels {
  return {
    getState: `${prefix}:updater:get-state`,
    check: `${prefix}:updater:check`,
    openRelease: `${prefix}:updater:open-release`,
    state: `${prefix}:updater:state`
  }
}

export function createGitHubUpdatesBridge(renderer: IpcRendererLike, prefix: string): GitHubUpdatesApi {
  const channels = githubUpdaterChannels(prefix)
  return {
    getUpdateState: () => renderer.invoke(channels.getState) as Promise<UpdateState>,
    checkForUpdate: () => renderer.invoke(channels.check) as Promise<UpdateState>,
    openReleasePage: () => renderer.invoke(channels.openRelease) as Promise<void>,
    onUpdateState(listener) {
      const handler = (_event: unknown, value: unknown): void => listener(value as UpdateState)
      renderer.on(channels.state, handler)
      return () => { renderer.removeListener(channels.state, handler) }
    }
  }
}

interface ReleaseInfo {
  readonly version: string
  readonly releaseUrl: string
  readonly notes?: string
}

/** Owns GitHub Release checks for a product Updates UI. Opening a release uses the system browser. */
export class AppUpdater {
  #state: UpdateState
  #listeners = new Set<(state: UpdateState) => void>()
  #checkPromise: Promise<UpdateState> | undefined

  constructor(private readonly host: AppUpdaterHost, private readonly feed: GitHubReleaseFeed) {
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
      const response = await this.host.fetch(url, { headers: apiHeaders(this.feed.userAgent), signal: AbortSignal.timeout(20_000) })
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

function apiHeaders(userAgent: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': userAgent,
    'X-GitHub-Api-Version': '2022-11-28'
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
