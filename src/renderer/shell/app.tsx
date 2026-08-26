import { lazy, Suspense, useEffect, useState } from 'react'
import { AlertCircle, Activity, AppWindow, BarChart3, Settings } from '@moirasia/ui-react/lib/icons'
import { Alert, AlertDescription, AlertTitle } from '@moirasia/ui-react/components/alert'
import { DesktopAppShell, DesktopNavigation, DesktopPage } from '@moirasia/desktop-shell/react'
import type { FeatureId } from '@moirasia/desktop-shell/feature'
import type { ControllerPage } from '../../shared/contracts'
import { AppsScreen } from './screens/home'
import { SettingsScreen } from './screens/settings'
import { useController } from './controller'

const AmovePanel = lazy(async () => ({ default: (await import('../../../apps/Amove/src/renderer/main/AmovePanel')).AmovePanel }))
const ExithibitionPanel = lazy(async () => ({ default: (await import('../../../apps/Exithibition/src/renderer/App')).ExithibitionPanel }))
const OrbisPanel = lazy(async () => ({ default: (await import('../../../apps/Orbis/src/renderer/App')).OrbisPanel }))

const FEATURE_LABELS: Record<FeatureId, string> = { amove: 'Amove', exithibition: 'Exithibition', orbis: 'Orbis' }

export function App(): React.JSX.Element {
  const controller = useController()
  const [visited, setVisited] = useState<Set<FeatureId>>(() => new Set())
  const appearance = controller.snapshot.appearances.values.moirasia
  const availableFeatures = controller.snapshot.features.filter((feature) => feature.installed && feature.loaded)
  const activeFeature = availableFeatures.some((feature) => feature.id === controller.page) ? controller.page as FeatureId : undefined
  const activePage: ControllerPage = controller.page === 'apps' || controller.page === 'settings' || activeFeature ? controller.page : 'apps'

  useEffect(() => {
    if (activeFeature) setVisited((current) => current.has(activeFeature) ? current : new Set(current).add(activeFeature))
  }, [activeFeature])

  const navigation = <DesktopNavigation<ControllerPage> label="Moirasia sections" active={activePage} onSelect={controller.setPage} items={[
    { id: 'apps', label: 'Apps', icon: <AppWindow aria-hidden="true" /> },
    ...availableFeatures.map((feature) => ({ id: feature.id as ControllerPage, label: FEATURE_LABELS[feature.id], icon: feature.id === 'amove' ? <AppWindow aria-hidden="true" /> : feature.id === 'exithibition' ? <Activity aria-hidden="true" /> : <BarChart3 aria-hidden="true" /> })),
    { id: 'settings', label: 'Settings', icon: <Settings aria-hidden="true" /> }
  ]} />

  return <DesktopAppShell product="Moirasia" appearance={appearance} onAppearanceChange={(value) => controller.setAppearance('moirasia', value)} navigation={navigation}>
    {controller.loading
      ? <DesktopPage width="standard" className="controller-main"><p role="status">Loading applications…</p></DesktopPage>
      : <>
        {activePage === 'apps' && <div className="shell-route"><DesktopPage width="standard" className="controller-main"><AppsScreen controller={controller} /></DesktopPage></div>}
        {activePage === 'settings' && <div className="shell-route"><DesktopPage width="standard" className="controller-main"><SettingsScreen controller={controller} /></DesktopPage></div>}
        {(['amove', 'exithibition', 'orbis'] as const).map((id) => {
          const available = availableFeatures.some((feature) => feature.id === id)
          if (!available || !visited.has(id)) return null
          const selected = activePage === id
          return <div key={id} className="shell-feature-route" hidden={!selected} aria-hidden={!selected}>
            <Suspense fallback={<p className="shell-feature-loading" role="status">Loading {FEATURE_LABELS[id]}…</p>}>
              {id === 'amove'
                ? <AmovePanel bridge={window.amove} appearance={controller.snapshot.appearances.values.amove} onAppearanceChange={(value) => controller.setAppearance('amove', value)} embeddedHeader />
                : id === 'exithibition'
                  ? <ExithibitionPanel bridge={window.exithibition} appearance={controller.snapshot.appearances.values.exithibition} onAppearanceChange={(value) => controller.setAppearance('exithibition', value)} embeddedHeader />
                  : <OrbisPanel bridge={window.orbis} appearance={controller.snapshot.appearances.values.orbis} onAppearanceChange={(value) => controller.setAppearance('orbis', value)} embeddedHeader />}
            </Suspense>
          </div>
        })}
      </>}
    {controller.error && <Alert variant="destructive" className="controller-error"><AlertCircle /><AlertTitle>Action failed</AlertTitle><AlertDescription>{controller.error}</AlertDescription></Alert>}
  </DesktopAppShell>
}
