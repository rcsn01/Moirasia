import { validateFeatureResources, type FeatureContext, type MoirasiaFeature } from '@moirasia/desktop-shell/feature'
import { AppController } from './app-controller'
import { registerIpc } from './ipc'

export class AmoveFeature implements MoirasiaFeature {
  readonly id = 'amove'
  #controller: AppController | undefined
  #disposeIpc: (() => void) | undefined

  async register(ctx: FeatureContext): Promise<void> {
    if (this.#controller) return
    if (ctx.id !== this.id || ctx.productId !== 'amove') throw new Error('Invalid Amove feature context')
    validateFeatureResources(ctx, ctx.mode === 'standalone'
      ? { preloads: ['main', 'shelf'], renderers: ['main', 'shelf'], native: ['addon'], assetsDirectory: true, dataDirectory: true }
      : { preloads: ['shelf'], renderers: ['shelf'], native: ['addon'], assetsDirectory: true, dataDirectory: true })
    const controller = new AppController(ctx)
    this.#controller = controller
    try {
      await controller.start()
      this.#disposeIpc = registerIpc(controller)
    } catch (error) {
      this.#disposeIpc?.()
      this.#disposeIpc = undefined
      this.#controller = undefined
      controller.dispose()
      throw error
    }
  }

  async dispose(): Promise<void> {
    const controller = this.#controller
    this.#controller = undefined
    this.#disposeIpc?.()
    this.#disposeIpc = undefined
    controller?.dispose()
  }

  activate(): void { void this.#controller?.showMainWindow() }
  setActive(active: boolean): void { this.#controller?.setActive(active) }
  shouldQuitWhenWindowAllClosed(): boolean { return this.#controller?.hostMode === 'standalone' && this.#controller.getState().settings.presenceMode === 'taskbar' }
}

export const feature = new AmoveFeature()
export { AppController }
