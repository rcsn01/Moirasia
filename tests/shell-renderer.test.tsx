// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ControllerApi, ControllerPage, ControllerSnapshot, ShellSettings } from '../src/shared/contracts'

vi.mock('../apps/integrated/Amove/src/renderer/main/AmovePanel', () => ({ AmovePanel: () => <div>Amove panel</div> }))
vi.mock('../apps/integrated/Bonded/src/renderer/App', () => ({ BondedPanel: () => <div>Bonded panel</div> }))

import { App } from '../src/renderer/shell/app'

const snapshot: ControllerSnapshot = { applications: [
  { id: 'amove', label: 'Amove', bundleId: 'com.opense.Amove', installed: true, running: false },
  { id: 'vox', label: 'Vox', bundleId: 'com.moirasia.vox', installed: true, running: true },
  { id: 'bonded', label: 'Bonded', bundleId: 'com.opense.Bonded', installed: true, running: false }
], appearances: { version: 1, revision: 1, values: { moirasia: 'system', amove: 'system', vox: 'dark', bonded: 'system' } }, features: [
  { id: 'amove', installed: true, loaded: true, restartPending: false },
  { id: 'bonded', installed: false, loaded: false, restartPending: false }
] }
const settings: ShellSettings = { version: 4, launchAtLogin: false, appPresence: 'dock', pendingLoginItems: {}, features: { amove: true, bonded: false } }
let navigate: ((page: ControllerPage) => void) | undefined
let publishSnapshot: ((snapshot: ControllerSnapshot) => void) | undefined
function api(next: ControllerSnapshot = snapshot, initialPage: ControllerPage = 'general'): ControllerApi { return { getSnapshot: vi.fn(async () => next), refresh: vi.fn(async () => next), getSettings: vi.fn(async () => settings), getPage: vi.fn(async () => initialPage), openApplication: vi.fn(async () => next), quitApplication: vi.fn(async () => next), setAppearance: vi.fn(async () => next), setAllAppearances: vi.fn(async () => next), setLaunchAtLogin: vi.fn(async (enabled) => ({ ...settings, launchAtLogin: enabled })), setAppPresence: vi.fn(async (appPresence) => ({ ...settings, appPresence })), setApplicationLoginItem: vi.fn(async () => next), installFeature: vi.fn(async () => next), uninstallFeature: vi.fn(async () => next), openFeature: vi.fn(async () => {}), reportPage: vi.fn(async () => {}), relaunchApp: vi.fn(async () => {}), openLoginItemsSettings: vi.fn(async () => {}), onSnapshot: vi.fn((listener) => { publishSnapshot = listener; return vi.fn() }), onNavigate: vi.fn((listener) => { navigate = listener; return vi.fn() }) } }

