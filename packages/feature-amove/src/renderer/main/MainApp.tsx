import React, { useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@moirasia/ui-react/components/alert'
import { Badge } from '@moirasia/ui-react/components/badge'
import { Button } from '@moirasia/ui-react/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@moirasia/ui-react/components/card'
import { RadioGroup, RadioGroupItem } from '@moirasia/ui-react/components/radio-group'
import { AppearanceScope, AppearanceToggle, DesktopAppShell, DesktopContentHeader, DesktopPage, useProductAppearance } from '@moirasia/desktop-shell/react'
import { Accessibility, Keyboard, Monitor, RefreshCw, RotateCcw, ShieldCheck } from '@moirasia/ui-react/lib/icons'
import type { Appearance } from '@moirasia/desktop-shell'
import type { MainBridge, MainState, ShortcutBinding, WindowActionId } from '../../shared/contracts'
import { windowActionIds } from '../../shared/contracts'
import { actionMeta, defaultBindings } from '../../shared/defaults'
import { shortcutLabel } from '../../shared/shortcuts'

const amoveIconUrl = new URL('../../../assets/app/icon.svg', import.meta.url).href

export interface AmovePanelProps {
  readonly bridge: MainBridge
  readonly appearance: Appearance
  readonly onAppearanceChange: (appearance: Appearance) => void
  /** Standalone chrome already owns the product toggle; suite panels show it locally. */
  readonly embeddedHeader?: boolean
}

/** Reusable Amove content. It owns no window, root, or renderer global. */
export function AmovePanel({ bridge, appearance, onAppearanceChange, embeddedHeader = false }: AmovePanelProps): React.JSX.Element {
  const [state, setState] = useState<MainState>()
  useEffect(() => { let active = true; void bridge.getState().then((next) => active && setState(next)); const unsubscribe = bridge.subscribe((next) => active && setState(next)); return () => { active = false; unsubscribe() } }, [bridge])
  return <AppearanceScope appearance={appearance} className="amove-feature-panel">
    {embeddedHeader && <header className="amove-feature-panel__header"><strong>Amove</strong><AppearanceToggle value={appearance} onChange={onAppearanceChange} /></header>}
    <DesktopPage width="wide" className="amove-feature-panel__page">
      {!state ? <div className="amove-feature-panel__loading" role="status">Opening Amove…</div> : <div className="amove-feature-panel__settings-page">
        <DesktopContentHeader title="Shortcuts & settings" description="Window routing and temporary file staging" />
        <div className="amove-feature-panel__combined-page">
          <img className="amove-feature-panel__brand-mark amove-feature-panel__sr-only" src={amoveIconUrl} alt="" data-testid="brand.icon" />
          {state.migrationWarning && <Alert variant="destructive" className="amove-feature-panel__migration-warning"><AlertTitle>Settings migration</AlertTitle><AlertDescription>{state.migrationWarning}</AlertDescription></Alert>}
          <div className="amove-feature-panel__settings-workspace">
            <Shortcuts bridge={bridge} state={state} />
            <Settings bridge={bridge} state={state} />
          </div>
        </div>
      </div>}
    </DesktopPage>
  </AppearanceScope>
}

/** Standalone entry point retained for Amove's existing BrowserWindow. */
export function MainApp(): React.JSX.Element {
  const [appearance, setAppearance] = useProductAppearance(window.desktopShell)
  return <DesktopAppShell product="Amove" appearance={appearance} onAppearanceChange={setAppearance}>
    <AmovePanel bridge={window.amove} appearance={appearance} onAppearanceChange={setAppearance} />
  </DesktopAppShell>
}

function Shortcuts({ bridge, state }: { bridge: MainBridge; state: MainState }): React.JSX.Element {
  const bindings = resolvedBindings(state)
  return <Pane title="Custom Window Shortcuts" description="Focus a shortcut and press a modifier-based key combination." icon={<Keyboard aria-hidden="true" />} actions={<Button size="sm" onClick={() => void bridge.resetShortcut()}><RotateCcw />Reset defaults</Button>}>
    <div className="amove-feature-panel__shortcut-table">
      <div className="amove-feature-panel__shortcut-table-head" aria-hidden="true"><span>Action</span><span>Shortcut</span></div>
      <div className="amove-feature-panel__shortcut-list">{windowActionIds.map((action) => {
        const issues = state.shortcutIssues.filter((issue) => issue.action === action)
        return <div key={action} className="amove-feature-panel__shortcut-row">
          <div className="amove-feature-panel__shortcut-action"><span className="amove-feature-panel__shortcut-glyph" aria-hidden="true">{actionMeta[action].icon}</span><h3>{actionMeta[action].title}</h3></div>
          <div className="amove-feature-panel__shortcut-controls"><ShortcutRecorder bridge={bridge} action={action} binding={bindings[action]} platform={state.platform} />{issues.map((issue) => <small key={issue.code} className={issue.code === 'duplicate' ? 'amove-feature-panel__issue amove-feature-panel__issue--warning' : 'amove-feature-panel__issue'}>{issue.message}</small>)}</div>
        </div>
      })}</div>
      <div className={`amove-feature-panel__shortcut-status ${state.shortcutIssues.length > 0 ? 'amove-feature-panel__shortcut-status--issues' : ''}`} role="status"><span className="amove-feature-panel__status-dot" aria-hidden="true" /><span>{state.statusMessage}</span></div>
    </div>
  </Pane>
}

function ShortcutRecorder({ bridge, action, binding, platform }: { bridge: MainBridge; action: WindowActionId; binding: ShortcutBinding; platform: MainState['platform'] }): React.JSX.Element {
  const [capturing, setCapturing] = useState(false)
  return <div className="amove-feature-panel__recorder-wrap"><Button className={`amove-feature-panel__recorder ${capturing ? 'amove-feature-panel__recorder--capturing' : ''}`} aria-label={`Record ${actionMeta[action].title}`} onFocus={() => { setCapturing(true); void bridge.setShortcutRecording(true) }} onBlur={() => { setCapturing(false); void bridge.setShortcutRecording(false) }} onKeyDown={(event) => {
    event.preventDefault(); event.stopPropagation()
    if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(event.code)) return
    const modifiers = ([event.ctrlKey && 'control', event.altKey && 'alt', event.shiftKey && 'shift', event.metaKey && 'meta'].filter(Boolean)) as ShortcutBinding['modifiers']
    void bridge.recordShortcut(action, { key: { kind: 'physical', code: event.code }, modifiers })
  }}>{capturing ? 'Press shortcut…' : shortcutLabel(binding, platform)}</Button><Button size="icon" className="amove-feature-panel__reset-one" aria-label={`Reset ${actionMeta[action].title}`} title="Reset shortcut" onClick={() => void bridge.resetShortcut(action)}><RotateCcw /></Button></div>
}

