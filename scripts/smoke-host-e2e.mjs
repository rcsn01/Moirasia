#!/usr/bin/env node
// End-to-end smoke: launch the staged MoirasiaHost, connect with the protocol,
// authenticate (positive + negative), read snapshots, mutate, and shut down.
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { randomUUID } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = process.cwd()
const staged = join(root, 'native/staged/runtime')
const hostPath = join(staged, 'MoirasiaHost.app/Contents/MacOS/MoirasiaHost')
const servicePath = join(staged, 'MoirasiaFeatureService.app/Contents/MacOS/MoirasiaFeatureService')
if (!existsSync(hostPath) || !existsSync(servicePath)) {
  console.error('Run node scripts/build-moirasia-runtime.mjs first')
  process.exit(1)
}

const userData = await mkdtemp(join(tmpdir(), 'moirasia-smoke-'))
const host = spawn(hostPath, [
  '--host',
  '--application', join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  '--user-data', userData,
  '--feature-service', servicePath,
  '--presence', 'dock'
], { stdio: ['ignore', 'inherit', 'inherit'] })

const runtimeDir = join(userData, 'runtime')
const socketPath = join(runtimeDir, 'host.sock')
const tokenPath = join(runtimeDir, 'client.token')
for (let i = 0; i < 100; i += 1) {
  if (existsSync(socketPath) && existsSync(tokenPath)) break
  await new Promise((resolve) => setTimeout(resolve, 100))
  if (i === 99) {
    console.error('Native host did not create its runtime files')
    host.kill('SIGTERM')
    process.exit(1)
  }
}

const token = (await readFile(tokenPath, 'utf8')).trim()
const protocolVersion = 1

function connect() {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    const pending = new Map()
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (!line) { index = buffer.indexOf('\n'); continue }
        const message = JSON.parse(line)
        const waiter = pending.get(message.id)
        if (waiter) { pending.delete(message.id); waiter(message) }
        index = buffer.indexOf('\n')
      }
    })
    socket.on('connect', () => resolve({ socket, request }))
    socket.on('error', reject)
    function request(method, params = {}) {
      const id = randomUUID()
      return new Promise((resolveRequest, rejectRequest) => {
        pending.set(id, resolveRequest)
        socket.write(`${JSON.stringify({ version: protocolVersion, id, method, params })}\n`)
        setTimeout(() => rejectRequest(new Error(`${method} timed out`)), 8000)
      })
    }
  })
}

const client = await connect()
const auth = await client.request('host.authenticate', { token })
console.log('auth.authenticated =', auth.result?.authenticated === true)
const badClient = await connect()
const rejectAuth = await badClient.request('host.authenticate', { token: 'wrong-token' })
console.log('rejectAuth.ok =', rejectAuth.ok)
badClient.socket.destroy()

// Feature modules start asynchronously; wait until every feature is running.
let running = false
for (let i = 0; i < 60 && !running; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250))
  const probe = await client.request('host.getSnapshot')
  running = (probe.result?.features ?? []).every((feature) => feature.state === 'running')
}
console.log('featuresRunning =', running)
const snapshot = await client.request('host.getSnapshot')
console.log('snapshot.features =', JSON.stringify(snapshot.result?.features?.map((feature) => feature.id)))
const bonded = await client.request('bonded.getSnapshot')
console.log('bonded.version =', bonded.result?.version, 'monitor =', bonded.result?.monitorStatus?.state)
const shout = await client.request('shout.getSnapshot')
console.log('shout.driver =', shout.result?.driverStatus?.state, 'permission =', shout.result?.permissionState)
const amove = await client.request('amove.getSnapshot')
console.log('amove.hostMode =', amove.result?.hostMode)
const restart = await client.request('bonded.restartMonitor')
console.log('restart.ok =', restart.ok)
const presence = await client.request('host.setPresence', { mode: 'menu-bar' })
console.log('setPresence.ok =', presence.ok)
const installOff = await client.request('host.setFeatureInstalled', { id: 'bonded', installed: false })
console.log('installOff.ok =', installOff.ok)
const installOn = await client.request('host.setFeatureInstalled', { id: 'bonded', installed: true })
console.log('installOn.ok =', installOn.ok)

host.kill('SIGTERM')
const code = await new Promise((resolve) => host.once('exit', resolve))
await rm(userData, { recursive: true, force: true })
console.log('host exit =', code)
process.exit(code === 0 || code === null ? 0 : 1)