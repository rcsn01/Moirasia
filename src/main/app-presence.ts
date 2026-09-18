import { spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync, unlinkSync } from 'node:fs'
import { app, Menu, nativeImage, Tray } from 'electron'
import type { AppPresenceMode } from '../shared/contracts'
import { moirasiaHostSocketPath } from './paths'

interface NativeMenuBarHostOptions {
  readonly executable: string
  readonly applicationPath: string
  readonly pidPath?: string
  readonly featureServicePath?: string
  readonly userData?: string
  readonly iconPath?: string
  readonly bondedHelperPath?: string
  readonly shoutDriverPath?: string
}

export class AppPresence {
  #mode: AppPresenceMode = 'dock'
  #tray: Tray | undefined
  #nativeHost = false
  #spawnedHostPid: number | undefined

  constructor(private readonly options: { menuBarIconPath: string; open(): void; quit?(): void; nativeHost?: NativeMenuBarHostOptions }) {}

  get mode(): AppPresenceMode { return this.#mode }
  get usesNativeHost(): boolean { return Boolean(this.options.nativeHost?.featureServicePath && this.options.nativeHost.userData) }

  apply(mode: AppPresenceMode): void {
    this.#mode = mode
    if (this.usesNativeHost) {
      if (!this.#installNativeHost() && app.isPackaged === true) throw new Error('MoirasiaHost.app is not available in this package.')
      this.#removeTray()
      if (mode === 'menu-bar') app.dock?.hide()
      else if (app.dock) void app.dock.show()
      return
    }
    if (mode === 'menu-bar') {
      if (!this.#installNativeHost()) this.#installTray()
      app.dock?.hide()
      return
    }
    this.#removeMenuBarPresence()
    if (app.dock) void app.dock.show()
  }

  /** Wait until a newly started native host has published its authenticated endpoint. */
  async waitForNativeHost(timeoutMs = 5_000): Promise<boolean> {
    if (!this.usesNativeHost) return false
    this.#installNativeHost()
    const host = this.options.nativeHost!
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (host.userData && existsSync(`${host.userData}/runtime/client.token`) && existsSync(moirasiaHostSocketPath(host.userData))) return true
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return false
  }

  /** Relinquish ownership when Electron exits; the native host remains persistent. */
  preserveNativeHost(): void {
    if (this.usesNativeHost) return
    this.#nativeHost = false
    this.#spawnedHostPid = undefined
  }

  dispose(): void { this.#removeMenuBarPresence() }

  #installNativeHost(): boolean {
    const host = this.options.nativeHost
    if (!host || !existsSync(host.executable)) return false
    if (this.#nativeHost) return true
    if (this.usesNativeHost && host.userData && existsSync(`${host.userData}/runtime/client.token`) && existsSync(moirasiaHostSocketPath(host.userData))) {
      this.#nativeHost = true
      return true
    }
    const featureArgs = [
      ...(host.bondedHelperPath ? ['--bonded-helper', host.bondedHelperPath] : []),
      ...(host.shoutDriverPath ? ['--shout-driver', host.shoutDriverPath] : [])
    ]
    const args = this.usesNativeHost
      ? ['--host', '--application', host.applicationPath, '--user-data', host.userData!, '--feature-service', host.featureServicePath!, '--icon', host.iconPath ?? this.options.menuBarIconPath, '--presence', this.#mode, ...featureArgs]
      : ['menu-host', host.applicationPath, this.options.menuBarIconPath, host.pidPath!]
    const hostLogPath = process.env.MOIRASIA_HOST_LOG
    const child = spawn(host.executable, args, hostLogPath
      ? { detached: true, stdio: ['ignore', openSync(hostLogPath, 'a'), openSync(hostLogPath, 'a')] }
      : { detached: true, stdio: 'ignore' })
    child.once('error', (error) => {
      this.#nativeHost = false
      this.#spawnedHostPid = undefined
      console.error('Could not start the native Moirasia menu host', error)
      if (!this.usesNativeHost && this.#mode === 'menu-bar') this.#installTray()
    })
    child.unref()
    this.#spawnedHostPid = child.pid
    this.#nativeHost = true
    return true
  }

  #installTray(): void {
    if (this.#tray) return
    const image = nativeImage.createFromPath(this.options.menuBarIconPath)
    if (image.isEmpty()) throw new Error(`Moirasia menu bar icon could not be loaded from ${this.options.menuBarIconPath}.`)
    image.setTemplateImage(true)
    this.#tray = new Tray(image)
    this.#tray.setToolTip('Moirasia')
    this.#tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Moirasia', click: this.options.open },
      { type: 'separator' },
      { label: 'Quit Moirasia', click: this.options.quit ?? (() => app.quit()) }
    ]))
    this.#tray.on('click', this.options.open)
  }

  #removeTray(): void {
    this.#tray?.destroy()
    this.#tray = undefined
  }

  #removeMenuBarPresence(): void {
    this.#removeTray()
    if (this.usesNativeHost) return
    if (!this.#nativeHost) return
    this.#nativeHost = false
    const spawnedPid = this.#spawnedHostPid
    this.#spawnedHostPid = undefined
    const pidPath = this.options.nativeHost?.pidPath
    if (!pidPath) return
    try {
      const value = readFileSync(pidPath, 'utf8').trim()
      if (!/^\d+$/.test(value)) throw new Error('Invalid menu host pid')
      process.kill(Number(value), 'SIGTERM')
    } catch (error) {
      if (spawnedPid) {
        try { process.kill(spawnedPid, 'SIGTERM'); return } catch { /* Report the original pid-file error below. */ }
      }
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'ENOENT' && code !== 'ESRCH') console.error('Could not stop the Moirasia menu host', error)
      try { unlinkSync(pidPath) } catch { /* The host may already have removed it. */ }
    }
  }
}