beforeEach(() => { navigate = undefined; publishSnapshot = undefined; vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); document.documentElement.className = '' })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Moirasia renderer', () => {
  it('starts on General and groups available embedded apps in the sidebar', async () => {
    const bridge = api(); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)

    expect(await screen.findByRole('heading', { name: 'General' })).toBeVisible()
    expect(screen.getByText('Choose how Moirasia appears on your Mac.')).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Dock Icon' })).toBeChecked()
    expect(bridge.reportPage).toHaveBeenCalledWith('general')
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'Essentials' })).toBeVisible()
    const apps = screen.getByRole('group', { name: 'Apps' })
    expect(within(apps).getByRole('button', { name: 'Amove' })).toBeVisible()
    expect(within(apps).queryByRole('button', { name: 'Bonded' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Vox' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Menu Bar' }))
    expect(bridge.setAppPresence).toHaveBeenCalledWith('menu-bar')

    await user.click(screen.getByRole('button', { name: 'Features' }))
    expect(await screen.findByRole('heading', { name: 'Features' })).toBeVisible()
    expect(bridge.reportPage).toHaveBeenLastCalledWith('features')
  })

  it('restores the page remembered by the main process', async () => {
    const bridge = api(snapshot, 'amove'); window.moirasia = bridge; render(<App />)

    expect(await screen.findByText('Amove panel')).toBeVisible()
    expect(bridge.reportPage).toHaveBeenCalledWith('amove')
  })

  it('installs, opens, and uninstalls features from the Features page', async () => {
    const bridge = api(); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    await screen.findByRole('heading', { name: 'General' })
    await user.click(screen.getByRole('button', { name: 'Features' }))

    const amove = screen.getByRole('heading', { name: 'Bonded', level: 3 }).closest('[data-slot="card"]')!
    expect(within(amove).getByText('Not loaded')).toBeVisible()
    expect(within(amove).queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
    await user.click(within(amove).getByRole('button', { name: 'Install' }))
    expect(bridge.installFeature).toHaveBeenCalledWith('bonded')

    const loadedAmove = screen.getByRole('heading', { name: 'Amove', level: 3 }).closest('[data-slot="card"]')!
    expect(within(loadedAmove).getByText('Loaded')).toBeVisible()
    await user.click(within(loadedAmove).getByRole('button', { name: 'Open' }))
    expect(bridge.openFeature).toHaveBeenCalledWith('amove')
    await user.click(within(loadedAmove).getByRole('button', { name: 'Uninstall' }))
    expect(bridge.uninstallFeature).toHaveBeenCalledWith('amove')

  })

  it('opens loaded Bonded and unmounts its panel after leaving the tab', async () => {
    const bondedSnapshot: ControllerSnapshot = { ...snapshot, features: snapshot.features.map((feature) => feature.id === 'bonded' ? { ...feature, installed: true, loaded: true } : feature) }
    const bridge = api(bondedSnapshot); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    await screen.findByRole('heading', { name: 'General' })

    await user.click(screen.getByRole('button', { name: 'Bonded' }))
    expect(await screen.findByText('Bonded panel')).toBeVisible()
    expect(bridge.reportPage).toHaveBeenLastCalledWith('bonded')
    await user.click(screen.getByRole('button', { name: 'General' }))
    expect(screen.queryByText('Bonded panel')).not.toBeInTheDocument()
  })

  it('offers Retry for an installed feature whose backend failed to load', async () => {
    const failed: ControllerSnapshot = { ...snapshot, features: snapshot.features.map((feature) => feature.id === 'bonded' ? { ...feature, installed: true, loadError: 'Bonded is already running in Bonded.' } : feature) }
    const bridge = api(failed); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    await screen.findByRole('heading', { name: 'General' })
    await user.click(screen.getByRole('button', { name: 'Features' }))
    const tile = screen.getByRole('heading', { name: 'Bonded', level: 3 }).closest('[data-slot="card"]')!
    expect(within(tile).getByText(/already running in Bonded/)).toBeVisible()
    await user.click(within(tile).getByRole('button', { name: 'Retry' }))
    expect(bridge.installFeature).toHaveBeenCalledWith('bonded')
  })

  it('offers an in-place relaunch while a feature waits to unload', async () => {
    const restart: ControllerSnapshot = { ...snapshot, features: snapshot.features.map((feature) => feature.id === 'amove' ? { ...feature, installed: false, restartPending: true } : feature) }
    const bridge = api(restart); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    await screen.findByRole('heading', { name: 'General' })
    await user.click(screen.getByRole('button', { name: 'Features' }))

    expect(screen.getByText('Restart pending')).toBeVisible()
    const tile = screen.getByRole('heading', { name: 'Amove', level: 3 }).closest('[data-slot="card"]')!
    expect(within(tile).queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
    await user.click(within(tile).getByRole('button', { name: 'Install' }))
    expect(bridge.installFeature).toHaveBeenCalledWith('amove')
    await user.click(screen.getByRole('button', { name: 'Restart Moirasia' }))
    expect(bridge.relaunchApp).toHaveBeenCalled()
  })

  it('returns to General and reports the transition when the selected feature becomes unavailable', async () => {
    const bridge = api(); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    await screen.findByRole('heading', { name: 'General' })
    await user.click(screen.getByRole('button', { name: 'Amove' }))
    expect(await screen.findByText('Amove panel')).toBeVisible()
    expect(bridge.reportPage).toHaveBeenLastCalledWith('amove')

    act(() => publishSnapshot?.({ ...snapshot, features: snapshot.features.map((feature) => feature.id === 'amove' ? { ...feature, installed: false, restartPending: true } : feature) }))

    expect(await screen.findByRole('heading', { name: 'General' })).toBeVisible()
    await waitFor(() => expect(bridge.reportPage).toHaveBeenLastCalledWith('general'))
    expect(within(screen.getByRole('group', { name: 'Apps' })).queryByRole('button', { name: 'Amove' })).not.toBeInTheDocument()
    expect(screen.queryByText('Amove panel')).not.toBeInTheDocument()
  })

  it('accepts feature-initiated navigation and lets Essentials clear the selection', async () => {
    const bridge = api(); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    await screen.findByRole('heading', { name: 'General' })

    act(() => navigate?.('amove'))
    expect(await screen.findByText('Amove panel')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Amove' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('button', { name: 'General' }))
    expect(await screen.findByRole('heading', { name: 'General' })).toBeVisible()
    expect(bridge.reportPage).toHaveBeenLastCalledWith('general')
  })
})
