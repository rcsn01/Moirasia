import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '#lib/utils'

type DialogContextValue = { open: boolean; setOpen: (open: boolean) => void; titleId: string; descriptionId: string }
const DialogContext = React.createContext<DialogContextValue | null>(null)

function Dialog({ open, defaultOpen = false, onOpenChange, children }: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; children: React.ReactNode }): React.JSX.Element {
  const [internal, setInternal] = React.useState(defaultOpen)
  const current = open ?? internal
  const setOpen = React.useCallback((next: boolean) => { if (open === undefined) setInternal(next); onOpenChange?.(next) }, [onOpenChange, open])
  return <DialogContext.Provider value={{ open: current, setOpen, titleId: React.useId(), descriptionId: React.useId() }}>{children}</DialogContext.Provider>
}

function useDialog(): DialogContextValue { const value = React.useContext(DialogContext); if (!value) throw new Error('Dialog components must be used within Dialog'); return value }

function DialogTrigger({ children }: { children: React.ReactElement<{ onClick?: React.MouseEventHandler }> }): React.JSX.Element { const dialog = useDialog(); return React.cloneElement(children, { onClick: (event: React.MouseEvent) => { children.props.onClick?.(event); if (!event.defaultPrevented) dialog.setOpen(true) } }) }
function DialogClose({ children }: { children: React.ReactElement<{ onClick?: React.MouseEventHandler }> }): React.JSX.Element { const dialog = useDialog(); return React.cloneElement(children, { onClick: (event: React.MouseEvent) => { children.props.onClick?.(event); if (!event.defaultPrevented) dialog.setOpen(false) } }) }

function DialogContent({ className, children, ...props }: React.ComponentProps<'div'>): React.JSX.Element | null {
  const dialog = useDialog()
  const panelRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!dialog.open) return
    const previous = document.activeElement as HTMLElement | null
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dialog.setOpen(false)
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute('disabled'))
      if (focusable.length === 0) return
      const first = focusable[0]!; const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    queueMicrotask(() => panelRef.current?.querySelector<HTMLElement>('[autofocus],button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')?.focus())
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus() }
  }, [dialog])
  if (!dialog.open) return null
  return createPortal(<div data-slot="dialog-portal" className="fixed inset-0 z-50"><div data-slot="dialog-overlay" className="absolute inset-0 bg-black/55 backdrop-blur-sm" onMouseDown={() => dialog.setOpen(false)} /><div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} aria-describedby={dialog.descriptionId} data-slot="dialog-content" className={cn('absolute left-1/2 top-1/2 grid w-[min(calc(100%-2rem),32rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-background p-6 text-foreground shadow-xl', className)} {...props}>{children}<button type="button" aria-label="Close dialog" className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => dialog.setOpen(false)}><X className="size-4" /></button></div></div>, document.body)
}
function DialogHeader({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element { return <div data-slot="dialog-header" className={cn('flex flex-col gap-2 text-left', className)} {...props} /> }
function DialogFooter({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element { return <div data-slot="dialog-footer" className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} /> }
function DialogTitle({ className, ...props }: React.ComponentProps<'h2'>): React.JSX.Element { const dialog = useDialog(); return <h2 id={dialog.titleId} data-slot="dialog-title" className={cn('text-lg font-semibold', className)} {...props} /> }
function DialogDescription({ className, ...props }: React.ComponentProps<'p'>): React.JSX.Element { const dialog = useDialog(); return <p id={dialog.descriptionId} data-slot="dialog-description" className={cn('text-sm text-muted-foreground', className)} {...props} /> }
export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription }
