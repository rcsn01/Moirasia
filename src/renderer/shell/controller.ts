import { useCallback, useEffect, useState } from 'react'
import { applyDocumentAppearance } from '@moirasia/desktop-shell/react'
import type { Appearance } from '@moirasia/desktop-shell'
import { APPLICATION_IDS, type ApplicationId, type ControllerPage, type ControllerSnapshot, type ShellSettings } from '../../shared/contracts'

const EMPTY: ControllerSnapshot = { applications: APPLICATION_IDS.map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1), bundleId: '', installed: false, running: false })), appearances: { version: 1, revision: 0, values: { moirasia: 'system', amove: 'system', vox: 'system', exithibition: 'dark', bonded: 'system' } } }
const DEFAULT_SETTINGS: ShellSettings = { version: 2, launchAtLogin: false, pendingLoginItems: {} }
export function useController() {
  const [snapshot, setSnapshot] = useState(EMPTY), [settings, setSettings] = useState(DEFAULT_SETTINGS), [page, setPage] = useState<ControllerPage>('apps'), [loading, setLoading] = useState(true), [error, setError] = useState<string>()
  useEffect(() => { let active = true; void Promise.all([window.moirasia.getSnapshot(), window.moirasia.getSettings()]).then(([next, preferences]) => { if (active) { setSnapshot(next); setSettings(preferences) } }).catch((reason) => active && setError(message(reason))).finally(() => active && setLoading(false)); const offSnapshot = window.moirasia.onSnapshot((next) => active && setSnapshot(next)); const offNavigate = window.moirasia.onNavigate((next) => active && setPage(next)); return () => { active = false; offSnapshot(); offNavigate() } }, [])
  useEffect(() => { const appearance = snapshot.appearances.values.moirasia; const media = matchMedia('(prefers-color-scheme: dark)'); const apply = () => applyDocumentAppearance(appearance, media.matches); apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply) }, [snapshot.appearances.values.moirasia])
  const action = useCallback(async (operation: () => Promise<ControllerSnapshot>) => { setError(undefined); try { setSnapshot(await operation()) } catch (reason) { setError(message(reason)) } }, [])
  return { snapshot, settings, page, setPage, loading, error,
    open: (id: ApplicationId) => void action(() => window.moirasia.openApplication(id)), quit: (id: ApplicationId) => void action(() => window.moirasia.quitApplication(id)),
    setAppearance: (id: ApplicationId | 'moirasia', appearance: Appearance) => void action(() => window.moirasia.setAppearance(id, appearance)), setAllAppearances: (appearance: Appearance) => void action(() => window.moirasia.setAllAppearances(appearance)),
    setLaunchAtLogin: async (enabled: boolean) => { try { setSettings(await window.moirasia.setLaunchAtLogin(enabled)) } catch (reason) { setError(message(reason)) } },
    setLoginItem: (id: ApplicationId, enabled: boolean) => void action(() => window.moirasia.setApplicationLoginItem(id, enabled)), openLoginItemsSettings: () => void window.moirasia.openLoginItemsSettings().catch((reason) => setError(message(reason))) }
}
function message(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
