import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '#lib/utils'

const alertVariants = cva('relative grid w-full grid-cols-[0_1fr] gap-y-1 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5', {
  variants: {
    variant: {
      default: 'bg-card text-card-foreground',
      destructive: 'border-destructive/40 bg-destructive/10 text-destructive [&>svg]:text-destructive'
    }
  },
  defaultVariants: { variant: 'default' }
})
function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>): React.JSX.Element {
  return <div role="alert" data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}
function AlertTitle({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="alert-title" className={cn('col-start-2 font-medium leading-none', className)} {...props} />
}
function AlertDescription({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="alert-description" className={cn('col-start-2 text-sm opacity-90', className)} {...props} />
}
export { Alert, AlertTitle, AlertDescription }
