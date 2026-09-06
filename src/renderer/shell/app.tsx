import { lazy, Suspense, useEffect, useState } from 'react'
import { AlertCircle, Grid2X2, Settings } from '@moirasia/ui-react/lib/icons'
import { Alert, AlertDescription, AlertTitle } from '@moirasia/ui-react/components/alert'
import { DesktopAppShell, DesktopNavigation, DesktopPage } from '@moirasia/desktop-shell/react'
import { featureCatalog, isFeatureId, type FeatureId } from '@moirasia/desktop-shell/feature'
import type { Appearance } from '@moirasia/desktop-shell'
import type { ControllerPage } from '../../shared/contracts'
import { FEATURE_ICONS } from './feature-icons'
import { FeaturesScreen } from './screens/features'
import { GeneralScreen } from './screens/general'
import { FeatureErrorBoundary } from './components/feature-error-boundary'
import { useController } from './controller'

const AmovePanel = lazy(async () => ({ default: (await import('../../../apps/integrated/Amove/src/renderer/main/AmovePanel')).AmovePanel }))
const VoxPanel = lazy(async () => ({ default: (await import('../../../apps/integrated/Vox/src/renderer/App')).VoxPanel }))
const ExithibitionPanel = lazy(async () => ({ default: (await import('../../../apps/integrated/Exithibition/src/renderer/App')).ExithibitionPanel }))
const BondedPanel = lazy(async () => ({ default: (await import('../../../apps/integrated/Bonded/src/renderer/App')).BondedPanel }))
const OrbisPanel = lazy(async () => ({ default: (await import('../../../apps/integrated/Orbis/src/renderer/App')).OrbisPanel }))

// Literal imports stay in this map so rollup code-splits each panel chunk; a
// feature without a primary panel is a compile error instead of a ternary.
const PRIMARY_PANELS: Record<FeatureId, (appearance: Appearance) => React.JSX.Element> = {
  amove: (appearance) => <AmovePanel bridge={window.amove} appearance={appearance} />,
  vox: (appearance) => <VoxPanel bridge={window.vox} appearance={appearance} />,
  exithibition: (appearance) => <ExithibitionPanel bridge={window.exithibition} appearance={appearance} />,
  bonded: (appearance) => <BondedPanel bridge={window.bonded} appearance={appearance} />,
  orbis: (appearance) => <OrbisPanel bridge={window.orbis} appearance={appearance} />
}

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
    { id: 'apps', label: 'Apps', items: availableFeatures.map((feature) => ({ id: feature.id, label: featureCatalog.get(feature.id).label, icon: FEATURE_ICONS[featureCatalog.get(feature.id).iconKey] })) }
  ]} />

  return <DesktopAppShell product="Moirasia" appearance={appearance} onAppearanceChange={(value) => controller.setAppearance('moirasia', value)} navigation={navigation}>
    {controller.loading
      ? <DesktopPage width="standard" className="controller-main"><p role="status">Loading applications…</p></DesktopPage>
      : <>
        {activePage === 'general' && <div className="shell-route"><DesktopPage width="standard" className="controller-main"><GeneralScreen /></DesktopPage></div>}
        {activePage === 'features' && <div className="shell-route"><DesktopPage width="standard" className="controller-main"><FeaturesScreen controller={controller} /></DesktopPage></div>}
        {featureCatalog.ids.map((id) => {
          const available = availableFeatures.some((feature) => feature.id === id)
          if (!available || !visited.has(id)) return null
          const selected = activePage === id
          const label = featureCatalog.get(id).label
          return <div key={id} className="shell-feature-route" hidden={!selected} aria-hidden={!selected}>
            <FeatureErrorBoundary name={label}>
              <Suspense fallback={<p className="shell-feature-loading" role="status">Loading {label}…</p>}>
                {PRIMARY_PANELS[id](controller.snapshot.appearances.values[id])}
              </Suspense>
            </FeatureErrorBoundary>
          </div>
        })}
      </>}
    {controller.error && <Alert variant="destructive" className="controller-error"><AlertCircle /><AlertTitle>Action failed</AlertTitle><AlertDescription>{controller.error}</AlertDescription></Alert>}
  </DesktopAppShell>
}