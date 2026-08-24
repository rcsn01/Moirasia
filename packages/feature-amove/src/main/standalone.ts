import { app } from 'electron'
import { join } from 'node:path'
import type { FeatureContext } from '@moirasia/desktop-shell/feature'

export function standaloneContext(): FeatureContext {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  const nativeName = standaloneNativeName()
  const appRoot = app.isPackaged ? app.getAppPath() : join(import.meta.dirname, '../..')
  return {
    id: 'amove',
    mode: 'standalone',
    productId: 'amove',
    paths: {
      preloads: {
        main: join(import.meta.dirname, '../preload/main.js'),
        shelf: join(import.meta.dirname, '../preload/shelf.js')
      },
      renderers: {
        main: rendererUrl ? `${rendererUrl}/index.html` : join(import.meta.dirname, '../renderer/index.html'),
        shelf: rendererUrl ? `${rendererUrl}/shelf.html` : join(import.meta.dirname, '../renderer/shelf.html')
      },
      native: { addon: app.isPackaged ? join(process.resourcesPath, 'native', nativeName) : join(appRoot, 'native', nativeName) },
      assetsDirectory: join(appRoot, 'assets'),
      dataDirectory: app.getPath('userData')
    }
  }
}

function standaloneNativeName(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'darwin') return `amove-native.darwin-${arch}.node`
  if (process.platform === 'win32') return 'amove-native.win32-x64-msvc.node'
  return 'amove-native.linux-x64-gnu.node'
}
