import * as React from 'react'
import { cn } from '#lib/utils'

type ContextValue = { name: string; value: string | undefined; disabled: boolean | undefined; change: (value: string) => void }
const Context = React.createContext<ContextValue | null>(null)

function RadioGroup({ className, value, defaultValue, onValueChange, disabled, children, ...props }: Omit<React.ComponentProps<'div'>, 'defaultValue' | 'onChange'> & { value?: string; defaultValue?: string; onValueChange?: (value: string) => void; disabled?: boolean }): React.JSX.Element {
  const [internal, setInternal] = React.useState(defaultValue)
  const name = React.useId()
  const current = value ?? internal
  const change = React.useCallback((next: string) => { if (value === undefined) setInternal(next); onValueChange?.(next) }, [onValueChange, value])
  return <Context.Provider value={{ name, value: current, disabled, change }}><div role="radiogroup" data-slot="radio-group" className={cn('grid gap-3', className)} {...props}>{children}</div></Context.Provider>
}

const RadioGroupItem = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<'input'>, 'type' | 'name' | 'value'> & { value: string }>(
  ({ className, value, disabled, ...props }, ref) => {
    const group = React.useContext(Context)
    if (!group) throw new Error('RadioGroupItem must be used within RadioGroup')
    return <label data-slot="radio-group-item" className={cn('relative inline-grid size-4 shrink-0 cursor-pointer place-items-center rounded-full border border-input text-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50', className)}><input ref={ref} className="peer absolute inset-0 opacity-0" type="radio" name={group.name} value={value} checked={group.value === value} disabled={disabled ?? group.disabled} onChange={() => group.change(value)} {...props} /><span className="size-2 rounded-full bg-current opacity-0 peer-checked:opacity-100" /></label>
  }
)
RadioGroupItem.displayName = 'RadioGroupItem'
export { RadioGroup, RadioGroupItem }
