import { Button } from '@moirasia/ui-react/components/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@moirasia/ui-react/components/card'
import type { ModuleStatus as ModuleStatusType } from '../../../shared/contracts'
import type { ShellController } from '../controller'
import { ModuleStatus } from '../components/module-status'

export function ModuleDetailScreen({ module, controller }: { readonly module: ModuleStatusType; readonly controller: ShellController }): React.JSX.Element {
  const transitioning = module.state === 'starting' || module.state === 'stopping'
  return (
    <section className="w-full max-w-xl" aria-labelledby="module-heading">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Module</p>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3"><CardTitle id="module-heading" className="text-3xl">{module.label}</CardTitle><ModuleStatus state={module.state} /></div>
          <CardDescription>Manage this module without stopping the rest of your workspace.</CardDescription>
        </CardHeader>
        {(module.error || !module.available) && <CardContent><p className="text-sm text-destructive [overflow-wrap:anywhere]">{module.error ?? module.unavailableReason}</p></CardContent>}
        <CardFooter className="gap-2">
          <Button disabled={!module.available || transitioning} onClick={() => controller.openModule(module.id)}>{module.state === 'running' ? 'Open' : 'Start'}</Button>
          <Button variant="outline" disabled={module.state === 'stopped' || transitioning} onClick={() => controller.stopModule(module.id)}>Quit Module</Button>
        </CardFooter>
      </Card>
    </section>
  )
}
