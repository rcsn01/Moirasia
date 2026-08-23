import { Alert, AlertDescription, AlertTitle } from '@moirasia/ui-react/components/alert'
import { Badge } from '@moirasia/ui-react/components/badge'
import { Button } from '@moirasia/ui-react/components/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@moirasia/ui-react/components/card'
import type { ApplicationId, FeatureStatus } from '../../../shared/contracts'
import type { useController } from '../controller'

const FEATURE_COPY: Readonly<Partial<Record<ApplicationId, { label: string; description: string }>>> = {
  exithibition: { label: 'Exithibition', description: 'Live Apple-silicon telemetry rendered as an interactive hardware schematic.' }
}

export function AppsScreen({ controller }: { controller: ReturnType<typeof useController> }): React.JSX.Element {
  const features = controller.snapshot.features
  const restartPending = features.filter((feature) => feature.restartPending)
  const inSuite = (id: ApplicationId): boolean => features.some((feature) => feature.id === id && feature.installed)
  return <section className="controller-page" aria-labelledby="apps-heading"><p className="eyebrow">APPLICATIONS</p><h1 id="apps-heading">Your apps</h1><p className="lede">Open, focus, or gracefully quit each standalone application. They keep running when Moirasia closes.</p><div className="application-grid">{controller.snapshot.applications.map((application) => <Card key={application.id}><CardHeader><div className="card-title-row"><CardTitle>{application.label}</CardTitle><Badge variant={application.running ? 'secondary' : 'outline'}>{application.running ? 'Running' : 'Closed'}</Badge></div><CardDescription>{application.installed ? 'Installed' : 'Not installed'}</CardDescription>{application.id === 'exithibition' && inSuite(application.id) && <p className="feature-note">Running inside Moirasia</p>}{application.error && <p className="application-error">{application.error}</p>}</CardHeader><CardFooter><Button size="sm" disabled={!application.installed || !!application.busy} onClick={() => controller.open(application.id)}>{application.busy === 'opening' ? 'Opening…' : application.running ? 'Focus' : 'Open'}</Button><Button size="sm" variant="outline" disabled={!application.running || !!application.busy} onClick={() => controller.quit(application.id)}>{application.busy === 'quitting' ? 'Quitting…' : 'Quit'}</Button></CardFooter></Card>)}</div>
    <section className="feature-section" aria-labelledby="features-heading"><p className="eyebrow">FEATURES</p><h2 id="features-heading">Inside Moirasia</h2><p className="lede">Whole products that run inside this Moirasia process. Uninstalling keeps each product's settings; a restart fully unloads it.</p>
      {restartPending.length > 0 && <Alert className="restart-banner"><AlertTitle>Restart required</AlertTitle><AlertDescription>{`Uninstalled ${restartPending.map((feature) => label(feature)).join(', ')} stays in memory until Moirasia restarts.`} <Button size="sm" onClick={() => controller.relaunchApp()}>Restart Moirasia</Button></AlertDescription></Alert>}
      <div className="application-grid">{features.map((feature) => <Card key={feature.id}><CardHeader><div className="card-title-row"><CardTitle>{label(feature)}</CardTitle><Badge variant={feature.restartPending ? 'destructive' : feature.loaded ? 'secondary' : 'outline'}>{feature.restartPending ? 'Restart pending' : feature.loaded ? 'Loaded' : 'Not loaded'}</Badge></div><CardDescription>{FEATURE_COPY[feature.id]?.description ?? 'Runs inside Moirasia.'}</CardDescription></CardHeader><CardFooter><Button size="sm" disabled={!feature.installed} onClick={() => controller.openFeature(feature.id)}>Open</Button>{feature.installed ? <Button size="sm" variant="outline" onClick={() => controller.uninstallFeature(feature.id)}>Uninstall</Button> : <Button size="sm" variant="outline" onClick={() => controller.installFeature(feature.id)}>Install</Button>}</CardFooter></Card>)}</div>
    </section>
  </section>
}

function label(feature: FeatureStatus): string { return FEATURE_COPY[feature.id]?.label ?? feature.id[0]!.toUpperCase() + feature.id.slice(1) }
