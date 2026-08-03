import { AppWindow, ChevronRight, Home, PanelLeftClose, Play, Settings, Square } from '@moirasia/ui-react/lib/icons'
import { Button } from '@moirasia/ui-react/components/button'
import { Separator } from '@moirasia/ui-react/components/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@moirasia/ui-react/components/tooltip'
import type { ShellController } from '../controller'

interface ShellSidebarProps {
  readonly controller: ShellController
  readonly railRef: React.RefObject<HTMLElement | null>
}

function RailButton({ compact, label, selected = false, children, ...props }: React.ComponentProps<typeof Button> & { compact: boolean; label: string; selected?: boolean }): React.JSX.Element {
  const button = (
    <Button
      variant="ghost"
      size={compact ? 'icon' : 'default'}
      aria-label={compact ? label : undefined}
      className={`w-full ${compact ? 'size-8' : 'justify-start px-2.5'} ${selected ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`}
      {...props}
    >
      {children}
      {!compact && <span className="truncate">{label}</span>}
    </Button>
  )
  if (!compact) return button
  return <Tooltip><TooltipTrigger>{button}</TooltipTrigger><TooltipContent sideOffset={10}>{label}</TooltipContent></Tooltip>
}

export function ShellSidebar({ controller, railRef }: ShellSidebarProps): React.JSX.Element {
  const { snapshot, selected, selectedStatus, page, settings } = controller
  const compact = settings.compactRail
  const transitionDisabled = selectedStatus?.state === 'starting' || selectedStatus?.state === 'stopping'

  return (
    <aside ref={railRef} className="shell-rail relative z-10 flex h-full flex-col gap-2 overflow-hidden border-r bg-card px-2 pb-2 pt-11" data-compact={compact} aria-label="Application navigation">
      <div className={`flex h-8 shrink-0 items-center font-semibold tracking-tight ${compact ? 'justify-center' : 'px-2'}`} role="img" aria-label="Moirasia">
        {compact ? <AppWindow className="size-5" aria-hidden="true" /> : 'Moirasia'}
      </div>
      <nav aria-label="Pages" className="grid gap-1">
        <RailButton compact={compact} label="Home" selected={page === 'home'} aria-current={page === 'home' ? 'page' : undefined} onClick={() => controller.showPage('home')}>
          <Home aria-hidden="true" />
        </RailButton>
      </nav>
      <Separator />
      <nav aria-label="Modules" className="grid gap-1">
        {snapshot.modules.map((module) => (
          <RailButton
            key={module.id}
            compact={compact}
            label={module.label}
            selected={selected === module.id && page === null}
            aria-current={selected === module.id && page === null ? 'page' : undefined}
            disabled={!module.available}
            title={!compact ? module.unavailableReason : undefined}
            onClick={() => controller.openModule(module.id)}
          >
            <span className={`size-2 shrink-0 rounded-full ${module.state === 'running' ? 'bg-emerald-500' : module.state === 'failed' ? 'bg-destructive' : module.state === 'starting' || module.state === 'stopping' ? 'bg-amber-500' : 'bg-muted-foreground/50'}`} aria-hidden="true" />
            <span className="sr-only">{module.available ? module.state : `unavailable: ${module.unavailableReason}`}{module.active ? ', open' : ''}</span>
          </RailButton>
        ))}
      </nav>
      <Separator />
      <div aria-label="Selected module controls" className="grid gap-1">
        <RailButton compact={compact} label={selectedStatus?.state === 'running' ? 'Open' : 'Start'} disabled={!selectedStatus?.available || transitionDisabled} onClick={() => controller.openModule(selected)}>
          <Play aria-hidden="true" />
        </RailButton>
        <RailButton compact={compact} label="Quit Module" disabled={!selectedStatus || selectedStatus.state === 'stopped' || transitionDisabled} onClick={() => controller.stopModule(selected)}>
          <Square aria-hidden="true" />
        </RailButton>
      </div>
      <div className="mt-auto grid gap-1">
        <Separator className="mb-1" />
        <RailButton compact={compact} label="Settings" selected={page === 'settings'} aria-current={page === 'settings' ? 'page' : undefined} onClick={() => controller.showPage('settings')}>
          <Settings aria-hidden="true" />
        </RailButton>
        <RailButton compact={compact} label={compact ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => void controller.updateSettings({ compactRail: !compact })}>
          {compact ? <ChevronRight aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </RailButton>
      </div>
    </aside>
  )
}
