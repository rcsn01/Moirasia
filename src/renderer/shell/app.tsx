import { lazy, Suspense, useEffect, useState } from 'react'
import { AlertCircle, Activity, AppWindow, BarChart3, Grid2X2, Mic, Settings, ShieldCheck } from '@moirasia/ui-react/lib/icons'
import { Alert, AlertDescription, AlertTitle } from '@moirasia/ui-react/components/alert'
import { DesktopAppShell, DesktopNavigation, DesktopPage } from '@moirasia/desktop-shell/react'
import { isFeatureId, type FeatureId } from '@moirasia/desktop-shell/feature'
import type { ControllerPage } from '../../shared/contracts'
import { FeaturesScreen } from './screens/features'
import { GeneralScreen } from './screens/general'
import { useController } from './controller'

const AmovePanel = lazy(async () => ({ default: (await import('../../../apps/integrated/Amove/src/renderer/main/AmovePanel')).AmovePanel }))
const VoxPanel = lazy(async () => ({ default: (await import('../../../apps/integrated/Vox/src/renderer/App')).VoxPanel }))
const ExithibitionPanel = lazy(async () => ({ default: (await import('../../../apps/integrated/Exithibition/src/renderer/App')).ExithibitionPanel }))
const BondedPanel = lazy(async () => ({ default: (await import('../../../apps/integrated/Bonded/src/renderer/App')).BondedPanel }))
const OrbisPanel = lazy(async () => ({ default: (await import('../../../apps/integrated/Orbis/src/renderer/App')).OrbisPanel }))

const FEATURE_LABELS: Record<FeatureId, string> = { amove: 'Amove', vox: 'Vox', exithibition: 'Exithibition', bonded: 'Bonded', orbis: 'Orbis' }

export function App(): React.JSX.Element {
  const controller = useController()
  const [visited, setVisited] = useState<Set<FeatureId>>(() => new Set())
  const appearance = controller.snapshot.appearances.values.moirasia
  const availableFeatures = controller.snapshot.features.filter((feature) => feature.installed && feature.loaded)
  const activeFeature = isFeatureId(controller.page) && availableFeatures.some((feature) => feature.id === controller.page) ? controller.page : undefined
  const activePage: ControllerPage = controller.page === 'general' || controller.page === 'features' || activeFeature ? controller.page : 'general'

  useEffect(() => {
    if (!controller.loading && activePage !== controller.page) controller.setPage(activePage)
  }, [activePage, controller.loading, controller.page, controller.setPage])

  useEffect(() => {
    if (activeFeature) setVisited((current) => current.has(activeFeature) ? current : new Set(current).add(activeFeature))
  }, [activeFeature])

  const navigation = <DesktopNavigation<ControllerPage> label="Moirasia sections" active={activePage} onSelect={controller.setPage} groups={[
    { id: 'essentials', label: 'Essentials', items: [
      { id: 'general', label: 'General', icon: <Settings aria-hidden="true" /> },
      { id: 'features', label: 'Features', icon: <Grid2X2 aria-hidden="true" /> }
    ] },
    { id: 'apps', label: 'Apps', items: availableFeatures.map((feature) => ({ id: feature.id, label: FEATURE_LABELS[feature.id], icon: feature.id === 'amove' ? <AppWindow aria-hidden="true" /> : feature.id === 'vox' ? <Mic aria-hidden="true" /> : feature.id === 'exithibition' ? <Activity aria-hidden="true" /> : feature.id === 'bonded' ? <ShieldCheck aria-hidden="true" /> : <BarChart3 aria-hidden="true" /> })) }
  ]} />

  return <DesktopAppShell product="Moirasia" appearance={appearance} onAppearanceChange={(value) => controller.setAppearance('moirasia', value)} navigation={navigation}>
    {controller.loading
      ? <DesktopPage width="standard" className="controller-main"><p role="status">Loading applications…</p></DesktopPage>
      : <>
        {activePage === 'general' && <div className="shell-route"><DesktopPage width="standard" className="controller-main"><GeneralScreen /></DesktopPage></div>}
        {activePage === 'features' && <div className="shell-route"><DesktopPage width="standard" className="controller-main"><FeaturesScreen controller={controller} /></DesktopPage></div>}
        {(['amove', 'vox', 'exithibition', 'bonded', 'orbis'] as const).map((id) => {
          const available = availableFeatures.some((feature) => feature.id === id)
          if (!available || !visited.has(id)) return null
          const selected = activePage === id
          return <div key={id} className="shell-feature-route" hidden={!selected} aria-hidden={!selected}>
            <Suspense fallback={<p className="shell-feature-loading" role="status">Loading {FEATURE_LABELS[id]}…</p>}>
              {id === 'amove'
                ? <AmovePanel bridge={window.amove} appearance={controller.snapshot.appearances.values.amove} />
                : id === 'vox'
                  ? <VoxPanel bridge={window.vox} appearance={controller.snapshot.appearances.values.vox} />
                  : id === 'exithibition'
                  ? <ExithibitionPanel bridge={window.exithibition} appearance={controller.snapshot.appearances.values.exithibition} />
                  : id === 'bonded'
                    ? <BondedPanel bridge={window.bonded} appearance={controller.snapshot.appearances.values.bonded} />
                    : <OrbisPanel bridge={window.orbis} appearance={controller.snapshot.appearances.values.orbis} />}
            </Suspense>
          </div>
        })}
      </>}
    {controller.error && <Alert variant="destructive" className="controller-error"><AlertCircle /><AlertTitle>Action failed</AlertTitle><AlertDescription>{controller.error}</AlertDescription></Alert>}
  </DesktopAppShell>
}
