// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BondedPanel } from '../apps/integrated/Bonded/src/renderer/App'
import type { BondedApi, BondedSnapshot } from '../apps/integrated/Bonded/src/shared/contracts'

const snapshot: BondedSnapshot = {
  version: 3,
  monitoringEnabled: true,
  blockingEnabled: false,
  monitorStatus: { state: 'running', message: 'Watching live network activity.' },
  firewallStatus: { state: 'disabled', message: 'Blocking is off.', helperInstalled: true },
  capability: { backend: 'pf', scope: 'system-destination', perApplication: false, reason: 'Observed IPs affect every app.' },
  applicationRules: [{ id: 'app_0123456789abcdef', path: '/Applications/Mail.app', displayName: 'Mail', targetKind: 'application', selectedAt: '2026-08-08T00:00:00.000Z', learnedAddresses: ['93.184.216.34'], state: 'learning' }],
  learnedAddressCount: 1,
  addressLimitReached: false,
  applications: [{ id: 'app_aaaaaaaaaaaaaaaa', displayName: 'Safari', recentFlowCount: 1, selected: false, flows: [] }]
}

function api(): BondedApi {
  return {
    getSnapshot: vi.fn().mockResolvedValue(snapshot),
    setMonitoring: vi.fn().mockResolvedValue(snapshot),
    installFirewallHelper: vi.fn().mockResolvedValue(snapshot),
    uninstallFirewallHelper: vi.fn().mockResolvedValue(snapshot),
    setBlocking: vi.fn().mockResolvedValue(snapshot),
    selectObservedApplication: vi.fn().mockResolvedValue(snapshot),
    removeApplicationRule: vi.fn().mockResolvedValue(snapshot),
    restartMonitor: vi.fn().mockResolvedValue(snapshot),
    subscribeSnapshot: vi.fn().mockReturnValue(() => {})
  }
}

beforeEach(() => vi.spyOn(window, 'confirm').mockReturnValue(true))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Bonded application workspace', () => {
  it('shows observed and blocked applications together without tab navigation', async () => {
    const bridge = api()
    render(<BondedPanel bridge={bridge} appearance="light" />)

    expect(await screen.findByRole('region', { name: 'Observed applications' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Blocked applications' })).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Bonded views' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Network Monitor' })).not.toBeInTheDocument()
    expect(screen.queryByText('Global observed-IP firewall.')).not.toBeInTheDocument()
  })

  it('moves applications in either direction with arrow controls', async () => {
    const bridge = api()
    const user = userEvent.setup()
    render(<BondedPanel bridge={bridge} appearance="light" />)

    await user.click(await screen.findByRole('button', { name: 'Move Safari to blocked applications' }))
    await waitFor(() => expect(bridge.selectObservedApplication).toHaveBeenCalledWith('app_aaaaaaaaaaaaaaaa'))

    await user.click(screen.getByRole('button', { name: 'Move Mail to observed applications' }))
    await waitFor(() => expect(bridge.removeApplicationRule).toHaveBeenCalledWith('app_0123456789abcdef'))
  })

  it('moves applications by dropping them on the other panel', async () => {
    const bridge = api()
    render(<BondedPanel bridge={bridge} appearance="light" />)
    await screen.findByText('Safari')
    const values = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? ''
    }

    fireEvent.dragStart(screen.getByTestId('observed-application-app_aaaaaaaaaaaaaaaa'), { dataTransfer })
    fireEvent.dragOver(screen.getByRole('region', { name: 'Blocked applications' }), { dataTransfer })
    fireEvent.drop(screen.getByRole('region', { name: 'Blocked applications' }), { dataTransfer })
    await waitFor(() => expect(bridge.selectObservedApplication).toHaveBeenCalledWith('app_aaaaaaaaaaaaaaaa'))

    fireEvent.dragStart(screen.getByTestId('blocked-application-app_0123456789abcdef'), { dataTransfer })
    fireEvent.dragOver(screen.getByRole('region', { name: 'Observed applications' }), { dataTransfer })
    fireEvent.drop(screen.getByRole('region', { name: 'Observed applications' }), { dataTransfer })
    await waitFor(() => expect(bridge.removeApplicationRule).toHaveBeenCalledWith('app_0123456789abcdef'))
  })
})
