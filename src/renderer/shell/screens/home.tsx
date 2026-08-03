import { Button } from '@moirasia/ui-react/components/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@moirasia/ui-react/components/card'
import type { ShellController } from '../controller'
import { ModuleStatus } from '../components/module-status'

export function HomeScreen({ controller }: { readonly controller: ShellController }): React.JSX.Element {
  return (
    <section className="w-full max-w-4xl" aria-labelledby="home-heading">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workspace</p>
      <h1 id="home-heading" className="text-4xl font-semibold tracking-tight">Choose a module</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">Modules stay running when you switch. Quit a module to release its resources.</p>
      <div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-4">
        {controller.snapshot.modules.map((module) => {
          const transitioning = module.state === 'starting' || module.state === 'stopping'
          return (
            <Card key={module.id} className="gap-4">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle>{module.label}</CardTitle>
                  <ModuleStatus state={module.state} />
                </div>
                <CardDescription className="[overflow-wrap:anywhere]">{module.available ? 'Ready in your Moirasia workspace.' : module.unavailableReason}</CardDescription>
              </CardHeader>
              {module.error && <CardContent><p className="text-sm text-destructive [overflow-wrap:anywhere]">{module.error}</p></CardContent>}
              <CardFooter className="mt-auto gap-2">
                {module.available ? (
                  <Button size="sm" disabled={transitioning} onClick={() => controller.openModule(module.id)}>{module.state === 'running' ? 'Open' : 'Start'}</Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => controller.reportError('Installation is not available in this local-only build.')}>Install</Button>
                )}
                <Button size="sm" variant="outline" disabled={module.state === 'stopped' || transitioning} onClick={() => controller.stopModule(module.id)}>Quit Module</Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
