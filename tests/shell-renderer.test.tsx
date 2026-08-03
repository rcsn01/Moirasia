// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/renderer/shell/app'
import { applyTheme, resolveTheme } from '../src/renderer/shell/theme'
import {
  SHELL_RAIL_WIDTHS,
  type ModuleId,
  type ModuleSnapshot,
  type ShellApi,
  type ShellSettings,
  type ShellSettingsPatch
} from '../src/shared/contracts'

const stoppedSnapshot: ModuleSnapshot = {
  activeModuleId: null,
  modules: [
    { id: 'amove', label: 'Amove', state: 'stopped', active: false, available: true },
    { id: 'vox', label: 'Vox', state: 'running', active: false, available: true },
    { id: 'exithibition', label: 'Exithibition', state: 'stopped', active: false, available: false, unavailableReason: 'Not installed' }
  ]
}

const defaultSettings: ShellSettings = {
  version: 1,
  appearance: 'system',
  launchAtLogin: false,
  autoStart: { amove: false, vox: false, exithibition: false },
  restoreLastSelection: true,
  compactRail: false,
  priorSelection: 'home'
}

class MediaQueryMock {
  matches = false
  readonly media = '(prefers-color-scheme: dark)'
  readonly onchange = null
  readonly listeners = new Set<() => void>()
  addEventListener(_type: string, listener: () => void): void { this.listeners.add(listener) }
  removeEventListener(_type: string, listener: () => void): void { this.listeners.delete(listener) }
  addListener(listener: () => void): void { this.listeners.add(listener) }
  removeListener(listener: () => void): void { this.listeners.delete(listener) }
  dispatchEvent(): boolean { for (const listener of this.listeners) listener(); return true }
  change(matches: boolean): void { this.matches = matches; this.dispatchEvent() }
}

