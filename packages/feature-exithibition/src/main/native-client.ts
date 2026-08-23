import { EventEmitter } from "node:events"
import { existsSync } from "node:fs"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import { isNativeMessage } from "../shared/contracts"

export class NativeClient extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | undefined
  private sequence = 0
  private stopping = false
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  constructor(private readonly executable: string) { super() }
  start(): void {
    if (this.process) return
    if (!existsSync(this.executable)) throw new Error(`ExithibitionNative was not found at ${this.executable}`)
    const child = spawn(this.executable, [], { stdio: ["pipe", "pipe", "pipe"] })
    this.process = child
    createInterface({ input: child.stdout }).on("line", (line) => this.receive(line))
    child.stderr.on("data", (chunk) => this.emit("diagnostic", String(chunk)))
    child.on("error", (error) => this.fail(error))
    child.on("exit", (code, signal) => { this.process = undefined; if (!this.stopping) this.fail(new Error(`ExithibitionNative exited unexpectedly (${signal ?? code ?? "unknown"})`)) })
  }
  invoke(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const child = this.process
    if (!child) return Promise.reject(new Error("Native telemetry is not running"))
    const id = `native-${++this.sequence}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Native command timed out: ${type}`)) }, 10_000)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, type, payload })}\n`)
    })
  }
  async stop(): Promise<void> {
    this.stopping = true
    const child = this.process
    if (!child) return
    try { await this.invoke("shutdown") } catch {}
    child.stdin.end()
    setTimeout(() => child.kill("SIGTERM"), 1_000).unref()
    this.process = undefined
  }
  private receive(line: string): void {
    let message: unknown
    try { message = JSON.parse(line) } catch { this.emit("protocol-error", new Error("Native process emitted malformed JSON")); return }
    if (!isNativeMessage(message)) { this.emit("protocol-error", new Error("Native process emitted an invalid message")); return }
    if (message.type === "event") { this.emit("event", { type: message.event, payload: message.payload }); return }
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer); this.pending.delete(message.id)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(message.error?.message ?? "Native command failed"))
  }
  private fail(error: Error): void { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }; this.pending.clear(); this.emit("fatal", error) }
}
