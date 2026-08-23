// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/renderer/shell/app'
import type { ControllerApi, ControllerSnapshot, ShellSettings } from '../src/shared/contracts'

const snapshot: ControllerSnapshot = { applications: [
  { id: 'amove', label: 'Amove', bundleId: 'com.opense.Amove', installed: true, running: false },
  { id: 'vox', label: 'Vox', bundleId: 'com.moirasia.vox', installed: true, running: true },
  { id: 'exithibition', label: 'Exithibition', bundleId: 'com.local.Exithibition', installed: false, running: false },
  { id: 'bonded', label: 'Bonded', bundleId: 'com.opense.Bonded', installed: true, running: false }
], appearances: { version: 1, revision: 1, values: { moirasia: 'system', amove: 'system', vox: 'dark', exithibition: 'dark', bonded: 'system' } }, features: [
  { id: 'exithibition', installed: true, loaded: true, restartPending: false }
] }
const settings: ShellSettings = { version: 3, launchAtLogin: false, pendingLoginItems: {}, features: { exithibition: true } }
let navigate: ((page: 'apps' | 'settings') => void) | undefined
function api(next: ControllerSnapshot = snapshot): ControllerApi { return { getSnapshot: vi.fn(async () => next), refresh: vi.fn(async () => next), getSettings: vi.fn(async () => settings), openApplication: vi.fn(async () => next), quitApplication: vi.fn(async () => next), setAppearance: vi.fn(async () => next), setAllAppearances: vi.fn(async () => next), setLaunchAtLogin: vi.fn(async (enabled) => ({ ...settings, launchAtLogin: enabled })), setApplicationLoginItem: vi.fn(async () => next), installFeature: vi.fn(async () => next), uninstallFeature: vi.fn(async () => next), openFeature: vi.fn(async () => {}), relaunchApp: vi.fn(async () => {}), openLoginItemsSettings: vi.fn(async () => {}), onSnapshot: vi.fn(() => vi.fn()), onNavigate: vi.fn((listener) => { navigate = listener; return vi.fn() }) } }

beforeEach(() => { vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); document.documentElement.className = '' })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('launcher renderer', () => {
  it('shows install and running states and controls standalone apps', async () => {
    const bridge = api(); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    expect(await screen.findByRole('heading', { name: 'Your apps' })).toBeVisible()
    const amove = screen.getByText('Amove').closest('[data-slot="card"]')!
    await user.click(within(amove).getByRole('button', { name: 'Open' })); await waitFor(() => expect(bridge.openApplication).toHaveBeenCalledWith('amove'))
    const vox = screen.getByText('Vox').closest('[data-slot="card"]')!
    await user.click(within(vox).getByRole('button', { name: 'Quit' })); expect(bridge.quitApplication).toHaveBeenCalledWith('vox')
    const bonded = screen.getByText('Bonded').closest('[data-slot="card"]')!
    await user.click(within(bonded).getByRole('button', { name: 'Open' })); expect(bridge.openApplication).toHaveBeenCalledWith('bonded')
    const externalExithibition = screen.getByText('Not installed').closest('[data-slot="card"]')!
    expect(within(externalExithibition).getByRole('button', { name: 'Open' })).toBeDisabled()
    expect(externalExithibition).toHaveTextContent('Running inside Moirasia')
  })

  it('installs, opens, and uninstalls features from the Inside Moirasia section', async () => {
    const bridge = api(); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    await screen.findByRole('heading', { name: 'Your apps' })
    const section = screen.getByRole('region', { name: 'Inside Moirasia' })
    const tile = within(section).getByText('Exithibition').closest('[data-slot="card"]')!
    expect(within(tile).getByText('Loaded')).toBeVisible()
    expect(screen.queryByText('Restart required')).not.toBeInTheDocument()
    await user.click(within(tile).getByRole('button', { name: 'Open' })); expect(bridge.openFeature).toHaveBeenCalledWith('exithibition')
    await user.click(within(tile).getByRole('button', { name: 'Uninstall' })); expect(bridge.uninstallFeature).toHaveBeenCalledWith('exithibition')
  })

  it('offers an in-place relaunch while a feature waits to unload', async () => {
    const restart: ControllerSnapshot = { ...snapshot, features: [{ id: 'exithibition', installed: false, loaded: true, restartPending: true }] }
    const bridge = api(restart); window.moirasia = bridge; const user = userEvent.setup(); render(<App />)
    await screen.findByRole('heading', { name: 'Your apps' })
    const section = screen.getByRole('region', { name: 'Inside Moirasia' })
    expect(within(section).getByText('Restart pending')).toBeVisible()
    const tile = within(section).getByText('Exithibition').closest('[data-slot="card"]')!
    expect(within(tile).getByRole('button', { name: 'Open' })).toBeDisabled()
    await user.click(within(tile).getByRole('button', { name: 'Install' })); expect(bridge.installFeature).toHaveBeenCalledWith('exithibition')
    await user.click(screen.getByRole('button', { name: 'Restart Moirasia' })); expect(bridge.relaunchApp).toHaveBeenCalled()
  })

  it('shows mixed appearance and independent login items', async () => {
    const bridge = api(); window.moirasia = bridge; const user = userEvent.setup(); render(<App />); await screen.findByRole('heading', { name: 'Your apps' })
    await user.click(screen.getByRole('button', { name: 'Settings' })); expect(await screen.findByRole('heading', { name: 'Settings' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'All apps appearance' })).toHaveValue('mixed')
    expect(screen.getByRole('combobox', { name: 'bonded appearance' })).toHaveValue('system')
    await user.click(screen.getByRole('switch', { name: 'Launch Moirasia at login' })); expect(bridge.setLaunchAtLogin).toHaveBeenCalledWith(true)
    expect(screen.getByRole('switch', { name: 'Launch Exithibition at login' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('switch', { name: 'Launch Bonded at login' })).toBeEnabled()
  })
})
