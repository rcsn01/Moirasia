#!/usr/bin/env node
// Debug: launch the DEBUG-build host, authenticate, request a snapshot, print traces.
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { randomUUID, createHash } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

const root = process.cwd()
const binPath = String(execSync('swift build --package-path native/moirasia-runtime -c debug --show-bin-path', { encoding: 'utf8' })).trim()
const hostPath = join(binPath, 'MoirasiaHost')
const servicePath = join(binPath, 'MoirasiaFeatureService')
const userData = realpathSync(await mkdtemp(join(tmpdir(), 'moirasia-debug-')))
const host = spawn(hostPath, [
  '--host',
  '--application', join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  '--user-data', userData,
  '--feature-service', servicePath,
  '--bonded-helper', join(root, 'native/staged/features/bonded/native/BondedFirewallHelper'),
  '--shout-driver', join(root, 'native/staged/features/shout/driver/ShoutMic.driver'),
  '--presence', 'dock'
], { stdio: ['ignore', 'pipe', 'pipe'] })
host.stdout.on('data', (data) => console.log('[host.out]', String(data).trim()))
host.stderr.on('data', (data) => { for (const line of String(data).split('\n')) { if (line) console.log('[host.err]', line.slice(0, 160)) } })
host.on('exit', (code, signal) => console.log('[host exit]', code, signal))

const runtimeDir = join(userData, 'runtime')
const socketPath = join(tmpdir(), `moirasia-host-${createHash('sha256').update(userData, 'utf8').digest('hex').slice(0, 16)}.sock`)
console.log('[paths]', JSON.stringify({ userData, socketPath, tmpdir: tmpdir(), TMPDIR: process.env.TMPDIR }))
const tokenPath = join(runtimeDir, 'client.token')
for (let i = 0; i < 60; i += 1) {
  if (existsSync(socketPath) && existsSync(tokenPath)) break
  await new Promise((resolve) => setTimeout(resolve, 100))
}
console.log('[files ready]', existsSync(socketPath), existsSync(tokenPath))
const token = (await readFile(tokenPath, 'utf8')).trim()

const socket = createConnection(socketPath)
socket.setEncoding('utf8')
let buffer = ''
const authId = randomUUID()
const snapId = randomUUID()
let authenticated = false
socket.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line) {
      try {
        const message = JSON.parse(line)
        if (message.id === authId) {
          console.log('[auth reply]', JSON.stringify(message).slice(0, 160))
          authenticated = true
          socket.write(`${JSON.stringify({ version: 1, id: snapId, method: 'host.getSnapshot', params: {} })}\n`)
        } else if (message.id === snapId) {
          console.log('[snapshot reply ok]', message.ok, JSON.stringify(message.result ?? message.error).slice(0, 220))
          console.log('[killing]')
          host.kill('SIGTERM')
        } else if (message.event) {
          console.log('[event]', message.event, message.revision)
        }
      } catch { console.log('[unparsable]', line.slice(0, 120)) }
    }
    index = buffer.indexOf('\n')
  }
})
socket.on('error', (error) => console.log('[socket error]', String(error)))
socket.on('connect', () => {
  console.log('[connected]')
  socket.write(`${JSON.stringify({ version: 1, id: authId, method: 'host.authenticate', params: { token } })}\n`)
})
setTimeout(() => { console.log('[timeout, killing] authenticated =', authenticated); host.kill('SIGTERM') }, 8000)
await new Promise((resolve) => host.once('exit', resolve))
await rm(userData, { recursive: true, force: true })
process.exit(0)