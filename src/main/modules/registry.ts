import { app } from 'electron'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import type { ModuleDefinition } from './types'
import { MODULE_CATALOG } from './catalog'
import { ModuleDiscovery, type DiscoveryStatus } from './discovery'
import { DevelopmentSupervisor } from './dev-supervisor'
import { ArtifactController, createShortcutRegistry } from './artifact-controller'
import type { ShellSettingsStore } from '../settings'

export async function createModuleRegistry(settings: ShellSettingsStore): Promise<readonly ModuleDefinition[]> {
  const discovery = new ModuleDiscovery(join(app.getPath('userData'), 'Module Cache'))
  const supervisor = new DevelopmentSupervisor()
  const shortcuts = createShortcutRegistry()
  const statuses = new Map<string, DiscoveryStatus>()
  await Promise.all(MODULE_CATALOG.map(async (entry) => statuses.set(entry.id, await discovery.discoverInstalled(entry))))

  return MODULE_CATALOG.map((entry) => ({
    id: entry.id,
    label: entry.label,
    availability: () => {
      const current = statuses.get(entry.id)!
      if (current.state === 'available' || (!app.isPackaged && existsSync(resolve(app.getAppPath(), entry.developmentRepository)))) return { available: true }
      return { available: false, reason: current.reason }
    },
    load: async () => {
      let status = statuses.get(entry.id)!
      let stopModuleDev: (() => void) | undefined
      if (!app.isPackaged) {
        const repository = resolve(app.getAppPath(), entry.developmentRepository)
        if (await exists(repository)) {
          const readiness = await supervisor.start(entry.id, repository)
          stopModuleDev = () => supervisor.stop(entry.id)
          status = await discovery.validateDevelopmentManifest(readiness.manifestPath, entry)
          statuses.set(entry.id, status)
        }
      }
      if (status.state !== 'available') throw new Error(status.reason)
      return new ArtifactController({
        artifact: status,
        dataDirectory: join(app.getPath('appData'), status.manifest.data.supportDirectory),
        cacheDirectory: join(app.getPath('appData'), 'Moirasia', 'Cache', entry.id),
        shortcuts,
        setLaunchAtLogin: async (enabled) => {
          await settings.update({ launchAtLogin: enabled, autoStart: { [entry.id]: enabled } })
          app.setLoginItemSettings({ openAtLogin: enabled })
        },
        ...(stopModuleDev ? { stopModuleDev } : {})
      })
    }
  }))
}

async function exists(path: string): Promise<boolean> { return existsSync(path) }
