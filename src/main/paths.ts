import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { FeatureId } from '@moirasia/desktop-shell/feature'

const mainDirectory = dirname(fileURLToPath(import.meta.url))

export function applicationAgentPath(resourcesPath = process.resourcesPath): string {
  const packaged = join(resourcesPath, 'application-agent')
  return existsSync(packaged) ? packaged : join(mainDirectory, '../../native/staged/application-agent')
}

export const paths = {
  preload(name: 'shell' | 'module' | `feature-${FeatureId}` | `feature-${FeatureId}-${string}`): string {
    return join(mainDirectory, `../preload/${name}.cjs`)
  },
  renderer(page: 'shell' | 'module' | `feature-${FeatureId}` | `feature-${FeatureId}-${string}`): string {
    return join(mainDirectory, `../renderer/${page}.html`)
  }
}
