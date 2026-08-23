import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { FeatureId } from '@moirasia/desktop-shell/feature'

const mainDirectory = dirname(fileURLToPath(import.meta.url))

export const paths = {
  preload(name: 'shell' | 'module' | `feature-${FeatureId}`): string {
    return join(mainDirectory, `../preload/${name}.cjs`)
  },
  renderer(page: 'shell' | 'module' | `feature-${FeatureId}`): string {
    return join(mainDirectory, `../renderer/${page}.html`)
  }
}
