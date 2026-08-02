import { pathToFileURL } from 'node:url'
import { WebContentsView } from 'electron'
import type { ModuleId } from '../../shared/contracts'
import { paths } from '../paths'
import type { ModuleController, ModuleView } from './types'

export interface ElectronModuleView extends ModuleView {
  readonly nativeView: WebContentsView
}

export function createPlaceholderController(id: ModuleId): ModuleController {
  let view: ElectronModuleView | undefined

  return {
    id,
    async start() {
      if (view !== undefined) return view
      const nativeView = new WebContentsView({
        webPreferences: {
          preload: paths.preload('module'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          additionalArguments: [`--module-id=${id}`]
        }
      })
      nativeView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      nativeView.webContents.on('will-navigate', (event) => event.preventDefault())

      view = { id, nativeView }
      const developmentUrl = process.env.ELECTRON_RENDERER_URL
      if (developmentUrl) {
        await nativeView.webContents.loadURL(`${developmentUrl}/module.html?module=${id}`)
      } else {
        const url = pathToFileURL(paths.renderer('module'))
        url.searchParams.set('module', id)
        await nativeView.webContents.loadURL(url.toString())
      }
      return view
    },
    async activate() {
      view?.nativeView.webContents.focus()
    },
    async deactivate() {},
    async stop() {
      if (view !== undefined && !view.nativeView.webContents.isDestroyed()) {
        view.nativeView.webContents.close()
      }
      view = undefined
    }
  }
}
