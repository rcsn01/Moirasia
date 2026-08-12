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
], appearances: { version: 1, revision: 1, values: { moirasia: 'system', amove: 'system', vox: 'dark', exithibition: 'dark', bonded: 'system' } } }
const settings: ShellSettings = { version: 2, launchAtLogin: false, pendingLoginItems: {} }
let navigate: ((page: 'apps' | 'settings') => void) | undefined
function api(): ControllerApi { return { getSnapshot: vi.fn(async () => snapshot), refresh: vi.fn(async () => snapshot), getSettings: vi.fn(async () => settings), openApplication: vi.fn(async () => snapshot), quitApplication: vi.fn(async () => snapshot), setAppearance: vi.fn(async () => snapshot), setAllAppearances: vi.fn(async () => snapshot), setLaunchAtLogin: vi.fn(async (enabled) => ({ ...settings, launchAtLogin: enabled })), setApplicationLoginItem: vi.fn(async () => snapshot), openLoginItemsSettings: vi.fn(async () => {}), onSnapshot: vi.fn(() => vi.fn()), onNavigate: vi.fn((listener) => { navigate = listener; return vi.fn() }) } }

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
    expect(within(screen.getByText('Exithibition').closest('[data-slot="card"]')!).getByRole('button', { name: 'Open' })).toBeDisabled()
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
