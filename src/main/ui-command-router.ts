import type { ControllerPage } from '../shared/contracts'

export type UiIntent =
  | { kind: 'shell'; page?: ControllerPage }
  | { kind: 'shelf' }

export function parseUiIntent(argv: readonly string[]): UiIntent {
  const value = argv.find((argument) => argument.startsWith('--moirasia-open='))?.slice('--moirasia-open='.length)
  if (value === 'shelf') return { kind: 'shelf' }
  if (value === 'shell' || value === undefined) return { kind: 'shell' }
  const [kind, page] = value.split(':', 2)
  if (kind === 'shell' && (page === 'general' || page === 'features' || page === 'amove' || page === 'bonded' || page === 'shout')) return { kind, page }
  return { kind: 'shell' }
}

export class UiCommandRouter {
  #disposed = false
  constructor(private readonly handlers: { openShell(page?: ControllerPage): void | Promise<void>; openShelf(): void | Promise<void> }) {}

  route(intent: UiIntent): void {
    if (this.#disposed) return
    if (intent.kind === 'shelf') void this.handlers.openShelf()
    else void this.handlers.openShell(intent.page)
  }

  dispose(): void { this.#disposed = true }
}
