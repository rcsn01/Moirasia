import * as React from 'react'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from '#lib/utils'

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root

function TooltipTrigger({ children, ...props }: Omit<React.ComponentProps<typeof TooltipPrimitive.Trigger>, 'render'> & { children: React.ReactElement }): React.JSX.Element {
  return <TooltipPrimitive.Trigger render={children} {...props} />
}

function TooltipContent({ className, sideOffset = 8, children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Popup> & { sideOffset?: number }): React.JSX.Element {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner sideOffset={sideOffset} className="z-50">
        <TooltipPrimitive.Popup data-slot="tooltip-content" className={cn('origin-[var(--transform-origin)] rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md transition-[transform,opacity] data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0', className)} {...props}>
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
