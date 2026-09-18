import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const executable = valueArgument('--app=') ?? join(root, 'release', 'mac-arm64', 'Moirasia.app', 'Contents', 'MacOS', 'Moirasia')
const output = valueArgument('--output=')
const enabled = new Set((valueArgument('--features=') ?? '').split(',').filter(Boolean))
const nativeIdle = process.argv.includes('--native-idle')
const panel = valueArgument('--panel=')
if (panel && !enabled.has(panel)) throw new Error('--panel must name a feature enabled with --features')
const directory = await mkdtemp(join(tmpdir(), 'moirasia-memory-'))
const reportPath = join(directory, 'reports.jsonl')
await writeFile(join(directory, 'settings.json'), JSON.stringify({
  version: 4,
  launchAtLogin: false,
  appPresence: 'menu-bar',
  pendingLoginItems: {},
  features: { amove: enabled.has('amove'), bonded: enabled.has('bonded'), shout: enabled.has('shout') }
}), 'utf8')

const child = spawn(executable, [
  `--user-data-dir=${directory}`,
  `--memory-diagnostics=${reportPath}`,
  nativeIdle ? '--memory-benchmark-native-idle' : panel ? `--memory-benchmark-panel=${panel}` : '--memory-benchmark'
], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AMOVE_DISABLE_NATIVE_HOTKEYS: '1', ELECTRON_ENABLE_LOGGING: '1' } })
let stdout = ''
let stderr = ''
child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
const startedAt = Date.now()
child.on('exit', (code, signal) => { stderr += `\n[app exit] code=${code} signal=${signal} at ${Date.now() - startedAt}ms` })

try {
  await waitForAlive(child, 4_000)
  const [open] = await waitForReports(reportPath, 1, 10_000)
  const openRss = processRss(child.pid, open.processes.map((metric) => metric.pid))
  const openFootprint = physicalFootprint(openRss.pids)
  if (panel) {
    const unmountedReports = await waitForReports(reportPath, 2, 14_000)
    const unmounted = unmountedReports[1]
    const unmountedRss = processRss(child.pid, unmounted.processes.map((metric) => metric.pid))
    const unmountedFootprint = physicalFootprint(unmountedRss.pids)
    const suspendedReports = await waitForReports(reportPath, 3, 10_000)
    const suspended = suspendedReports[2]
    const suspendedRss = processRss(child.pid, suspended.processes.map((metric) => metric.pid))
    const suspendedFootprint = physicalFootprint(suspendedRss.pids)
    const result = {
      executable,
      features: [...enabled],
      panel,
      panelActive: summarize(open, openRss, openFootprint),
      panelUnmounted: summarize(unmounted, unmountedRss, unmountedFootprint),
      suspended: summarize(suspended, suspendedRss, suspendedFootprint),
      reduction: {
        unmountPhysicalFootprintMiB: roundBytes(openFootprint - unmountedFootprint),
        suspendPhysicalFootprintMiB: roundBytes(unmountedFootprint - suspendedFootprint)
      }
    }
    const text = `${JSON.stringify(result, null, 2)}\n`
    if (output) await writeFile(resolve(output), text, 'utf8')
    process.stdout.write(text)
  } else if (nativeIdle) {
    await waitForExit(child, 12_000)
    // The feature services are native now: measure the resident host + service.
    const nativePids = nativeSuitePids()
    if (nativePids.length === 0) throw new Error('No resident MoirasiaHost/MoirasiaFeatureService processes were found after the UI exited.')
    const idleRss = processRss(nativePids[0], nativePids)
    const idleFootprint = physicalFootprint(idleRss.pids)
    const result = {
      executable,
      features: [...enabled],
      open: summarize(open, openRss, openFootprint),
      nativeIdle: { aggregateRssMiB: roundMiB(idleRss.totalKb), physicalFootprintMiB: roundBytes(idleFootprint), processes: idleRss.rows },
      reduction: { aggregateRssMiB: roundMiB(openRss.totalKb - idleRss.totalKb), physicalFootprintMiB: roundBytes(openFootprint - idleFootprint) }
    }
    const text = `${JSON.stringify(result, null, 2)}\n`
    if (output) await writeFile(resolve(output), text, 'utf8')
    process.stdout.write(text)
    process.exitCode = 0
  } else {
    const reports = await waitForReports(reportPath, 2, 12_000)
    const suspended = reports[1]
    const suspendedRss = processRss(child.pid, suspended.processes.map((metric) => metric.pid))
    const suspendedFootprint = physicalFootprint(suspendedRss.pids)
    const result = {
      executable,
      features: [...enabled],
      open: summarize(open, openRss, openFootprint),
      suspended: summarize(suspended, suspendedRss, suspendedFootprint),
      reduction: {
        aggregateRssMiB: roundMiB(openRss.totalKb - suspendedRss.totalKb),
        physicalFootprintMiB: roundBytes(openFootprint - suspendedFootprint),
        electronWorkingSetMiB: roundMiB(totalWorkingSet(open) - totalWorkingSet(suspended))
      }
    }
    const text = `${JSON.stringify(result, null, 2)}\n`
    if (output) await writeFile(resolve(output), text, 'utf8')
    process.stdout.write(text)
  }
} finally {
  for (const pid of nativeSuitePids()) { try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ } }
  child.kill('SIGTERM')
  await Promise.race([new Promise((resolveExit) => child.once('exit', resolveExit)), delay(3_000)])
  if (child.exitCode === null) child.kill('SIGKILL')
}

