import { parentPort } from "node:worker_threads"
import { scanFilesystem, ScanCanceledError, type ScanProgress, type ScanResult } from "./scanner"
import { subscribeScanDiagnostics, type OrbisTimingEvent } from "./diagnostics"

interface WorkerStartMessage {
  readonly type: "start"
  readonly generation: number
  readonly target: string
  readonly partialPath: string
  readonly publishedPath: string
  readonly indexDirectory: string
  readonly startupRoot: boolean
}

interface WorkerCancelMessage { readonly type: "cancel" }
type WorkerMessage = WorkerStartMessage | WorkerCancelMessage

if (!parentPort) throw new Error("Orbis scan worker requires a parent port")
const port = parentPort

let activeAbort: AbortController | undefined
port.on("message", (message: WorkerMessage) => {
  if (message.type === "cancel") {
    activeAbort?.abort()
    return
  }
  activeAbort?.abort()
  activeAbort = new AbortController()
  void run(message, activeAbort)
})

async function run(message: WorkerStartMessage, abort: AbortController): Promise<void> {
  const timings: OrbisTimingEvent[] | undefined = process.env.ORBIS_SCAN_DIAGNOSTICS === "1" ? [] : undefined
  const unsubscribe = timings ? subscribeScanDiagnostics((event) => {
    if (event.generation === message.generation) timings.push(event)
  }) : undefined
  try {
    const result = await scanFilesystem({
      generation: message.generation,
      target: message.target,
      partialPath: message.partialPath,
      publishedPath: message.publishedPath,
      indexDirectory: message.indexDirectory,
      startupRoot: message.startupRoot,
      signal: abort.signal,
      onProgress: (progress) => port.postMessage({ type: "progress", generation: message.generation, progress })
    })
    postDiagnostics(message.generation, timings)
    port.postMessage({ type: "complete", generation: message.generation, result })
  } catch (error) {
    postDiagnostics(message.generation, timings)
    if (error instanceof ScanCanceledError || abort.signal.aborted) {
      port.postMessage({ type: "canceled", generation: message.generation })
    } else {
      port.postMessage({ type: "error", generation: message.generation, error: serializeError(error) })
    }
  } finally {
    unsubscribe?.()
    if (activeAbort === abort) {
      activeAbort = undefined
      port.close()
    }
  }
}

function postDiagnostics(generation: number, timings: readonly OrbisTimingEvent[] | undefined): void {
  if (timings) port.postMessage({ type: "diagnostics", generation, timings })
}

function serializeError(error: unknown): { readonly message: string; readonly code?: string } {
  const message = error instanceof Error ? error.message : String(error)
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") return { message, code: (error as { code: string }).code }
  return { message }
}

export type { WorkerMessage, WorkerStartMessage, ScanProgress, ScanResult }