class ResizeObserverMock {
  static instance: ResizeObserverMock | undefined
  readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) { this.callback = callback; ResizeObserverMock.instance = this }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  measure(width: number): void {
    this.callback([{
      borderBoxSize: [{ inlineSize: width }],
      contentRect: { width: width - 17 }
    } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
}

let media: MediaQueryMock
let snapshotListener: ((snapshot: ModuleSnapshot) => void) | undefined
let navigateListener: ((destination: 'home' | 'settings' | ModuleId) => void) | undefined

function makeApi(overrides: Partial<ShellApi> = {}): ShellApi {
  let settings = structuredClone(defaultSettings)
  return {
    getSnapshot: vi.fn(async () => stoppedSnapshot),
    getSettings: vi.fn(async () => settings),
    updateSettings: vi.fn(async (patch: ShellSettingsPatch) => {
      settings = { ...settings, ...patch, autoStart: { ...settings.autoStart, ...patch.autoStart } }
      return settings
    }),
    startModule: vi.fn(async () => stoppedSnapshot),
    activateModule: vi.fn(async () => stoppedSnapshot),
    stopModule: vi.fn(async () => stoppedSnapshot),
    showPage: vi.fn(async () => stoppedSnapshot),
    setRailWidth: vi.fn(),
    quit: vi.fn(),
    onSnapshot: vi.fn((listener) => { snapshotListener = listener; return vi.fn() }),
    onNavigate: vi.fn((listener) => { navigateListener = listener; return vi.fn() }),
    ...overrides
  }
}

beforeEach(() => {
  media = new MediaQueryMock()
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  snapshotListener = undefined
  navigateListener = undefined
  document.documentElement.className = ''
  document.documentElement.style.colorScheme = ''
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('shell renderer', () => {
  it('shows loading, resolves the initial state, and responds to IPC snapshots and navigation', async () => {
    let resolveSnapshot!: (value: ModuleSnapshot) => void
    const api = makeApi({ getSnapshot: vi.fn(() => new Promise((resolve) => { resolveSnapshot = resolve })) })
    window.moirasia = api
    render(<App />)

    expect(screen.getByLabelText('Loading workspace')).toHaveAttribute('aria-busy', 'true')
    await act(async () => resolveSnapshot(stoppedSnapshot))
    expect(await screen.findByRole('heading', { name: 'Choose a module' })).toBeVisible()

    act(() => navigateListener?.('settings'))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible()
    act(() => snapshotListener?.({ ...stoppedSnapshot, activeModuleId: 'amove', modules: stoppedSnapshot.modules.map((item) => item.id === 'amove' ? { ...item, state: 'running', active: true } : item) }))
    act(() => navigateListener?.('amove'))
    expect(screen.getByRole('heading', { name: 'Amove' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Amove' }).closest('section')).toHaveTextContent('running')
  })

  it('starts then activates stopped modules, only activates running modules, and quits modules', async () => {
    const api = makeApi()
    window.moirasia = api
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Choose a module' })

    await user.click(within(screen.getByRole('heading', { name: 'Amove', level: 3 }).closest('[data-slot="card"]')!).getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(api.startModule).toHaveBeenCalledWith('amove'))
    expect(api.activateModule).toHaveBeenCalledWith('amove')

    act(() => navigateListener?.('home'))
    await user.click(within(screen.getByRole('heading', { name: 'Vox', level: 3 }).closest('[data-slot="card"]')!).getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(api.activateModule).toHaveBeenCalledWith('vox'))
    expect(api.startModule).not.toHaveBeenCalledWith('vox')

    act(() => navigateListener?.('home'))
    await user.click(within(screen.getByRole('heading', { name: 'Vox', level: 3 }).closest('[data-slot="card"]')!).getByRole('button', { name: 'Quit Module' }))
    expect(api.stopModule).toHaveBeenCalledWith('vox')
  })

  it('keeps transition controls disabled and leaves action failures visible until another action', async () => {
    const transitional: ModuleSnapshot = { ...stoppedSnapshot, modules: stoppedSnapshot.modules.map((item) => item.id === 'amove' ? { ...item, state: 'starting' } : item) }
    const api = makeApi({ getSnapshot: vi.fn(async () => transitional), showPage: vi.fn().mockRejectedValueOnce(new Error('Could not switch views')).mockResolvedValue(stoppedSnapshot) })
    window.moirasia = api
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Choose a module' })
    expect(within(screen.getByRole('heading', { name: 'Amove', level: 3 }).closest('[data-slot="card"]')!).getByRole('button', { name: 'Start' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not switch views')
    await user.click(screen.getByRole('button', { name: 'Home' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('sends exact controlled Settings patches', async () => {
    const api = makeApi()
    window.moirasia = api
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Choose a module' })
    await user.click(screen.getByRole('button', { name: 'Settings' }))

    await user.click(screen.getByRole('switch', { name: 'Launch at login' }))
    await user.click(screen.getByRole('switch', { name: 'Restore last selected module or page' }))
    await user.click(screen.getByRole('switch', { name: 'Start Amove with Moirasia' }))
    await user.click(screen.getByRole('switch', { name: 'Start Vox with Moirasia' }))
    await user.click(screen.getByRole('switch', { name: 'Start Exithibition with Moirasia' }))
    screen.getByRole('combobox', { name: 'Appearance' }).focus()
    await user.keyboard('d{Enter}')

    expect(api.updateSettings).toHaveBeenCalledWith({ launchAtLogin: true })
    expect(api.updateSettings).toHaveBeenCalledWith({ restoreLastSelection: false })
    expect(api.updateSettings).toHaveBeenCalledWith({ autoStart: { amove: true } })
    expect(api.updateSettings).toHaveBeenCalledWith({ autoStart: { vox: true } })
    expect(api.updateSettings).toHaveBeenCalledWith({ autoStart: { exithibition: true } })
    expect(api.updateSettings).toHaveBeenCalledWith({ appearance: 'dark' })
  })

  it('collapses accessibly, publishes measured rail widths, and transfers focus with F6', async () => {
    const api = makeApi()
    window.moirasia = api
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Choose a module' })
    expect(api.setRailWidth).toHaveBeenCalledWith(SHELL_RAIL_WIDTHS.expanded)

    const collapse = screen.getByRole('button', { name: 'Collapse sidebar' })
    collapse.focus()
    fireEvent.keyDown(window, { key: 'F6' })
    expect(screen.getByRole('main')).toHaveFocus()
    fireEvent.keyDown(window, { key: 'F6' })
    expect(screen.getByRole('button', { name: 'Home' })).toHaveFocus()

    await user.click(collapse)
    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeVisible()
    expect(api.updateSettings).toHaveBeenCalledWith({ compactRail: true })
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAccessibleName('Home')
    act(() => ResizeObserverMock.instance?.measure(48))
    expect(api.setRailWidth).toHaveBeenCalledWith(SHELL_RAIL_WIDTHS.compact)
  })

  it('cleans up IPC subscriptions', async () => {
    const offSnapshot = vi.fn()
    const offNavigate = vi.fn()
    const api = makeApi({ onSnapshot: vi.fn((listener) => { snapshotListener = listener; return offSnapshot }), onNavigate: vi.fn((listener) => { navigateListener = listener; return offNavigate }) })
    window.moirasia = api
    const view = render(<App />)
    await screen.findByRole('heading', { name: 'Choose a module' })
    view.unmount()
    expect(offSnapshot).toHaveBeenCalledOnce()
    expect(offNavigate).toHaveBeenCalledOnce()
  })

  it('has no serious accessibility violations on primary and collapsed views', async () => {
    const api = makeApi()
    window.moirasia = api
    const user = userEvent.setup()
    const view = render(<App />)
    await screen.findByRole('heading', { name: 'Choose a module' })
    let result = await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    result = await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])
  })
})

describe('theme resolution', () => {
  it('resolves light, dark, and system preferences and follows system changes', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(applyTheme('system', true)).toBe('dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(applyTheme('system', false)).toBe('light')
    expect(document.documentElement).toHaveClass('light')
  })

  it('tracks runtime system-theme changes while system appearance is selected', async () => {
    window.moirasia = makeApi()
    render(<App />)
    await screen.findByRole('heading', { name: 'Choose a module' })
    expect(document.documentElement).toHaveClass('light')
    act(() => media.change(true))
    expect(document.documentElement).toHaveClass('dark')
    act(() => media.change(false))
    expect(document.documentElement).toHaveClass('light')
  })
})
