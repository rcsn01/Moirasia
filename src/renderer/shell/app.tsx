import { useEffect, useRef } from 'react'
import { AlertCircle } from '@moirasia/ui-react/lib/icons'
import { Alert, AlertDescription, AlertTitle } from '@moirasia/ui-react/components/alert'
import { Skeleton } from '@moirasia/ui-react/components/skeleton'
import { TooltipProvider } from '@moirasia/ui-react/components/tooltip'
import { SHELL_RAIL_WIDTHS } from '../../shared/contracts'
import { ShellSidebar } from './components/shell-sidebar'
import { useShellController } from './controller'
import { HomeScreen } from './screens/home'
import { ModuleDetailScreen } from './screens/module-detail'
import { SettingsScreen } from './screens/settings'

export function App(): React.JSX.Element {
  const controller = useShellController()
  const railRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    let frame = 0
    let lastWidth = -1
    const publish = (measuredWidth?: number): void => {
      const fallback = controller.settings.compactRail ? SHELL_RAIL_WIDTHS.compact : SHELL_RAIL_WIDTHS.expanded
      const rawWidth = measuredWidth && measuredWidth > 0 ? measuredWidth : fallback
      const width = Math.max(SHELL_RAIL_WIDTHS.compact, Math.min(320, Math.round(rawWidth)))
      if (width === lastWidth) return
      lastWidth = width
      window.moirasia.setRailWidth(width)
    }
    publish(rail.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const borderBox = entries[0]?.borderBoxSize[0]
      const width = borderBox?.inlineSize ?? rail.getBoundingClientRect().width
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => publish(width))
    })
    observer.observe(rail)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [controller.settings.compactRail])

  useEffect(() => {
    mainRef.current?.scrollTo?.({ top: 0, left: 0 })
  }, [controller.page, controller.selected])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'F6') return
      event.preventDefault()
      if (railRef.current?.contains(document.activeElement)) mainRef.current?.focus()
      else railRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <TooltipProvider>
      <div className="flex h-full bg-background text-foreground">
        <ShellSidebar controller={controller} railRef={railRef} />
        <main ref={mainRef} tabIndex={-1} className="shell-main relative flex flex-1 overflow-auto bg-background p-8 outline-none md:p-12">
          <div className="m-auto w-full">
            {controller.loading ? <LoadingScreen /> : (
              <>
                {controller.page === 'home' && <HomeScreen controller={controller} />}
                {controller.page === 'settings' && <SettingsScreen controller={controller} />}
                {controller.page === null && controller.selectedStatus && <ModuleDetailScreen module={controller.selectedStatus} controller={controller} />}
              </>
            )}
          </div>
          {controller.error && (
            <Alert variant="destructive" className="fixed bottom-5 right-5 z-50 max-w-md bg-background/95 shadow-lg backdrop-blur">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>Action failed</AlertTitle>
              <AlertDescription>{controller.error}</AlertDescription>
            </Alert>
          )}
        </main>
      </div>
    </TooltipProvider>
  )
}

function LoadingScreen(): React.JSX.Element {
  return (
    <section className="mx-auto w-full max-w-3xl" aria-label="Loading workspace" aria-busy="true">
      <span className="sr-only">Loading workspace</span>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-11 w-72" />
      <div className="mt-8 grid gap-4 md:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
    </section>
  )
}
