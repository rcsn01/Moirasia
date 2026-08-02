import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { hashPayload } from '@moirasia/module-sdk/build'
import { ModuleDiscovery, type DiscoveryDependencies } from '../src/main/modules/discovery'
import { MODULE_CATALOG } from '../src/main/modules/catalog'

const entry = MODULE_CATALOG[0]!

async function fixture(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'moirasia-module-'))
  const app = join(root, 'Amove.app')
  const moduleRoot = join(app, 'Contents', 'PlugIns', 'amove.moirasia-module', 'Contents', 'Resources')
  await mkdir(join(moduleRoot, 'main'), { recursive: true })
  await mkdir(join(moduleRoot, 'renderer'), { recursive: true })
  await writeFile(join(moduleRoot, 'main', 'index.mjs'), 'export default () => ({})')
  await writeFile(join(moduleRoot, 'renderer', 'index.html'), '<main>Amove</main>')
  const base = {
    manifestVersion: 1, id: 'amove', name: 'Amove', version: '1.0.0',
    application: { bundleId: 'com.opense.Amove' },
    hostApi: { min: '0.1.0', maxExclusive: '0.2.0' }, kind: 'web',
    entrypoints: { main: 'main/index.mjs', renderer: 'renderer/index.html' },
    capabilities: [], data: { owner: 'com.opense.Amove', supportDirectory: 'Amove', lockName: 'amove' },
    payload: { sha256: await hashPayload(moduleRoot) }, ...overrides
  }
  await writeFile(join(moduleRoot, 'manifest.json'), JSON.stringify(base))
  return { root, app, moduleRoot }
}

function dependencies(app: string, overrides: Partial<DiscoveryDependencies> = {}): DiscoveryDependencies {
  return {
    locateApplication: vi.fn(async () => app),
    readBundleIdentifier: vi.fn(async () => 'com.opense.Amove'),
    verifyCodeSeal: vi.fn(async () => undefined),
    ...overrides
  }
}

describe('ModuleDiscovery', () => {
  it('validates and atomically caches an installed payload', async () => {
    const { root, app } = await fixture()
    const status = await new ModuleDiscovery(join(root, 'cache'), dependencies(app)).discoverInstalled(entry)
    expect(status).toMatchObject({ state: 'available', source: 'installed', manifest: { id: 'amove' } })
    if (status.state === 'available') expect(status.moduleRoot).toContain('/cache/amove/1.0.0/')
  })

  it('rejects an incompatible host API without loading code', async () => {
    const { root, app } = await fixture({ hostApi: { min: '9.0.0', maxExclusive: '10.0.0' } })
    await expect(new ModuleDiscovery(join(root, 'cache'), dependencies(app)).discoverInstalled(entry))
      .resolves.toMatchObject({ state: 'incompatible' })
  })

  it('rejects a payload modified after manifest generation', async () => {
    const { root, app, moduleRoot } = await fixture()
    await writeFile(join(moduleRoot, 'main', 'index.mjs'), 'tampered')
    await expect(new ModuleDiscovery(join(root, 'cache'), dependencies(app)).discoverInstalled(entry))
      .resolves.toMatchObject({ state: 'corrupt', reason: expect.stringContaining('hash') })
  })

  it('rejects symlinks even when they point back into the payload', async () => {
    const { root, app, moduleRoot } = await fixture()
    await symlink('index.mjs', join(moduleRoot, 'main', 'alias.mjs'))
    await expect(new ModuleDiscovery(join(root, 'cache'), dependencies(app)).discoverInstalled(entry))
      .resolves.toMatchObject({ state: 'corrupt', reason: expect.stringContaining('symbolic link') })
  })

  it('surfaces code seal and missing app failures', async () => {
    const { root, app } = await fixture()
    await expect(new ModuleDiscovery(join(root, 'cache'), dependencies(app, {
      verifyCodeSeal: vi.fn(async () => { throw new Error('invalid ad-hoc seal') })
    })).discoverInstalled(entry)).resolves.toMatchObject({ state: 'corrupt', reason: 'invalid ad-hoc seal' })
    await expect(new ModuleDiscovery(join(root, 'cache'), dependencies(app, {
      locateApplication: vi.fn(async () => undefined)
    })).discoverInstalled(entry)).resolves.toMatchObject({ state: 'missing' })
  })
})
