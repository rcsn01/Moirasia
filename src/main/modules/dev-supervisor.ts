import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'

export interface DevelopmentReadiness { readonly manifestPath: string }

export class DevelopmentSupervisor {
  readonly #children = new Map<string, ChildProcess>()
  constructor(private readonly timeoutMs = 30_000) {}

  start(id: string, repository: string): Promise<DevelopmentReadiness> {
    if (this.#children.has(id)) throw new Error(`${id} development watcher is already running`)
    return new Promise((resolveReady, reject) => {
      const child = spawn('npm', ['run', 'module:dev'], {
        cwd: repository,
        env: { ...process.env, MOIRASIA_MODULE_DEV: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      this.#children.set(id, child)
      let settled = false
      const lines = createInterface({ input: child.stdout! })
      const timer = setTimeout(() => finish(new Error(`${id} module:dev did not become ready within ${this.timeoutMs}ms`)), this.timeoutMs)
      timer.unref()
      const finish = (error?: Error, readiness?: DevelopmentReadiness): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        lines.close()
        if (error) {
          this.stop(id)
          reject(error)
        } else resolveReady(readiness!)
      }
      lines.on('line', (line) => {
        if (!line.startsWith('{')) return
        try {
          const message = JSON.parse(line) as Record<string, unknown>
          if (message.type !== 'moirasia-module-ready' || typeof message.manifestPath !== 'string') {
            finish(new Error(`${id} module:dev emitted malformed readiness output`))
          } else finish(undefined, { manifestPath: resolve(repository, message.manifestPath) })
        } catch {
          finish(new Error(`${id} module:dev emitted malformed readiness JSON`))
        }
      })
      child.once('error', (error) => finish(error))
      child.once('exit', (code, signal) => {
        this.#children.delete(id)
        if (!settled) finish(new Error(`${id} module:dev exited before readiness (${signal ?? code})`))
      })
    })
  }

  stop(id: string): void {
    const child = this.#children.get(id)
    if (!child) return
    this.#children.delete(id)
    child.kill('SIGTERM')
  }

  isRunning(id: string): boolean { return this.#children.has(id) }

  stopAll(): void { for (const id of [...this.#children.keys()]) this.stop(id) }
}