function summarize(report, rss, footprint) {
  return {
    aggregateRssMiB: roundMiB(rss.totalKb),
    physicalFootprintMiB: roundBytes(footprint),
    electronWorkingSetMiB: roundMiB(totalWorkingSet(report)),
    processes: report.processes.map((metric) => ({ pid: metric.pid, type: metric.type, workingSetMiB: roundMiB(metric.memory.workingSetSize) })),
    externalProcesses: rss.rows.filter(({ pid }) => !report.processes.some((metric) => metric.pid === pid)),
    webContents: report.webContents,
    windows: report.windows
  }
}

function totalWorkingSet(report) { return report.processes.reduce((total, metric) => total + metric.memory.workingSetSize, 0) }
function roundMiB(kibibytes) { return Math.round((kibibytes / 1024) * 10) / 10 }
function roundBytes(bytes) { return Math.round((bytes / 1024 / 1024) * 10) / 10 }
function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)) }
function valueArgument(prefix) { return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) }

function nativeSuitePids() {
  const result = spawnSync('pgrep', ['-f', 'MoirasiaHost.app/Contents/MacOS/MoirasiaHost|MoirasiaFeatureService.app/Contents/MacOS/MoirasiaFeatureService'], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim().split('\n').filter(Boolean).map(Number) : []
}

async function waitForExit(child, timeout) {
  if (child.exitCode !== null) return
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    delay(timeout).then(() => { throw new Error(`Moirasia did not exit its idle Electron UI: ${stderr}`) })
  ])
}

async function waitForAlive(child, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Moirasia exited early (${child.exitCode}): ${stderr}`)
    if (processRss(child.pid).pids.length > 1) return
    await delay(100)
  }
  throw new Error(`Moirasia did not finish launching: ${stderr}`)
}

async function waitForReports(path, count, timeout = 6_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const reports = (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      if (reports.length >= count) return reports
    } catch (error) { /* Report file is created on the first signal. */ }
    await delay(100)
  }
  const alive = child.exitCode === null && child.signalCode === null
  let raw = ''
  try { raw = (await readFile(path, 'utf8')).slice(0, 200) } catch (error) { raw = `(unreadable: ${error?.code ?? error})` }
  const listing = spawnSync('ls', ['-la', dirname(path)], { encoding: 'utf8' })
  throw new Error(`Timed out waiting for ${count} memory reports (appAlive=${alive}, raw=${raw}, dir=${listing.stdout}): stdout=${stdout.slice(0, 2000)} | stderr=${stderr}`)
}

function physicalFootprint(pids) {
  const result = spawnSync('/usr/bin/footprint', ['-f', 'bytes', ...pids.map(String)], { encoding: 'utf8', timeout: 20_000 })
  if (result.status !== 0) throw new Error(result.stderr || 'footprint failed')
  return [...result.stdout.matchAll(/phys_footprint:\s+(\d+) B/g)].reduce((total, match) => total + Number(match[1]), 0)
}

function processRss(rootPid, knownPids = []) {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,rss=,comm='], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || 'ps failed')
  const rows = result.stdout.trim().split('\n').map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
    return match ? { pid: Number(match[1]), parentPid: Number(match[2]), rssKb: Number(match[3]), command: match[4] } : undefined
  }).filter(Boolean)
  const descendants = new Set([rootPid, ...knownPids])
  let changed = true
  while (changed) {
    changed = false
    for (const { pid, parentPid } of rows) {
      if (descendants.has(parentPid) && !descendants.has(pid)) { descendants.add(pid); changed = true }
    }
  }
  const selected = rows.filter(({ pid }) => descendants.has(pid))
  return { pids: [...descendants], rows: selected, totalKb: selected.reduce((total, row) => total + row.rssKb, 0) }
}
