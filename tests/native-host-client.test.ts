import { createServer, type Server, type Socket } from 'node:net'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeHostClient } from '../src/main/native-host/client'
import { encodeNativeHostMessage, nativeHostRequest, type NativeHostEvent, type NativeHostResponse } from '../src/shared/native-host-contracts'

const SNAPSHOT = {
  version: 1,
  revision: 1,
  settings: { version: 4, launchAtLogin: false, appPresence: 'menu-bar', pendingLoginItems: {}, features: {} },
  features: [
    { id: 'amove', installed: false, state: 'stopped' },
    { id: 'bonded', installed: false, state: 'stopped' },
    { id: 'shout', installed: false, state: 'stopped' }
  ]
}

async function listen(path: string, onConnection: (socket: Socket) => void): Promise<Server> {
  const server = createServer(onConnection)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve) })
  return server
}

function writeResponse(socket: Socket, request: { id: string; version: number }, result: unknown): void {
  const response: NativeHostResponse = { version: request.version as 1, id: request.id, ok: true, result }
  socket.write(encodeNativeHostMessage(response))
}

function handleProtocol(socket: Socket, onSnapshot: () => void): void {
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
      if (line) {
        const request = JSON.parse(line) as { id: string; method: string; version: number }
        if (request.method === 'host.authenticate') writeResponse(socket, request, { authenticated: true })
        else if (request.method === 'host.getSnapshot') { writeResponse(socket, request, SNAPSHOT); onSnapshot() }
      }
      newline = buffer.indexOf('\n')
    }
  })
}

describe('NativeHostClient', () => {
  let directory: string | undefined
  let server: Server | undefined
  let sockets: Socket[] = []

  afterEach(async () => {
    sockets.forEach((socket) => socket.destroy())
    server?.close()
    if (directory) await rm(directory, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('emits one-shot connection transitions and resets revisions between host generations', async () => {
    directory = await mkdtemp(join(tmpdir(), 'moirasia-native-client-'))
    const socketPath = join(directory, 'host.sock')
    const tokenPath = join(directory, 'token')
    await writeFile(tokenPath, 'secret\n')
    let generation = 0
    let sendHighRevision = false
    server = await listen(socketPath, (socket) => {
      sockets.push(socket)
      generation += 1
      handleProtocol(socket, () => {
        if (sendHighRevision) {
          const event: NativeHostEvent = { version: 1, event: 'host.snapshotChanged', revision: 100, payload: SNAPSHOT }
          socket.write(encodeNativeHostMessage(event))
        }
      })
    })

    const client = new NativeHostClient({ socketPath, tokenPath, timeoutMs: 500 })
    const states: string[] = []
    const snapshots: unknown[] = []
    client.subscribeConnection?.(({ state }) => states.push(state))
    client.subscribe('host.snapshotChanged', (payload) => snapshots.push(payload))

    await client.connect()
    expect(states).toEqual(['connected'])
    sendHighRevision = true
    await client.request('host.getSnapshot')
    await vi.waitFor(() => expect(snapshots).toHaveLength(1))

    sockets[0]?.destroy()
    await vi.waitFor(() => expect(states).toEqual(['connected', 'disconnected']))

    server.close()
    await new Promise<void>((resolve) => server?.once('close', resolve))
    server = await listen(socketPath, (socket) => {
      sockets.push(socket)
      generation += 1
      handleProtocol(socket, () => {
        const event: NativeHostEvent = { version: 1, event: 'host.snapshotChanged', revision: 1, payload: SNAPSHOT }
        socket.write(encodeNativeHostMessage(event))
      })
    })
    await client.request('host.getSnapshot')
    await vi.waitFor(() => expect(states).toEqual(['connected', 'disconnected', 'reconnected']))
    await vi.waitFor(() => expect(snapshots).toHaveLength(2))
    expect(generation).toBe(2)

    client.close()
    await new Promise((resolve) => setImmediate(resolve))
    expect(states).toEqual(['connected', 'disconnected', 'reconnected'])
  })
})
