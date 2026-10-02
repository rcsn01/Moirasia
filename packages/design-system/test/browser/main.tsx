import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@moirasia/ui-react/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@moirasia/ui-react/components/card'
import { DesktopAppShell, AppearanceScope, applyDocumentAppearance } from '@moirasia/desktop-shell/react'
import { App as ShellApp } from '../../../../src/renderer/shell/app'
import { App as BondedApp } from '../../../../apps/integrated/Bonded/src/renderer/App'
import { DEFAULT_SHELL_SETTINGS, emptyControllerSnapshot, idleUpdateState } from '../../../../src/shared/contracts'
import '../../../../src/renderer/shell/styles.css'
import '../../../../apps/integrated/Bonded/src/renderer/standalone.css'

// Read-only bridges. Nothing reaches Electron, PF, audio devices or persisted user data.
const params = new URLSearchParams(location.search)
const mode = params.get('mode') === 'dark' ? 'dark' : 'light'
const noop = () => () => {}
const forbidden = async () => { throw new Error('Native operations are forbidden in this presentation fixture') }
const bondedSnapshot = {
  version: 3, monitoringEnabled: true, monitorWhenHidden: false, blockingEnabled: false,
  monitorStatus: { state: 'running', message: 'Read-only fixture', startedAt: '2026-08-08T00:00:00.000Z' },
  firewallStatus: { state: 'disabled', message: 'Blocking is off.', helperInstalled: true, ruleCount: 0 },
  capability: { backend: 'pf', scope: 'system-destination', perApplication: false, reason: 'Fixture only' },
  applicationRules: [], learnedAddressCount: 0, addressLimitReached: false,
  applications: [{ id: 'fixture-browser', displayName: 'Fixture browser', recentFlowCount: 1, selected: false, flows: [{ id: 'fixture-flow', timestamp: '2026-08-08T01:02:03.000Z', host: 'example.test', address: '192.0.2.1', port: 443, protocol: 'TCP', blockedByRule: false }] }]
}
window.bonded = {
  getSnapshot: async () => bondedSnapshot, subscribeSnapshot: noop,
  setMonitoring: forbidden, setMonitorWhenHidden: forbidden, installFirewallHelper: forbidden,
  uninstallFirewallHelper: forbidden, setBlocking: forbidden, selectObservedApplication: forbidden,
  removeApplicationRule: forbidden, restartMonitor: forbidden
} as typeof window.bonded
window.desktopShell = { getAppearance: async () => mode, setAppearance: async value => value, onAppearance: noop }
window.githubUpdates = { getUpdateState: async () => idleUpdateState('fixture'), checkForUpdate: forbidden, openReleasePage: forbidden, onUpdateState: noop }
const snapshot = emptyControllerSnapshot()
snapshot.appearances.values.moirasia = mode
snapshot.appearances.values.bonded = mode === 'dark' ? 'light' : 'dark'
snapshot.features = [{ id: 'bonded', installed: true, loaded: true, restartPending: false }]
window.moirasia = {
  getSnapshot: async () => snapshot, getSettings: async () => DEFAULT_SHELL_SETTINGS,
  getPage: async () => 'bonded', getUpdateState: async () => idleUpdateState('fixture'), reportPage: async () => {},
  onSnapshot: noop, onNavigate: noop, onUpdateState: noop,
  setAppearance: async (id, value) => ({ ...snapshot, appearances: { ...snapshot.appearances, values: { ...snapshot.appearances.values, [id]: value } } }),
  openApplication: forbidden, quitApplication: forbidden, installFeature: forbidden, uninstallFeature: forbidden,
  openFeature: forbidden, relaunchApp: forbidden, openLoginItemsSettings: forbidden, checkForUpdate: forbidden, openReleasePage: forbidden
} as typeof window.moirasia

function Reference() {
  const [appearance, setAppearance] = useState(mode)
  applyDocumentAppearance(appearance, false)
  return <DesktopAppShell product="Foundation reference" appearance={appearance} onAppearanceChange={setAppearance}>
    <div style={{ padding: 24 }}>
      <Card><CardHeader><CardTitle>Shared text hierarchy</CardTitle></CardHeader><CardContent>
        <p>Native and web share roles, not layouts.</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><Button>Primary</Button><Button variant="outline">Outline</Button><Button variant="destructive">Danger</Button><Button disabled>Disabled</Button></div>
      </CardContent></Card>
      <AppearanceScope appearance="dark"><div id="outer-dark" style={{ background: 'var(--background)', color: 'var(--foreground)', padding: 12 }}>Dark scope
        <AppearanceScope appearance="light"><div id="inner-light" style={{ background: 'var(--background)', padding: 12 }}>Local light</div></AppearanceScope>
      </div></AppearanceScope>
      <AppearanceScope appearance="light"><div id="outer-light" style={{ background: 'var(--background)', color: 'var(--foreground)', padding: 12 }}>Light scope
        <AppearanceScope appearance="dark"><div id="inner-dark" style={{ background: 'var(--background)', padding: 12 }}>Local dark</div></AppearanceScope>
      </div></AppearanceScope>
    </div>
  </DesktopAppShell>
}

const route = params.get('route')
createRoot(document.getElementById('root')!).render(route === 'shell' ? <ShellApp /> : route === 'standalone' ? <BondedApp /> : <Reference />)
