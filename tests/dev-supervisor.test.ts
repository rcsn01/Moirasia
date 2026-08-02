import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DevelopmentSupervisor } from '../src/main/modules/dev-supervisor'

async function repository(command: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'moirasia-dev-supervisor-'))
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { 'module:dev': command } }))
  return root
}

describe('DevelopmentSupervisor', () => {
  it('starts on demand, accepts readiness, and terminates its watcher', async () => {
    const root = await repository(`node -e "console.log(JSON.stringify({type:'moirasia-module-ready',manifestPath:'dist/manifest.json'}));setInterval(()=>{},1000)"`)
    const supervisor = new DevelopmentSupervisor(5_000)
    await expect(supervisor.start('amove', root)).resolves.toEqual({ manifestPath: join(root, 'dist/manifest.json') })
    expect(supervisor.isRunning('amove')).toBe(true)
    supervisor.stop('amove')
    expect(supervisor.isRunning('amove')).toBe(false)
  })

  it('rejects malformed readiness and permits a retry', async () => {
    const bad = await repository(`node -e "console.log('{bad')"`)
    const good = await repository(`node -e "console.log(JSON.stringify({type:'moirasia-module-ready',manifestPath:'manifest.json'}));setInterval(()=>{},1000)"`)
    const supervisor = new DevelopmentSupervisor(5_000)
    await expect(supervisor.start('vox', bad)).rejects.toThrow('malformed readiness JSON')
    await expect(supervisor.start('vox', good)).resolves.toMatchObject({ manifestPath: join(good, 'manifest.json') })
    supervisor.stopAll()
  })

  it('reports timeouts and build failures without leaving a watcher', async () => {
    const timeout = await repository(`node -e "setInterval(()=>{},1000)"`)
    const failure = await repository(`node -e "process.exit(2)"`)
    await expect(new DevelopmentSupervisor(250).start('amove', timeout)).rejects.toThrow('did not become ready')
    const supervisor = new DevelopmentSupervisor(5_000)
    await expect(supervisor.start('exithibition', failure)).rejects.toThrow('exited before readiness')
    expect(supervisor.isRunning('exithibition')).toBe(false)
  })
})
