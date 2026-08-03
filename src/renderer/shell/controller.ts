import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  MODULE_IDS,
  type ModuleId,
  type ModuleSnapshot,
  type ShellPage,
  type ShellSettings,
  type ShellSettingsPatch
} from '../../shared/contracts'
import { applyTheme, systemThemeQuery } from './theme'

export const EMPTY_SNAPSHOT: ModuleSnapshot = {
  activeModuleId: null,
  modules: MODULE_IDS.map((id) => ({
    id,
    label: id[0]!.toUpperCase() + id.slice(1),
    state: 'stopped',
    active: false,
    available: true
  }))
}

export const DEFAULT_SETTINGS: ShellSettings = {
  version: 1,
  appearance: 'system',
  launchAtLogin: false,
  autoStart: { amove: false, vox: false, exithibition: false },
  restoreLastSelection: true,
  compactRail: false,
  priorSelection: 'home'
}

export interface ShellController {
  readonly snapshot: ModuleSnapshot
  readonly settings: ShellSettings
  readonly selected: ModuleId
  readonly page: ShellPage | null
  readonly loading: boolean
  readonly error: string | null
  readonly selectedStatus: ModuleSnapshot['modules'][number] | undefined
  readonly updateSettings: (patch: ShellSettingsPatch) => Promise<void>
  readonly showPage: (page: ShellPage) => void
  readonly openModule: (id: ModuleId) => void
  readonly stopModule: (id: ModuleId) => void
  readonly reportError: (message: string) => void
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function useShellController(): ShellController {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT)
  const [selected, setSelected] = useState<ModuleId>('amove')
  const [page, setPage] = useState<ShellPage | null>('home')
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([window.moirasia.getSnapshot(), window.moirasia.getSettings()])
      .then(([nextSnapshot, nextSettings]) => {
        if (!active) return
        setSnapshot(nextSnapshot)
        setSettings(nextSettings)
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    const offSnapshot = window.moirasia.onSnapshot((nextSnapshot) => {
      if (active) setSnapshot(nextSnapshot)
    })
    const offNavigate = window.moirasia.onNavigate((destination) => {
      if (!active) return
      if (destination === 'home' || destination === 'settings') setPage(destination)
      else {
        setSelected(destination)
        setPage(null)
      }
    })
    return () => {
      active = false
      offSnapshot()
      offNavigate()
    }
  }, [])

  useEffect(() => {
    const media = systemThemeQuery()
    const sync = (): void => { applyTheme(settings.appearance, media.matches) }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [settings.appearance])

  const runAction = useCallback(async (action: () => Promise<ModuleSnapshot>): Promise<void> => {
    setError(null)
    try {
      setSnapshot(await action())
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }, [])

  const updateSettings = useCallback(async (patch: ShellSettingsPatch): Promise<void> => {
    setError(null)
    try {
      setSettings(await window.moirasia.updateSettings(patch))
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }, [])

  const showPage = useCallback((nextPage: ShellPage): void => {
    setPage(nextPage)
    void runAction(() => window.moirasia.showPage(nextPage))
  }, [runAction])

  const openModule = useCallback((id: ModuleId): void => {
    setSelected(id)
    setPage(null)
    void runAction(async () => {
      const status = snapshot.modules.find((module) => module.id === id)
      if (status?.state !== 'running') await window.moirasia.startModule(id)
      return window.moirasia.activateModule(id)
    })
  }, [runAction, snapshot.modules])

  const stopModule = useCallback((id: ModuleId): void => {
    void runAction(() => window.moirasia.stopModule(id))
  }, [runAction])

  const selectedStatus = useMemo(
    () => snapshot.modules.find((module) => module.id === selected),
    [selected, snapshot.modules]
  )

  return {
    snapshot,
    settings,
    selected,
    page,
    loading,
    error,
    selectedStatus,
    updateSettings,
    showPage,
    openModule,
    stopModule,
    reportError: setError
  }
}
