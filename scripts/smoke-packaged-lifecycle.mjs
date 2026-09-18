#!/usr/bin/env node
// Launches the packaged Moirasia.app with a temp user-data directory, verifies
// the native host + feature service processes (LoginItems host, Resources
// service, feature resource arguments), then isolates two lifecycle paths:
//   phase 1 — `host.quitSuite` over the socket must stop the native suite;
//   phase 2 — SIGTERM to Electron must trigger the coordinated teardown too.
import { spawn, spawnSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '..')
const executable = join(root, 'release', 'mac-arm64', 'Moirasia.app', 'Contents', 'MacOS', 'Moirasia')
if (!existsSync(executable)) { console.error('Packaged app missing; run pnpm package:mac first.'); process.exit(1) }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const userData = await mkdtemp(join(tmpdir(), 'moirasia-packaged-'))
const nativeProcessLines = () => {
  const output = spawnSync('pgrep', ['-lf', 'Moirasia'], { encoding: 'utf8' }).stdout
  return output.split('\n').filter((line) => line.includes('MoirasiaHost.app/Contents/MacOS/MoirasiaHost') || line.includes('MoirasiaFeatureService.app/Contents/MacOS/MoirasiaFeatureService'))
}
const waitNativeExit = (pids, timeoutMs) => new Promise(async (resolve) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const alive = pids.filter((pid) => { try { process.kill(pid, 0); return true } catch { return false } })
    if (alive.length === 0) { resolve(true); return }
    await sleep(200)
  }
  resolve(false)
})
const waitNativeSurvive = (pids, timeoutMs) => new Promise(async (resolve) => {
  const started = Date.now()
  let lastAlive = pids.map(() => true)
  while (Date.now() - started < timeoutMs) {
    const alive = pids.map((pid) => { try { process.kill(pid, 0); return true } catch { return false } })
    if (alive.some((value, index) => value !== lastAlive[index])) {
      console.log('processTransition', JSON.stringify(Object.fromEntries(pids.map((pid, index) => [pid, alive[index]]))), `at ${Date.now() - started}ms`)
      lastAlive = alive
    }
    await sleep(200)
  }
  resolve(lastAlive.every(Boolean))
})

let electronProcesses = []
try {
  // The host publishes its socket in the per-user temp dir keyed by a SHA-256
  // hash of the userData path (mirrors moirasiaHostSocketPath in src/main).
  // Electron resolves the userData path (e.g. /var → /private/var) before
  // hashing, so the script must hash the resolved path too.
  const resolvedUserData = realpathSync(userData)
  const socketPath = join(tmpdir().replace(/\/+$/, ''), `moirasia-host-${createHash('sha256').update(resolvedUserData, 'utf8').digest('hex').slice(0, 16)}.sock`)
  const tokenPath = join(userData, 'runtime', 'client.token')

  // Phase 1: launch, verify layout, then quitSuite over the socket.
  let child = spawn(executable, [`--user-data-dir=${userData}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  let ready = false
  for (let i = 0; i < 200 && !ready; i += 1) { ready = existsSync(socketPath) && existsSync(tokenPath); if (!ready) await sleep(100) }
  console.log('nativeEndpoint =', ready)
  if (!ready) throw new Error(stderr.slice(0, 800) || 'native host endpoint never appeared')
  const lines = spawnSync('pgrep', ['-lf', 'Moirasia'], { encoding: 'utf8' }).stdout.split('\n')
  console.log('loginItemsHost =', lines.some((line) => line.includes('Library/LoginItems/MoirasiaHost.app')))
  console.log('resourcesService =', lines.some((line) => line.includes('Resources/runtime/MoirasiaFeatureService.app')))
  console.log('featureArgs =', lines.some((line) => line.includes('Resources/features/bonded/native/BondedFirewallHelper')) && lines.some((line) => line.includes('Resources/features/shout/driver')))

  const token = readFileSync(tokenPath, 'utf8').trim()
  const requestOnSocket = (method, params) => new Promise((resolveReply, reject) => {
    const socket = createConnection(socketPath)
    socket.setEncoding('utf8')
    let buffer = ''
    const id = randomUUID()
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`${method} timed out`)) }, 8000)
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ version: 1, id: 'auth', method: 'host.authenticate', params: { token } })}\n`)
      socket.write(`${JSON.stringify({ version: 1, id, method, params })}\n`)
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
        if (line) {
          const message = JSON.parse(line)
          if (message.id === id) { clearTimeout(timer); socket.destroy(); resolveReply(message); return }
        }
        index = buffer.indexOf('\n')
      }
    })
    socket.on('error', (error) => { clearTimeout(timer); reject(error) })
  })
  const reply = await requestOnSocket('host.getSnapshot', {})
  console.log('authenticated =', reply.ok === true)

  electronProcesses = nativeProcessLines().map((line) => Number(line.split(' ')[0]))
  await requestOnSocket('host.quitSuite', {}).catch((error) => console.log('quitSuiteError =', String(error)))
  console.log('quitSuiteStopsSuite =', await waitNativeExit(electronProcesses, 10_000))
  console.log('electronExitPhase1 =', child.exitCode, child.signalCode)
  // The host is gone; force the orphaned UI down so the single-instance lock frees up.
  child.kill('SIGKILL')
  await sleep(1000)
  stderr = ''

  // Phase 2: relaunch, kill the UI, then verify the resident suite survives
  // Electron death and exits cleanly on a host SIGTERM (logout path).
  child = spawn(executable, [`--user-data-dir=${userData}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  ready = false
  for (let i = 0; i < 200 && !ready; i += 1) { ready = existsSync(socketPath) && existsSync(tokenPath); if (!ready) await sleep(100) }
  console.log('relaunchEndpoint =', ready)
  if (!ready) throw new Error(stderr.slice(0, 800) || 'relaunch never became ready')
  electronProcesses = nativeProcessLines().map((line) => Number(line.split(' ')[0]))
  child.kill('SIGKILL')
  console.log('suiteSurvivesElectronDeath =', await waitNativeSurvive(electronProcesses, 6000))
  const hostPid = nativeProcessLines().map((line) => Number(line.split(' ')[0])).find((pid) => { try { process.kill(pid, 0); return true } catch { return false } })
  if (hostPid) process.kill(hostPid, 'SIGTERM')
  console.log('hostSigtermStopsSuite =', await waitNativeExit(electronProcesses, 10_000))
  console.log('electronStderr =', stderr.trim().slice(0, 600) || '(empty)')
} finally {
  for (const pid of electronProcesses) { try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ } }
  spawnSync('pkill', ['-f', 'MoirasiaHost.app/Contents/MacOS/MoirasiaHost'], { stdio: 'ignore' })
  spawnSync('pkill', ['-f', 'MoirasiaFeatureService.app/Contents/MacOS/MoirasiaFeatureService'], { stdio: 'ignore' })
  await rm(userData, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)