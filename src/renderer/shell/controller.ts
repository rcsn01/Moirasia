import { useCallback, useEffect, useState } from 'react'
import { applyDocumentAppearance } from '@moirasia/desktop-shell/react'
import { featureCatalog } from '@moirasia/desktop-shell/feature'
import type { Appearance } from '@moirasia/desktop-shell'
import { DEFAULT_SHELL_SETTINGS, emptyControllerSnapshot, idleUpdateState, type ApplicationId, type AppPresenceMode, type ControllerPage, type ControllerSnapshot, type UpdateState } from '../../shared/contracts'

export function useController() {
  const [snapshot, setSnapshot] = useState(emptyControllerSnapshot), [settings, setSettings] = useState(DEFAULT_SHELL_SETTINGS), [page, setPage] = useState<ControllerPage>('general'), [update, setUpdate] = useState(idleUpdateState()), [loading, setLoading] = useState(true), [error, setError] = useState<string>()
  useEffect(() => {
    let active = true
    void Promise.all([window.moirasia.getSnapshot(), window.moirasia.getSettings(), window.moirasia.getPage(), window.moirasia.getUpdateState()]).then(([next, preferences, initialPage, updateState]) => {
      if (active) {
        setSnapshot(next); setSettings(preferences); setPage(initialPage); setUpdate(updateState)
        void window.moirasia.reportPage(initialPage).catch((reason) => active && setError(message(reason)))
      }
    }).catch((reason) => active && setError(message(reason))).finally(() => active && setLoading(false))
    const offSnapshot = window.moirasia.onSnapshot((next) => active && setSnapshot(next))
    const offNavigate = window.moirasia.onNavigate((next) => active && setPage(next))
    const offUpdate = window.moirasia.onUpdateState((next) => active && setUpdate(next))
    return () => { active = false; offSnapshot(); offNavigate(); offUpdate() }
  }, [])
  useEffect(() => { const appearance = snapshot.appearances.values.moirasia; const media = matchMedia('(prefers-color-scheme: dark)'); const apply = () => applyDocumentAppearance(appearance, media.matches); apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply) }, [snapshot.appearances.values.moirasia])
  const action = useCallback(async (operation: () => Promise<ControllerSnapshot>) => { setError(undefined); try { setSnapshot(await operation()) } catch (reason) { setError(message(reason)) } }, [])
  const runUpdate = useCallback(async (operation: () => Promise<UpdateState>) => { setError(undefined); try { setUpdate(await operation()) } catch (reason) { setError(message(reason)) } }, [])
  const selectPage = useCallback((next: ControllerPage) => { setPage(next); const report = window.moirasia.reportPage?.(next); void report?.catch((reason) => setError(message(reason))) }, [])
  return { snapshot, settings, page, setPage: selectPage, update, loading, error,
    open: (id: ApplicationId) => void action(() => window.moirasia.openApplication(id)), quit: (id: ApplicationId) => void action(() => window.moirasia.quitApplication(id)),
    setAppearance: (id: ApplicationId | 'moirasia', appearance: Appearance) => void action(() => window.moirasia.setAppearance(id, appearance)), setAllAppearances: (appearance: Appearance) => void action(() => window.moirasia.setAllAppearances(appearance)),
    setLaunchAtLogin: async (enabled: boolean) => { try { setSettings(await window.moirasia.setLaunchAtLogin(enabled)) } catch (reason) { setError(message(reason)) } },
    setAppPresence: async (mode: AppPresenceMode) => { try { setSettings(await window.moirasia.setAppPresence(mode)) } catch (reason) { setError(message(reason)) } },
    setLoginItem: (id: ApplicationId, enabled: boolean) => void action(() => window.moirasia.setApplicationLoginItem(id, enabled)), openLoginItemsSettings: () => void window.moirasia.openLoginItemsSettings().catch((reason) => setError(message(reason))),
    installFeature: (id: ApplicationId) => void action(() => window.moirasia.installFeature(id)), uninstallFeature: (id: ApplicationId) => void action(() => window.moirasia.uninstallFeature(id)),
    openFeature: (id: ApplicationId) => { setError(undefined); window.moirasia.openFeature(id).catch((reason) => setError(message(reason))) }, relaunchApp: () => void window.moirasia.relaunchApp().catch((reason) => setError(message(reason))),
    checkForUpdate: () => void runUpdate(() => window.moirasia.checkForUpdate()),
    openReleasePage: () => { setError(undefined); window.moirasia.openReleasePage().catch((reason) => setError(message(reason))) } }
}
function message(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
