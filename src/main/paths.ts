import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const mainDirectory = dirname(fileURLToPath(import.meta.url))

export function applicationAgentPath(resourcesPath = process.resourcesPath): string {
  const packaged = join(resourcesPath, 'application-agent')
  return existsSync(packaged) ? packaged : join(mainDirectory, '../../native/staged/application-agent')
}

const preloadPages = {
  shell: '../preload/shell.cjs',
  'feature-amove-shelf': '../preload/feature-amove-shelf.cjs'
} as const

// Renderer pages mirror the renderer root of the suite build (the repository
// root), so app-owned entries keep their repository-relative paths.
const rendererPages = {
  shell: '../renderer/src/renderer/shell.html',
  'feature-amove-shelf': '../renderer/apps/integrated/Amove/src/renderer/shelf.html'
} as const

export const paths = {
  preload(page: keyof typeof preloadPages): string {
    return join(mainDirectory, preloadPages[page])
  },
  renderer(page: keyof typeof rendererPages): string {
    return join(mainDirectory, rendererPages[page])
  }
}
