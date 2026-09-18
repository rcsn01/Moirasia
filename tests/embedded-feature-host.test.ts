import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { EmbeddedFeatureHost } from '../src/main/features/embedded-host'

class FakeWindow extends EventEmitter {
  webContents = { send: vi.fn(), isDestroyed: () => this.destroyed }
  destroyed = false
  focused = false
  shown = false
  isDestroyed(): boolean { return this.destroyed }
  isFocused(): boolean { return this.focused }
  show(): void { this.shown = true }
  focus(): void { this.focused = true; this.emit('focus') }
}

describe('EmbeddedFeatureHost', () => {
  it('keeps stable feature surfaces and routes activation through the shell window', () => {
    const window = new FakeWindow()
    const host = new EmbeddedFeatureHost(window as never)
    const amove = host.surface('amove')
    const states: unknown[] = []
    amove.subscribe((state) => states.push(state))
    const navigate = vi.fn()
    host.subscribeNavigation(navigate)

    expect(host.surface('amove')).toBe(amove)
    expect(amove.state).toEqual({ active: false, focused: false })
    amove.activate()

    expect(window.shown).toBe(true)
    expect(window.focused).toBe(true)
    expect(amove.state).toEqual({ active: true, focused: true })
    expect(navigate).toHaveBeenCalledWith('amove')
    expect(states.at(-1)).toEqual({ active: true, focused: true })

    window.emit('blur')
    expect(amove.state).toEqual({ active: true, focused: false })
    host.setActive(undefined)
    expect(amove.state).toEqual({ active: false, focused: false })
  })

  it('keeps a stable surface while replacing the shell renderer', () => {
    const first = new FakeWindow()
    const second = new FakeWindow()
    const host = new EmbeddedFeatureHost(first as never)
    const surface = host.surface('amove')
    const targets: unknown[] = []
    surface.renderer.subscribe((target) => targets.push(target))

    host.detach(first as never)
    expect(surface.renderer.current()).toBeUndefined()
    host.attach(second as never)

    expect(host.surface('amove')).toBe(surface)
    expect(surface.renderer.current()).toBe(second.webContents)
    expect(targets).toEqual([first.webContents, undefined, second.webContents])
  })

  it('requests navigation when a detached feature is activated', () => {
    const window = new FakeWindow()
    const host = new EmbeddedFeatureHost(window as never)
    const navigate = vi.fn()
    host.subscribeNavigation(navigate)
    host.detach(window as never)

    host.surface('bonded').activate()

    expect(navigate).toHaveBeenCalledWith('bonded')
  })

  it('does not deliver navigation or state callbacks after disposal', () => {
    const window = new FakeWindow()
    const host = new EmbeddedFeatureHost(window as never)
    const surface = host.surface('amove')
    const listener = vi.fn()
    surface.subscribe(listener)
    const navigate = vi.fn()
    host.subscribeNavigation(navigate)
    host.dispose()

    host.setActive('amove')
    window.emit('focus')

    expect(navigate).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(() => host.surface('amove')).toThrow('disposed')
  })
})
