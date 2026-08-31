// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ControllerApi, ControllerPage, ControllerSnapshot, ShellSettings } from '../src/shared/contracts'

vi.mock('../apps/integrated/Amove/src/renderer/main/AmovePanel', () => ({ AmovePanel: () => <div>Amove panel</div> }))
vi.mock('../apps/integrated/Vox/src/renderer/App', () => ({ VoxPanel: () => <div>Vox panel</div> }))
vi.mock('../apps/integrated/Exithibition/src/renderer/App', () => ({ ExithibitionPanel: () => <div>Exithibition panel</div> }))
vi.mock('../apps/integrated/Bonded/src/renderer/App', () => ({ BondedPanel: () => <div>Bonded panel</div> }))
vi.mock('../apps/integrated/Orbis/src/renderer/App', () => ({ OrbisPanel: () => <div>Orbis panel</div> }))

import { App } from '../src/renderer/shell/app'

const snapshot: ControllerSnapshot = { applications: [
  { id: 'amove', label: 'Amove', bundleId: 'com.opense.Amove', installed: true, running: false },
  { id: 'vox', label: 'Vox', bundleId: 'com.moirasia.vox', installed: true, running: true },
  { id: 'exithibition', label: 'Exithibition', bundleId: 'com.local.Exithibition', installed: false, running: false },
  { id: 'bonded', label: 'Bonded', bundleId: 'com.opense.Bonded', installed: true, running: false },
  { id: 'orbis', label: 'Orbis', bundleId: 'com.opense.Orbis', installed: true, running: false }
], appearances: { version: 1, revision: 1, values: { moirasia: 'system', amove: 'system', vox: 'dark', exithibition: 'dark', bonded: 'system', orbis: 'system' } }, features: [
  { id: 'amove', installed: false, loaded: false, restartPending: false },
  { id: 'exithibition', installed: true, loaded: true, restartPending: false },
  { id: 'orbis', installed: true, loaded: false, restartPending: false }
] }
const settings: ShellSettings = { version: 3, launchAtLogin: false, pendingLoginItems: {}, features: { amove: false, exithibition: true, orbis: true } }
let navigate: ((page: ControllerPage) => void) | undefined
let publishSnapshot: ((snapshot: ControllerSnapshot) => void) | undefined
function api(next: ControllerSnapshot = snapshot): ControllerApi { return { getSnapshot: vi.fn(async () => next), refresh: vi.fn(async () => next), getSettings: vi.fn(async () => settings), openApplication: vi.fn(async () => next), quitApplication: vi.fn(async () => next), setAppearance: vi.fn(async () => next), setAllAppearances: vi.fn(async () => next), setLaunchAtLogin: vi.fn(async (enabled) => ({ ...settings, launchAtLogin: enabled })), setApplicationLoginItem: vi.fn(async () => next), installFeature: vi.fn(async () => next), uninstallFeature: vi.fn(async () => next), openFeature: vi.fn(async () => {}), reportPage: vi.fn(async () => {}), relaunchApp: vi.fn(async () => {}), openLoginItemsSettings: vi.fn(async () => {}), onSnapshot: vi.fn((listener) => { publishSnapshot = listener; return vi.fn() }), onNavigate: vi.fn((listener) => { navigate = listener; return vi.fn() }) } }

