import { Badge } from '@moirasia/ui-react/components/badge'
import type { ModuleState } from '../../../shared/contracts'

const statusStyles: Record<ModuleState, string> = {
  stopped: 'bg-muted-foreground/15 text-muted-foreground',
  starting: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  running: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  stopping: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  failed: 'bg-destructive/15 text-destructive'
}

export function ModuleStatus({ state }: { readonly state: ModuleState }): React.JSX.Element {
  return (
    <Badge variant="outline" className={`border-transparent capitalize ${statusStyles[state]}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {state}
    </Badge>
  )
}
