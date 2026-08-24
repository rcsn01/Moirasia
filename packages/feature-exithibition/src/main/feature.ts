import { validateFeatureResources, type FeatureContext, type MoirasiaFeature } from '@moirasia/desktop-shell/feature'
import { ExithibitionController } from './controller'

class ExithibitionFeature implements MoirasiaFeature {
  readonly id = 'exithibition'
  #controller: ExithibitionController | undefined

  async register(ctx: FeatureContext): Promise<void> {
    if (this.#controller) return
    if (ctx.id !== this.id || ctx.productId !== 'exithibition') throw new Error('Invalid Exithibition feature context')
    validateFeatureResources(ctx, ctx.mode === 'standalone'
      ? { preloads: ['main'], renderers: ['main'], native: ['executable'], dataDirectory: true }
      : { native: ['executable'], dataDirectory: true })
    const controller = new ExithibitionController(ctx)
    this.#controller = controller
    try {
      await controller.start()
    } catch (error) {
      this.#controller = undefined
      await controller.stop().catch(() => undefined)
      throw error
    }
  }

  async dispose(): Promise<void> {
    const controller = this.#controller
    this.#controller = undefined
    await controller?.stop()
  }

  activate(): void { this.#controller?.activate() }
  setActive(active: boolean): void { this.#controller?.setActive(active) }
}

export const feature: MoirasiaFeature = new ExithibitionFeature()
