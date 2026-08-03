import * as React from 'react'
import { cn } from '#lib/utils'

type ToggleContext = { value: string[]; type: 'single' | 'multiple'; disabled: boolean | undefined; toggle: (value: string) => void }
const Context = React.createContext<ToggleContext | null>(null)

function ToggleGroup({ className, type = 'single', value, defaultValue, onValueChange, disabled, children, ...props }: Omit<React.ComponentProps<'div'>, 'defaultValue' | 'onChange'> & { type?: 'single' | 'multiple'; value?: string | string[]; defaultValue?: string | string[]; onValueChange?: (value: string | string[]) => void; disabled?: boolean }): React.JSX.Element {
  const normalize = (input?: string | string[]) => input === undefined ? [] : Array.isArray(input) ? input : input ? [input] : []
  const [internal, setInternal] = React.useState(normalize(defaultValue))
  const current = value === undefined ? internal : normalize(value)
  const toggle = (next: string) => {
    const selected = current.includes(next)
    const values = type === 'single' ? (selected ? [] : [next]) : (selected ? current.filter((item) => item !== next) : [...current, next])
    if (value === undefined) setInternal(values)
    onValueChange?.(type === 'single' ? values[0] ?? '' : values)
  }
  return <Context.Provider value={{ value: current, type, disabled, toggle }}><div role="group" data-slot="toggle-group" className={cn('inline-flex items-center rounded-lg border bg-muted p-1', className)} {...props}>{children}</div></Context.Provider>
}

const ToggleGroupItem = React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'> & { value: string }>(
  ({ className, value, type = 'button', ...props }, ref) => {
    const group = React.useContext(Context)
    if (!group) throw new Error('ToggleGroupItem must be used within ToggleGroup')
    const pressed = group.value.includes(value)
    return <button ref={ref} type={type} aria-pressed={pressed} data-state={pressed ? 'on' : 'off'} data-slot="toggle-group-item" disabled={props.disabled ?? group.disabled} className={cn('inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm disabled:pointer-events-none disabled:opacity-50', className)} onClick={(event) => { props.onClick?.(event); if (!event.defaultPrevented) group.toggle(value) }} {...props} />
  }
)
ToggleGroupItem.displayName = 'ToggleGroupItem'
export { ToggleGroup, ToggleGroupItem }
