import { app, BrowserWindow, session, webContents } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface MemoryDiagnosticsOptions {
  suspend(): Promise<void>
  closeWindow?(): void
  openPage?(page: string): Promise<void>
}

type MemoryReport = {
  capturedAt: string
  reason: 'requested' | 'panel-active' | 'panel-unmounted' | 'suspended'
  processes: ReturnType<typeof app.getAppMetrics>
  windows: Array<{ id: number; visible: boolean; destroyed: boolean }>
  webContents: Array<{ id: number; type: string; url: string; destroyed: boolean; defaultSession: boolean }>
}

/**
 * Installs opt-in packaged-memory diagnostics. No listener or filesystem work
 * is performed unless --memory-diagnostics=<jsonl path> is present.
 * SIGUSR2 records an ad-hoc snapshot. With --memory-benchmark, installation
 * records the open state, suspends the shell, then records the settled state.
 */
export function installMemoryDiagnostics(options: MemoryDiagnosticsOptions): () => void {
  const reportPath = valueArgument('--memory-diagnostics=')
  if (!reportPath) return () => undefined
  const benchmark = process.argv.includes('--memory-benchmark')
  const nativeIdleBenchmark = process.argv.includes('--memory-benchmark-native-idle')
  const panelBenchmark = valueArgument('--memory-benchmark-panel=')
  let writing = Promise.resolve()
  let benchmarkTimer: NodeJS.Timeout | undefined
  const capture = (reason: MemoryReport['reason']): void => {
    writing = writing.then(async () => {
      const report = createMemoryReport(reason)
      await mkdir(dirname(reportPath), { recursive: true })
      await appendFile(reportPath, `${JSON.stringify(report)}\n`, 'utf8')
    }).catch((error) => console.error('Failed to write memory diagnostics', error))
  }
  const requested = (): void => capture('requested')
  process.on('SIGUSR2', requested)
  if (panelBenchmark) {
    benchmarkTimer = setTimeout(() => {
      void (async () => {
        await options.openPage?.(panelBenchmark)
        await wait(3_000)
        capture('panel-active')
        await writing
        await wait(4_000)
        await options.openPage?.('general')
        await wait(3_000)
        capture('panel-unmounted')
        await writing
        await wait(4_000)
        await options.suspend()
        await wait(3_000)
        capture('suspended')
      })().catch(console.error)
    }, 1_500)
  } else if (nativeIdleBenchmark) {
    benchmarkTimer = setTimeout(() => {
      capture('requested')
      void writing.then(() => new Promise((resolve) => setTimeout(resolve, 4_000))).then(() => options.closeWindow?.()).catch(console.error)
    }, 1_500)
  } else if (benchmark) {
    benchmarkTimer = setTimeout(() => {
      capture('requested')
      void writing.then(() => new Promise((resolve) => setTimeout(resolve, 4_000))).then(() => options.suspend()).catch(console.error)
      benchmarkTimer = setTimeout(() => capture('suspended'), 7_000)
    }, 1_500)
  }
  return () => {
    if (benchmarkTimer) clearTimeout(benchmarkTimer)
    process.removeListener('SIGUSR2', requested)
  }
}

function createMemoryReport(reason: MemoryReport['reason']): MemoryReport {
  return {
    capturedAt: new Date().toISOString(),
    reason,
    processes: app.getAppMetrics(),
    windows: BrowserWindow.getAllWindows().map((window) => ({ id: window.id, visible: window.isVisible(), destroyed: window.isDestroyed() })),
    webContents: webContents.getAllWebContents().map((contents) => ({
      id: contents.id,
      type: contents.getType(),
      url: contents.getURL(),
      destroyed: contents.isDestroyed(),
      defaultSession: contents.session === session.defaultSession
    }))
  }
}

function wait(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }

function valueArgument(prefix: string): string | undefined {
  const argument = process.argv.find((candidate) => candidate.startsWith(prefix))
  const value = argument?.slice(prefix.length)
  return value ? value : undefined
}
