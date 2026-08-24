import { app } from 'electron'
import { join } from 'node:path'
import type { FeatureContext } from '@moirasia/desktop-shell/feature'

/**
 * FeatureContext for the standalone Exithibition build. The feature package alone
 * knows the standalone dev conventions: this file bundles into out/main, the
 * SwiftPM debug binary stays under the app's .build directory.
 */
export function standaloneContext(): FeatureContext {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  return {
    id: 'exithibition',
    mode: 'standalone',
    productId: 'exithibition',
    paths: {
      preloads: { main: join(import.meta.dirname, '../preload/index.cjs') },
      renderers: { main: rendererUrl ?? join(import.meta.dirname, '../renderer/index.html') },
      native: { executable: app.isPackaged
        ? join(process.resourcesPath, 'native/ExithibitionNative')
        : join(app.getAppPath(), '.build/arm64-apple-macosx/debug/ExithibitionNative') },
      assetsDirectory: app.isPackaged ? join(app.getAppPath(), 'assets') : join(app.getAppPath(), 'assets'),
      dataDirectory: app.getPath('userData')
    }
  }
}
