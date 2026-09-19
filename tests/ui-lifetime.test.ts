import { describe, expect, it, vi } from 'vitest'
import { UiLifetime } from '../src/main/ui-lifetime'

describe('UiLifetime', () => {
  it('keeps Electron alive while the shelf is the only visible UI', () => {
    const onFinalWindowGone = vi.fn()
    const lifetime = new UiLifetime({ mode: () => 'menu-bar', onFinalWindowGone })
    lifetime.shellOpened()
    lifetime.shelfVisible(true)
    lifetime.shellClosed()
    expect(onFinalWindowGone).not.toHaveBeenCalled()
    lifetime.shelfVisible(false)
    expect(onFinalWindowGone).toHaveBeenCalledOnce()
  })

  it('does not exit in Dock mode', () => {
    const onFinalWindowGone = vi.fn()
    const lifetime = new UiLifetime({ mode: () => 'dock', onFinalWindowGone })
    lifetime.shellOpened()
    lifetime.shellClosed()
    lifetime.shelfVisible(false)
    expect(onFinalWindowGone).not.toHaveBeenCalled()
  })

  it('keeps Electron resident for local mode and exits after native availability returns', () => {
    const onFinalWindowGone = vi.fn()
    let nativeAvailable = false
    const lifetime = new UiLifetime({ mode: () => 'menu-bar', canExitToNativeHost: () => nativeAvailable, onFinalWindowGone })
    lifetime.shellOpened()
    lifetime.shellClosed()
    expect(onFinalWindowGone).not.toHaveBeenCalled()

    nativeAvailable = true
    lifetime.nativeHostAvailabilityChanged()
    expect(onFinalWindowGone).toHaveBeenCalledOnce()
  })

  it('does not call the final callback twice after shelf and shell transitions', () => {
    const onFinalWindowGone = vi.fn()
    const lifetime = new UiLifetime({ mode: () => 'menu-bar', onFinalWindowGone })
    lifetime.shellOpened()
    lifetime.shelfVisible(true)
    lifetime.shellClosed()
    lifetime.shelfVisible(false)
    lifetime.nativeHostAvailabilityChanged()
    expect(onFinalWindowGone).toHaveBeenCalledOnce()
  })
})
