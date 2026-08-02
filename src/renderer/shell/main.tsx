import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  MODULE_IDS,
  type ModuleId,
  type ModuleSnapshot,
  type ShellPage,
  type ShellSettings,
  type ShellSettingsPatch
} from '../../shared/contracts'
import './styles.css'

const EMPTY_SNAPSHOT: ModuleSnapshot = {
  activeModuleId: null,
  modules: MODULE_IDS.map((id) => ({
    id,
    label: id[0]!.toUpperCase() + id.slice(1),
    state: 'stopped',
    active: false,
    available: true
  }))
}
const DEFAULT_SETTINGS: ShellSettings = {
  version: 1,
  appearance: 'system',
  launchAtLogin: false,
  autoStart: { amove: false, vox: false, exithibition: false },
  restoreLastSelection: true,
  compactRail: false,
  priorSelection: 'home'
}

function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT)
  const [selected, setSelected] = useState<ModuleId>('amove')
  const [page, setPage] = useState<ShellPage | null>('home')
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [error, setError] = useState<string | null>(null)
  const railRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    void Promise.all([window.moirasia.getSnapshot(), window.moirasia.getSettings()]).then(([nextSnapshot, nextSettings]) => {
      setSnapshot(nextSnapshot)
      setSettings(nextSettings)
    })
    const offSnapshot = window.moirasia.onSnapshot(setSnapshot)
    const offNavigate = window.moirasia.onNavigate((destination) => {
      if (destination === 'home' || destination === 'settings') {
        setPage(destination)
      } else {
        setSelected(destination)
        setPage(null)
      }
    })
    return () => {
      offSnapshot()
      offNavigate()
    }
  }, [])

  useEffect(() => {
    window.moirasia.setRailWidth(settings.compactRail ? 76 : 232)
  }, [settings.compactRail])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'F6') {
        event.preventDefault()
        if (railRef.current?.contains(document.activeElement)) mainRef.current?.focus()
        else railRef.current?.querySelector<HTMLElement>('button')?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const selectedStatus = snapshot.modules.find((module) => module.id === selected)
  const updateSettings = async (patch: ShellSettingsPatch): Promise<void> => {
    setError(null)
    try {
      setSettings(await window.moirasia.updateSettings(patch))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const runAction = async (action: () => Promise<ModuleSnapshot>): Promise<void> => {
    setError(null)
    try {
      setSnapshot(await action())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const showPage = (nextPage: ShellPage): void => {
    setPage(nextPage)
    void runAction(() => window.moirasia.showPage(nextPage))
  }
  const openModule = (id: ModuleId): void => {
    setSelected(id)
    setPage(null)
    void runAction(async () => {
      const status = snapshot.modules.find((module) => module.id === id)
      if (status?.state !== 'running') await window.moirasia.startModule(id)
      return window.moirasia.activateModule(id)
    })
  }

  return (
    <div className={settings.compactRail ? 'app compact' : 'app'}>
      <aside className="rail" aria-label="Application navigation" ref={railRef}>
        <div className="brand" aria-label="Moirasia">{settings.compactRail ? 'M' : 'Moirasia'}</div>
        <nav aria-label="Pages">
          <button className={page === 'home' ? 'selected' : ''} onClick={() => showPage('home')}>
            <span aria-hidden="true">⌂</span><span className="label">Home</span>
          </button>
        </nav>
        <nav className="modules" aria-label="Modules">
          {snapshot.modules.map((module) => (
            <button
              key={module.id}
              className={selected === module.id && page === null ? 'selected' : ''}
              aria-current={module.active ? 'page' : undefined}
              disabled={!module.available}
              title={module.unavailableReason}
              onClick={() => {
                setSelected(module.id)
                openModule(module.id)
              }}
            >
              <span className={`status ${module.state}`} aria-hidden="true" />
              <span className="label">{module.label}</span>
              <span className="sr-only">{module.available ? module.state : `unavailable: ${module.unavailableReason}`}{module.active ? ', open' : ''}</span>
            </button>
          ))}
        </nav>
        <div className="module-actions" aria-label="Selected module controls">
          <button onClick={() => openModule(selected)} disabled={!selectedStatus?.available || selectedStatus?.state === 'starting' || selectedStatus?.state === 'stopping'}>
            <span aria-hidden="true">▶</span><span className="label">{selectedStatus?.state === 'running' ? 'Open' : 'Start'}</span>
          </button>
          <button
            onClick={() => void runAction(() => window.moirasia.stopModule(selected))}
            disabled={!selectedStatus || selectedStatus.state === 'stopped' || selectedStatus.state === 'starting' || selectedStatus.state === 'stopping'}
          >
            <span aria-hidden="true">■</span><span className="label">Quit Module</span>
          </button>
        </div>
        <div className="rail-bottom">
          <button className={page === 'settings' ? 'selected' : ''} onClick={() => showPage('settings')}>
            <span aria-hidden="true">⚙</span><span className="label">Settings</span>
          </button>
          <button onClick={() => void updateSettings({ compactRail: !settings.compactRail })} aria-label={settings.compactRail ? 'Expand sidebar' : 'Collapse sidebar'}>
            <span aria-hidden="true">{settings.compactRail ? '›' : '‹'}</span><span className="label">Collapse</span>
          </button>
        </div>
      </aside>

      <main ref={mainRef} tabIndex={-1}>
        {page === 'home' && (
          <section>
            <p className="eyebrow">Workspace</p>
            <h1>Choose a module</h1>
            <p>Modules stay running when you switch. Quit a module to release its resources.</p>
            <div className="home-grid">
              {snapshot.modules.map((module) => (
                <article className="home-card" key={module.id}>
                  <h2>{module.label}</h2>
                  <p><span className={`status ${module.state}`} aria-hidden="true" /> {module.state}</p>
                  {!module.available && <p className="error">{module.unavailableReason}</p>}
                  {module.error && <p className="error">{module.error}</p>}
                  <div className="actions">
                    {module.available ? <button className="primary" onClick={() => openModule(module.id)} disabled={module.state === 'starting' || module.state === 'stopping'}>
                      {module.state === 'running' ? 'Open' : 'Start'}
                    </button> : <button onClick={() => setError('Installation is not available in this local-only build.')}>Install</button>}
                    <button onClick={() => void runAction(() => window.moirasia.stopModule(module.id))}
                      disabled={module.state === 'stopped' || module.state === 'starting' || module.state === 'stopping'}>
                      Quit Module
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {page === 'settings' && (
          <section>
            <p className="eyebrow">Preferences</p>
            <h1>Settings</h1>
            <div className="settings-list">
              <label>Appearance
                <select value={settings.appearance} onChange={(event) => void updateSettings({ appearance: event.target.value as ShellSettings['appearance'] })}>
                  <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
                </select>
              </label>
              <label><input type="checkbox" checked={settings.launchAtLogin} onChange={(event) => void updateSettings({ launchAtLogin: event.target.checked })} /> Launch at login</label>
              <label><input type="checkbox" checked={settings.restoreLastSelection} onChange={(event) => void updateSettings({ restoreLastSelection: event.target.checked })} /> Restore last selected module or page</label>
              <fieldset>
                <legend>Start with Moirasia</legend>
                {snapshot.modules.map((module) => (
                  <label key={module.id}>
                    <input type="checkbox" checked={settings.autoStart[module.id]}
                      onChange={(event) => void updateSettings({ autoStart: { [module.id]: event.target.checked } })} />
                    {module.label}
                  </label>
                ))}
              </fieldset>
            </div>
          </section>
        )}
        {page === null && selectedStatus && (
          <section className="module-card">
            <p className="eyebrow">Module</p>
            <h1>{selectedStatus.label}</h1>
            <p>Status: <strong>{selectedStatus.state}</strong></p>
            {!selectedStatus.available && <p className="error">{selectedStatus.unavailableReason}</p>}
            {selectedStatus.error && <p className="error">{selectedStatus.error}</p>}
            <div className="actions">
              <button className="primary" onClick={() => openModule(selected)} disabled={!selectedStatus.available || selectedStatus.state === 'starting' || selectedStatus.state === 'stopping'}>
                {selectedStatus.state === 'running' ? 'Open' : 'Start'}
              </button>
              <button
                onClick={() => void runAction(() => window.moirasia.stopModule(selected))}
                disabled={selectedStatus.state === 'stopped' || selectedStatus.state === 'starting' || selectedStatus.state === 'stopping'}
              >
                Quit Module
              </button>
            </div>
          </section>
        )}
        {error && <div className="error-banner" role="alert">{error}</div>}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
