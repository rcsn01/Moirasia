import { describe, expect, it, vi } from 'vitest'
import { UiCommandRouter, parseUiIntent } from '../src/main/ui-command-router'

describe('UiCommandRouter', () => {
  it('parses shell, page, and shelf launch intents', () => {
    expect(parseUiIntent(['electron', '--moirasia-open=shell:bonded'])).toEqual({ kind: 'shell', page: 'bonded' })
    expect(parseUiIntent(['--moirasia-open=shelf'])).toEqual({ kind: 'shelf' })
    expect(parseUiIntent([])).toEqual({ kind: 'shell' })
    expect(parseUiIntent(['--moirasia-open=invalid'])).toEqual({ kind: 'shell' })
  })

  it('routes once and ignores requests after disposal', () => {
    const openShell = vi.fn()
    const openShelf = vi.fn()
    const router = new UiCommandRouter({ openShell, openShelf })
    router.route({ kind: 'shell', page: 'amove' })
    router.route({ kind: 'shelf' })
    router.dispose()
    router.route({ kind: 'shell' })
    expect(openShell).toHaveBeenCalledWith('amove')
    expect(openShelf).toHaveBeenCalledOnce()
  })
})
