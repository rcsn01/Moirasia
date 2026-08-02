import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const mainDirectory = dirname(fileURLToPath(import.meta.url))

export const paths = {
  preload(name: 'shell' | 'module'): string {
    return join(mainDirectory, `../preload/${name}.cjs`)
  },
  renderer(page: 'shell' | 'module'): string {
    return join(mainDirectory, `../renderer/${page}.html`)
  }
}
