import { ChevronRight } from '@moirasia/ui-react/lib/icons'
import { Alert, AlertDescription, AlertTitle } from '@moirasia/ui-react/components/alert'
import { Badge } from '@moirasia/ui-react/components/badge'
import { Button } from '@moirasia/ui-react/components/button'
import { Card } from '@moirasia/ui-react/components/card'
import { featureCatalog } from '@moirasia/desktop-shell/feature'
import type { FeatureStatus } from '../../../shared/contracts'
import { FEATURE_ICONS } from '../feature-icons'
import type { useController } from '../controller'

export function FeaturesScreen({ controller }: { controller: ReturnType<typeof useController> }): React.JSX.Element {
  const features = controller.snapshot.features
  const restartPending = features.filter((feature) => feature.restartPending)
  return <section className="controller-page" aria-labelledby="features-heading">
    <p className="eyebrow">ESSENTIALS</p>
    <h1 id="features-heading">Features</h1>
    <p className="lede">Choose which apps run inside Moirasia. Uninstalling keeps each app's settings; a restart fully unloads it.</p>
    {restartPending.length > 0 && <Alert className="restart-banner"><AlertTitle>Restart required</AlertTitle><AlertDescription>{`Uninstalled ${restartPending.map((feature) => label(feature)).join(', ')} stays in memory until Moirasia restarts.`} <Button size="sm" onClick={() => controller.relaunchApp()}>Restart Moirasia</Button></AlertDescription></Alert>}
    {featureCatalog.groups.map((group) => {
      const rows = group.features.map((id) => features.find((feature) => feature.id === id)).filter((feature) => feature !== undefined)
      if (rows.length === 0) return null
      return <section key={group.id} className="feature-group"><h2 className="feature-group-title">{group.label}</h2><div className="feature-list">{rows.map((feature) => <FeatureRow key={feature.id} feature={feature} controller={controller} />)}</div></section>
    })}
  </section>
}

function FeatureRow({ feature, controller }: { feature: FeatureStatus; controller: ReturnType<typeof useController> }): React.JSX.Element {
  const entry = featureCatalog.get(feature.id)
  const status = feature.restartPending ? { label: 'Restart pending', variant: 'destructive' as const } : feature.loaded ? { label: 'Loaded', variant: 'secondary' as const } : { label: 'Not loaded', variant: 'outline' as const }
  return <Card className="feature-row">
    <div className="feature-icon" aria-hidden="true">{FEATURE_ICONS[entry.iconKey]}</div>
    <div className="feature-body">
      <div className="feature-title-row"><h3 className="feature-title">{entry.label}</h3><Badge variant={status.variant} className={`feature-status${status.variant === 'destructive' ? '' : ' text-muted-foreground'}`}>{status.label}</Badge></div>
      <p className="feature-description">{entry.description}{feature.loadError && <span className="feature-load-error" role="alert"> {feature.loadError}</span>}</p>
    </div>
    <div className="feature-actions">
      {feature.installed
        ? <>
          {feature.loadError && !feature.loaded && <Button size="sm" variant="outline" onClick={() => controller.installFeature(feature.id)}>Retry</Button>}
          <Button size="icon" variant="ghost" className="feature-open" aria-label="Open" title="Open" disabled={!feature.loaded} onClick={() => controller.openFeature(feature.id)}><ChevronRight /></Button>
          <Button size="sm" variant="outline" onClick={() => controller.uninstallFeature(feature.id)}>Uninstall</Button>
        </>
        : <Button size="sm" onClick={() => controller.installFeature(feature.id)}>Install</Button>}
    </div>
  </Card>
}

function label(feature: FeatureStatus): string { return featureCatalog.get(feature.id).label }