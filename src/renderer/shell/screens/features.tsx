import { Alert, AlertDescription, AlertTitle } from '@moirasia/ui-react/components/alert'
import { Badge } from '@moirasia/ui-react/components/badge'
import { Button } from '@moirasia/ui-react/components/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@moirasia/ui-react/components/card'
import type { FeatureId } from '@moirasia/desktop-shell/feature'
import type { FeatureStatus } from '../../../shared/contracts'
import type { useController } from '../controller'

const FEATURE_COPY: Readonly<Record<FeatureId, { label: string; description: string }>> = {
  amove: { label: 'Amove', description: 'Move windows between displays and stage files on its floating Shelf.' },
  vox: { label: 'Vox', description: 'Dictate into any app with local speech recognition and a floating status overlay.' },
  exithibition: { label: 'Exithibition', description: 'Live Apple-silicon telemetry rendered as an interactive hardware schematic.' },
  bonded: { label: 'Bonded', description: 'Monitor network activity and block destinations learned from selected applications.' },
  orbis: { label: 'Orbis', description: 'Read-only disk usage scanning with a sunburst view of the folders taking space.' }
}

export function FeaturesScreen({ controller }: { controller: ReturnType<typeof useController> }): React.JSX.Element {
  const features = controller.snapshot.features
  const restartPending = features.filter((feature) => feature.restartPending)
  return <section className="controller-page" aria-labelledby="features-heading">
    <p className="eyebrow">ESSENTIALS</p>
    <h1 id="features-heading">Features</h1>
    <p className="lede">Choose which apps run inside Moirasia. Uninstalling keeps each app's settings; a restart fully unloads it.</p>
    {restartPending.length > 0 && <Alert className="restart-banner"><AlertTitle>Restart required</AlertTitle><AlertDescription>{`Uninstalled ${restartPending.map((feature) => label(feature)).join(', ')} stays in memory until Moirasia restarts.`} <Button size="sm" onClick={() => controller.relaunchApp()}>Restart Moirasia</Button></AlertDescription></Alert>}
    <div className="application-grid">{features.map((feature) => <Card key={feature.id}><CardHeader><div className="card-title-row"><CardTitle>{label(feature)}</CardTitle><Badge variant={feature.restartPending ? 'destructive' : feature.loaded ? 'secondary' : 'outline'}>{feature.restartPending ? 'Restart pending' : feature.loaded ? 'Loaded' : 'Not loaded'}</Badge></div><CardDescription>{FEATURE_COPY[feature.id].description}{feature.loadError && <span className="feature-load-error" role="alert"> {feature.loadError}</span>}</CardDescription></CardHeader><CardFooter><Button size="sm" disabled={!feature.installed || !feature.loaded} onClick={() => controller.openFeature(feature.id)}>{feature.loaded ? 'Open' : 'Unavailable'}</Button>{feature.installed ? <>{feature.loadError && !feature.loaded && <Button size="sm" variant="outline" onClick={() => controller.installFeature(feature.id)}>Retry</Button>}<Button size="sm" variant="outline" onClick={() => controller.uninstallFeature(feature.id)}>Uninstall</Button></> : <Button size="sm" variant="outline" onClick={() => controller.installFeature(feature.id)}>Install</Button>}</CardFooter></Card>)}</div>
  </section>
}

function label(feature: FeatureStatus): string { return FEATURE_COPY[feature.id].label }
