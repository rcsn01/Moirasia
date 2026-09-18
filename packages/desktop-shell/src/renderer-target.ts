import type { WebContents } from 'electron'
import type { RendererTarget } from './feature'
import { sendToRenderer } from './main'

export class MutableRendererTarget implements RendererTarget {
  #current: WebContents | undefined
  #listeners = new Set<(current: WebContents | undefined) => void>()
  #disposed = false

  current(): WebContents | undefined { return this.#current }

  send(channel: string, ...args: unknown[]): boolean {
    return this.#current ? sendToRenderer(this.#current, channel, ...args) : false
  }

  subscribe(listener: (current: WebContents | undefined) => void): () => void {
    if (this.#disposed) {
      listener(undefined)
      return () => undefined
    }
    this.#listeners.add(listener)
    listener(this.#current)
    return () => this.#listeners.delete(listener)
  }

  attach(current: WebContents): void {
    if (this.#disposed) throw new Error('Renderer target has been disposed')
    if (this.#current === current) return
    this.#current = current
    this.#emit()
  }

  detach(current?: WebContents): void {
    if (current && this.#current !== current) return
    if (!this.#current) return
    this.#current = undefined
    this.#emit()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.detach()
    this.#listeners.clear()
  }

  #emit(): void { for (const listener of this.#listeners) listener(this.#current) }
}
