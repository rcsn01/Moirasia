import * as React from 'react'
import { cn } from '#lib/utils'

const ScrollArea = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(({ className, children, ...props }, ref) => <div ref={ref} data-slot="scroll-area" className={cn('relative overflow-auto', className)} {...props}>{children}</div>)
ScrollArea.displayName = 'ScrollArea'
function ScrollBar({ className, orientation = 'vertical', ...props }: React.ComponentProps<'div'> & { orientation?: 'vertical' | 'horizontal' }): React.JSX.Element { return <div aria-hidden="true" data-slot="scroll-bar" data-orientation={orientation} className={cn('pointer-events-none absolute opacity-0', className)} {...props} /> }
export { ScrollArea, ScrollBar }
