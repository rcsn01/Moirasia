#!/usr/bin/env node
// Verifies that feature panels in the packaged suite load data instead of
// failing with "No handler registered": launches the packaged app, clicks each
// feature in the real navigation, and reads the rendered page text over the
// Chrome DevTools Protocol. Each read reconnects so page navigation cannot
// leave a stale socket behind.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, appendFileSync, realpathSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '..')
const executable = join(root, 'release', 'mac-arm64', 'Moirasia.app', 'Contents', 'MacOS', 'Moirasia')
if (!existsSync(executable)) { console.error('Packaged app missing.'); process.exit(1) }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const userData = realpathSync(await mkdtemp(join(tmpdir(), 'moirasia-panels-')))
const { writeFileSync, openSync, closeSync, readFileSync } = await import('node:fs')
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ version: 4, launchAtLogin: false, appPresence: 'menu-bar', pendingLoginItems: {}, features: { amove: true, bonded: true, shout: true } }), 'utf8')

const DEBUG_PORT = 9300 + (process.pid % 400)
const logPath = join(userData, 'app.log')
const logFd = openSync(logPath, 'w')
const hostLogPath = join(userData, 'host.log')
writeFileSync(hostLogPath, '')
const child = spawn(executable, [`--user-data-dir=${userData}`, `--remote-debugging-port=${DEBUG_PORT}`], { stdio: ['ignore', logFd, logFd], detached: true, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', MOIRASIA_HOST_LOG: hostLogPath, AMOVE_DISABLE_NATIVE_HOTKEYS: '1' } })
child.unref()
closeSync(logFd)
const readLog = () => { try { return readFileSync(logPath, 'utf8') } catch { return '' } }
const readFileSyncSafe = (path, limit) => { try { return readFileSync(path, 'utf8').slice(0, limit) } catch { return '(none)' } }

const startedAt = Date.now()
const diagPath = join(userData, 'diag.log')
writeFileSync(diagPath, '')
const diag = (line) => { try { appendFileSync(diagPath, `${Date.now() - startedAt}ms ${line}\n`) } catch { /* best effort */ } }
const scopedAppProcesses = () => spawnSync('pgrep', ['-lf', 'Moirasia.app/Contents/MacOS/Moirasia'], { encoding: 'utf8' }).stdout.split('\n').filter((line) => line.includes(userData))
const scopedNativePids = () => spawnSync('pgrep', ['-lf', 'MoirasiaHost.app/Contents/MacOS/MoirasiaHost|MoirasiaFeatureService.app/Contents/MacOS/MoirasiaFeatureService'], { encoding: 'utf8' }).stdout.split('\n').filter((line) => line.includes(userData)).map((line) => Number(line.trim().split(/\s+/, 1)[0])).filter(Number.isInteger)
const alivePoll = setInterval(() => { const list = scopedAppProcesses().join('\n'); const state = list ? 'alive' : 'gone'; if (state !== alivePoll._last) { alivePoll._last = state; diag(`app=${state}`) } }, 200)
const listPoll = setInterval(async () => { try { const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`, { signal: AbortSignal.timeout(1_000) }); const targets = await response.json(); diag(`listing=${JSON.stringify(targets.map((t) => t.type + ':' + t.url.split('/').pop())).slice(0, 220)}`) } catch (error) { diag(`listing-error=${String(error.cause ?? error).slice(0, 90)}`) } }, 2000)

try {
  const listingBefore = spawnSync('curl', ['-sf', `http://127.0.0.1:${DEBUG_PORT}/json/list`], { encoding: 'utf8' })
  await waitFor(() => shellTarget(), (target) => target !== undefined, 20_000)
  const results = {}
  const labels = { shout: 'Shout', bonded: 'Bonded', amove: 'Amove' }
  for (const [pageName, marker] of [['shout', 'Capture source'], ['bonded', 'GLOBAL PF FIREWALL'], ['amove', 'Custom Window Shortcuts']]) {
    const label = labels[pageName]
    await waitFor(async () => {
      const target = await shellTarget()
      if (!target) return undefined
      return readOnce(target.webSocketDebuggerUrl, `(() => { const button = [...document.querySelectorAll('button.desktop-navigation__item')].find((item) => item.textContent?.trim() === ${JSON.stringify(label)}); if (!button) return false; button.click(); return true })()`, 5_000)
    }, (clicked) => clicked === true, 5_000)
    const text = await waitFor(async () => {
      const target = await shellTarget()
      if (!target) return undefined
      const value = await readOnce(target.webSocketDebuggerUrl, 'document.querySelector("main")?.innerText ?? document.body.innerText', 5_000)
      return typeof value === 'string' ? value : undefined
    }, (value) => value !== undefined && value.includes(marker) && !value.includes('No handler registered'), 15_000)
    results[pageName] = { markerFound: text.includes(marker), handlerError: text.includes('No handler registered'), sample: text.slice(0, 120).replace(/\s+/g, ' ') }
  }
  let ok = true
  for (const [name, result] of Object.entries(results)) {
    const passed = result.markerFound && !result.handlerError
    console.log(`${name}: marker=${result.markerFound} handlerError=${result.handlerError} sample="${result.sample}"`)
    ok = ok && passed
  }
  console.log(ok ? 'PANELS OK' : 'PANELS FAILED')
  if (!ok) console.error('app log:', readLog().slice(0, 1200))
  process.exitCode = ok ? 0 : 1
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error)
  try { const listing = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`, { signal: AbortSignal.timeout(1_500) }); console.error('devtools listing:', (await listing.text()).slice(0, 600)) } catch (listingError) { console.error('devtools listing fetch failed:', listingError instanceof Error ? `${listingError.message} cause=${String(listingError.cause)}` : listingError) }
  console.error('app processes:', scopedAppProcesses().join('\n') || '(none)')
  console.error('host log:', readFileSyncSafe(hostLogPath, 800))
  console.error('app log tail:', readLog().split('\n').filter((line) => !line.includes('data:font/woff2')).join('\n').slice(-900))
  process.exitCode = 1
} finally {
  clearInterval(alivePoll); clearInterval(listPoll)
  diag('cleanup')
  for (const pid of scopedNativePids()) { try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ } }
  child.kill('SIGKILL')
  await sleep(300)
  try { console.error('diag:', readFileSyncSafe(diagPath, 3000)) } catch {}
  await rm(userData, { recursive: true, force: true })
}

async function shellTarget() {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`, { signal: AbortSignal.timeout(1_500) })
    if (!response.ok) return undefined
    const targets = await response.json()
    return Array.isArray(targets) ? targets.find((entry) => entry.type === 'page' && entry.url.includes('shell.html')) : undefined
  } catch { return undefined }
}

/** Connects to a target, evaluates one expression, closes the socket. */
async function readOnce(webSocketDebuggerUrl, expression, timeout) {
  const socket = new WebSocket(webSocketDebuggerUrl)
  try {
    await new Promise((resolveOpened, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket open timed out')), 5_000)
      socket.onopen = () => { clearTimeout(timer); resolveOpened() }
      socket.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket failed')) }
    })
    return await new Promise((resolveValue, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP response timed out')), timeout)
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data))
        if (message.id !== undefined) {
          clearTimeout(timer)
          if (message.error) reject(new Error(message.error.message))
          else resolveValue(message.result?.result?.value)
        }
      }
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    })
  } finally { socket.close() }
}

async function waitFor(operation, predicate, timeout) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { last = await operation(); if (last !== undefined && predicate(last)) return last } catch { /* Retry until the deadline. */ }
    await sleep(250)
  }
  throw new Error(`Timed out (last=${typeof last === 'string' ? last.slice(0, 120) : String(last)})`)
}