import * as React from 'react'
import { cn } from '#lib/utils'

type TabsContext = { value: string; setValue: (value: string) => void }
const Context = React.createContext<TabsContext | null>(null)
function Tabs({ value, defaultValue = '', onValueChange, className, children, ...props }: Omit<React.ComponentProps<'div'>, 'defaultValue'> & { value?: string; defaultValue?: string; onValueChange?: (value: string) => void }): React.JSX.Element {
  const [internal, setInternal] = React.useState(defaultValue)
  const current = value ?? internal
  const setValue = (next: string) => { if (value === undefined) setInternal(next); onValueChange?.(next) }
  return <Context.Provider value={{ value: current, setValue }}><div data-slot="tabs" className={cn('flex flex-col gap-2', className)} {...props}>{children}</div></Context.Provider>
}
function TabsList({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element { return <div role="tablist" data-slot="tabs-list" className={cn('inline-flex h-9 w-fit items-center rounded-lg bg-muted p-1 text-muted-foreground', className)} {...props} /> }
const TabsTrigger = React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'> & { value: string }>(({ className, value, onClick, ...props }, ref) => { const tabs = React.useContext(Context); if (!tabs) throw new Error('TabsTrigger must be used within Tabs'); const active = tabs.value === value; return <button ref={ref} role="tab" aria-selected={active} data-state={active ? 'active' : 'inactive'} data-slot="tabs-trigger" className={cn('inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm', className)} onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) tabs.setValue(value) }} {...props} /> })
TabsTrigger.displayName = 'TabsTrigger'
function TabsContent({ className, value, ...props }: React.ComponentProps<'div'> & { value: string }): React.JSX.Element | null { const tabs = React.useContext(Context); if (!tabs) throw new Error('TabsContent must be used within Tabs'); if (tabs.value !== value) return null; return <div role="tabpanel" data-slot="tabs-content" className={cn('outline-none', className)} {...props} /> }
export { Tabs, TabsList, TabsTrigger, TabsContent }
