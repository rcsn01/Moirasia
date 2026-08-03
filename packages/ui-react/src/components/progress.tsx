import * as React from 'react'
import { cn } from '#lib/utils'

function Progress({ className, value = 0, max = 100, ...props }: React.ComponentProps<'div'> & { value?: number; max?: number }): React.JSX.Element {
  const percentage = Math.max(0, Math.min(100, (value / max) * 100))
  return <div role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} data-slot="progress" className={cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/20', className)} {...props}><div data-slot="progress-indicator" className="h-full bg-primary transition-transform" style={{ transform: `translateX(-${100 - percentage}%)` }} /></div>
}
export { Progress }