function Settings({ bridge, state }: { bridge: MainBridge; state: MainState }): React.JSX.Element {
  const labels = state.platform === 'darwin' ? { background: 'Menu Bar', taskbar: 'Dock Icon' } : { background: 'System Tray', taskbar: 'Taskbar' }
  const managedBySuite = state.hostMode === 'suite'
  return <Pane className="amove-feature-panel__settings-pane" title="Settings" description="Choose where Amove stays available and manage access." icon={<Accessibility aria-hidden="true" />} actions={<Button size="sm" onClick={() => void bridge.refreshAccessibility()}><RefreshCw />Refresh</Button>}>
    <div className="amove-feature-panel__settings-list">
      <section className="amove-feature-panel__settings-block">
        {managedBySuite
          ? <div className="amove-feature-panel__settings-section-heading"><span className="amove-feature-panel__settings-section-icon"><Monitor aria-hidden="true" /></span><div><h3>App Presence</h3><p>Managed by Moirasia. The suite owns the Dock, menu, and tray while Amove is running here.</p></div></div>
          : <><div className="amove-feature-panel__settings-section-heading"><span className="amove-feature-panel__settings-section-icon"><Monitor aria-hidden="true" /></span><div><h3>App Presence</h3><p>Choose where Amove stays available when its window is closed.</p></div></div>
            <RadioGroup className="amove-feature-panel__presence-group" aria-label="App presence" value={state.settings.presenceMode} onValueChange={(mode) => void bridge.setPresenceMode(mode as 'background' | 'taskbar')}>
              {['background', 'taskbar'].map((mode) => <div className="amove-feature-panel__presence-option" data-selected={state.settings.presenceMode === mode} key={mode} onClick={() => void bridge.setPresenceMode(mode as 'background' | 'taskbar')}>
                <RadioGroupItem value={mode} aria-label={labels[mode as 'background' | 'taskbar']} />
                <div className="amove-feature-panel__presence-copy" aria-hidden="true"><span className="amove-feature-panel__presence-title">{labels[mode as 'background' | 'taskbar']}</span><span className="amove-feature-panel__presence-detail">{presenceDetails(state.platform)[mode as 'background' | 'taskbar']}</span></div>
              </div>)}
            </RadioGroup></>}
      </section>
      <section className="amove-feature-panel__settings-block">
        <div className="amove-feature-panel__permission-row"><div className="amove-feature-panel__settings-section-heading"><span className="amove-feature-panel__settings-section-icon"><ShieldCheck aria-hidden="true" /></span><div><div className="amove-feature-panel__permission-title-row"><h3>Accessibility</h3><Badge variant={state.accessibility.granted ? 'secondary' : 'destructive'}>{state.accessibility.label}</Badge></div><p>{accessibilityDescription(state)}</p></div></div></div>
        {state.accessibility.required && <div className="amove-feature-panel__button-row"><Button size="sm" disabled={state.accessibility.granted} onClick={() => void bridge.requestAccessibility()}>{state.accessibility.granted ? 'Access granted' : 'Grant Access'}</Button><Button size="sm" onClick={() => void bridge.openAccessibilitySettings()}>Open Settings</Button></div>}
      </section>
    </div>
  </Pane>
}

function Pane({ className, title, description, actions, icon, children }: { className?: string; title: string; description: string; actions?: React.ReactNode; icon: React.ReactNode; children: React.ReactNode }): React.JSX.Element { return <Card className={`amove-feature-panel__pane ${className ?? ''}`.trim()}><CardHeader className="amove-feature-panel__pane-header"><div className="amove-feature-panel__pane-heading"><span className="amove-feature-panel__pane-icon">{icon}</span><div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div></div>{actions}</CardHeader><CardContent>{children}</CardContent></Card> }
function resolvedBindings(state: MainState): Record<WindowActionId, ShortcutBinding> { return useMemo(() => ({ ...defaultBindings(state.platform), ...state.settings.shortcutsByPlatform[state.platform] }), [state]) as Record<WindowActionId, ShortcutBinding> }
function presenceDetails(platform: MainState['platform']): Record<'background' | 'taskbar', string> { if (platform === 'darwin') return { background: 'Keep Amove in the menu bar.', taskbar: 'Show Amove in the Dock.' }; if (platform === 'win32') return { background: 'Keep Amove in the system tray.', taskbar: 'Show Amove in the taskbar.' }; return { background: 'Keep Amove in the system tray.', taskbar: 'Show Amove in the taskbar.' } }
function accessibilityDescription(state: MainState): string { if (state.accessibility.required) return 'Required to move and resize windows outside Amove.'; return state.platform === 'linux' ? 'Native window controls are not available on Linux.' : 'Windows manages this permission automatically.' }