beforeEach(() => { navigate = undefined; publishSnapshot = undefined; vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); document.documentElement.className = '' })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Moirasia renderer', () => {
  it('starts on General and groups available embedded apps in the sidebar', async () => {
    const bridge = api(); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)

    expect(await screen.findByRole('heading', { name: 'General' })).toBeVisible()
    expect(screen.getByText('General settings will appear here.')).toBeVisible()
    expect(bridge.reportPage).toHaveBeenCalledWith('general')
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'Essentials' })).toBeVisible()
    const apps = screen.getByRole('group', { name: 'Apps' })
    expect(within(apps).getByRole('button', { name: 'Exithibition' })).toBeVisible()
    expect(within(apps).queryByRole('button', { name: 'Amove' })).not.toBeInTheDocument()
    expect(within(apps).queryByRole('button', { name: 'Orbis' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Vox' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bonded' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Features' }))
    expect(await screen.findByRole('heading', { name: 'Features' })).toBeVisible()
    expect(bridge.reportPage).toHaveBeenLastCalledWith('features')
  })

  it('installs, opens, and uninstalls features from the Features page', async () => {
    const bridge = api(); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    await screen.findByRole('heading', { name: 'General' })
    await user.click(screen.getByRole('button', { name: 'Features' }))

    const amove = screen.getByRole('heading', { name: 'Amove', level: 3 }).closest('[data-slot="card"]')!
    expect(within(amove).getByText('Not loaded')).toBeVisible()
    expect(within(amove).getByRole('button', { name: 'Unavailable' })).toBeDisabled()
    await user.click(within(amove).getByRole('button', { name: 'Install' }))
    expect(bridge.installFeature).toHaveBeenCalledWith('amove')

    const exithibition = screen.getByRole('heading', { name: 'Exithibition', level: 3 }).closest('[data-slot="card"]')!
    expect(within(exithibition).getByText('Loaded')).toBeVisible()
    await user.click(within(exithibition).getByRole('button', { name: 'Open' }))
    expect(bridge.openFeature).toHaveBeenCalledWith('exithibition')
    await user.click(within(exithibition).getByRole('button', { name: 'Uninstall' }))
    expect(bridge.uninstallFeature).toHaveBeenCalledWith('exithibition')

    const orbis = screen.getByRole('heading', { name: 'Orbis', level: 3 }).closest('[data-slot="card"]')!
    expect(within(orbis).getByRole('button', { name: 'Unavailable' })).toBeDisabled()
    expect(within(orbis).getByRole('button', { name: 'Uninstall' })).toBeEnabled()
  })

  it('opens loaded Vox and keeps its panel mounted after leaving the tab', async () => {
    const voxSnapshot: ControllerSnapshot = { ...snapshot, features: [...snapshot.features, { id: 'vox', installed: true, loaded: true, restartPending: false }] }
    const bridge = api(voxSnapshot); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    await screen.findByRole('heading', { name: 'General' })

    await user.click(screen.getByRole('button', { name: 'Vox' }))
    expect(await screen.findByText('Vox panel')).toBeVisible()
    expect(bridge.reportPage).toHaveBeenLastCalledWith('vox')
    await user.click(screen.getByRole('button', { name: 'General' }))
    expect(screen.getByText('Vox panel')).not.toBeVisible()
  })

  it('opens loaded Bonded and keeps its panel mounted after leaving the tab', async () => {
    const bondedSnapshot: ControllerSnapshot = { ...snapshot, features: [...snapshot.features, { id: 'bonded', installed: true, loaded: true, restartPending: false }] }
    const bridge = api(bondedSnapshot); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    await screen.findByRole('heading', { name: 'General' })

    await user.click(screen.getByRole('button', { name: 'Bonded' }))
    expect(await screen.findByText('Bonded panel')).toBeVisible()
    expect(bridge.reportPage).toHaveBeenLastCalledWith('bonded')
    await user.click(screen.getByRole('button', { name: 'General' }))
    expect(screen.getByText('Bonded panel')).not.toBeVisible()
  })

  it('offers Retry for an installed feature whose backend failed to load', async () => {
    const failed: ControllerSnapshot = { ...snapshot, features: [...snapshot.features, { id: 'vox', installed: true, loaded: false, restartPending: false, loadError: 'Vox is already using Vox.' }] }
    const bridge = api(failed); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    await screen.findByRole('heading', { name: 'General' })
    await user.click(screen.getByRole('button', { name: 'Features' }))
    const tile = screen.getByRole('heading', { name: 'Vox', level: 3 }).closest('[data-slot="card"]')!
    expect(within(tile).getByText(/already using Vox/)).toBeVisible()
    await user.click(within(tile).getByRole('button', { name: 'Retry' }))
    expect(bridge.installFeature).toHaveBeenCalledWith('vox')
  })

  it('offers an in-place relaunch while a feature waits to unload', async () => {
    const restart: ControllerSnapshot = { ...snapshot, features: snapshot.features.map((feature) => feature.id === 'exithibition' ? { ...feature, installed: false, restartPending: true } : feature) }
    const bridge = api(restart); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    await screen.findByRole('heading', { name: 'General' })
    await user.click(screen.getByRole('button', { name: 'Features' }))

    expect(screen.getByText('Restart pending')).toBeVisible()
    const tile = screen.getByRole('heading', { name: 'Exithibition', level: 3 }).closest('[data-slot="card"]')!
    expect(within(tile).getByRole('button', { name: 'Open' })).toBeDisabled()
    await user.click(within(tile).getByRole('button', { name: 'Install' }))
    expect(bridge.installFeature).toHaveBeenCalledWith('exithibition')
    await user.click(screen.getByRole('button', { name: 'Restart Moirasia' }))
    expect(bridge.relaunchApp).toHaveBeenCalled()
  })

  it('returns to General and reports the transition when the selected feature becomes unavailable', async () => {
    const bridge = api(); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    await screen.findByRole('heading', { name: 'General' })
    await user.click(screen.getByRole('button', { name: 'Exithibition' }))
    expect(await screen.findByText('Exithibition panel')).toBeVisible()
    expect(bridge.reportPage).toHaveBeenLastCalledWith('exithibition')

    act(() => publishSnapshot?.({ ...snapshot, features: snapshot.features.map((feature) => feature.id === 'exithibition' ? { ...feature, installed: false, restartPending: true } : feature) }))

    expect(await screen.findByRole('heading', { name: 'General' })).toBeVisible()
    await waitFor(() => expect(bridge.reportPage).toHaveBeenLastCalledWith('general'))
    expect(within(screen.getByRole('group', { name: 'Apps' })).queryByRole('button', { name: 'Exithibition' })).not.toBeInTheDocument()
    expect(screen.queryByText('Exithibition panel')).not.toBeInTheDocument()
  })

  it('accepts feature-initiated navigation and lets Essentials clear the selection', async () => {
    const bridge = api(); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    await screen.findByRole('heading', { name: 'General' })

    act(() => navigate?.('exithibition'))
    expect(await screen.findByText('Exithibition panel')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Exithibition' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('button', { name: 'General' }))
    expect(await screen.findByRole('heading', { name: 'General' })).toBeVisible()
    expect(bridge.reportPage).toHaveBeenLastCalledWith('general')
  })
})
