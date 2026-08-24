import { app } from 'electron'
import { join } from 'node:path'
import type { FeatureContext } from '@moirasia/desktop-shell/feature'

/** Build the standalone host resources without making suite mode know app paths. */
export function standaloneContext(): FeatureContext {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  const worker = app.isPackaged
    ? join(process.resourcesPath, 'features', 'orbis', 'worker', 'scan-worker.mjs')
    : join(app.getAppPath(), 'worker-dist', 'scan-worker.mjs')
  return {
    id: 'orbis',
    mode: 'standalone',
    productId: 'orbis',
    paths: {
      preloads: { main: join(import.meta.dirname, '../preload/index.cjs') },
      renderers: { main: rendererUrl ? `${rendererUrl}/index.html` : join(import.meta.dirname, '../renderer/index.html') },
      workers: { scan: worker },
      dataDirectory: app.getPath('userData')
    }
  }
}
