import * as React from 'react'
import { cn } from '#lib/utils'

function Card({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="card" className={cn('flex min-w-0 flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm', className)} {...props} />
}
function CardHeader({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="card-header" className={cn('grid gap-1.5 px-6', className)} {...props} />
}
function CardTitle({ className, ...props }: React.ComponentProps<'h3'>): React.JSX.Element {
  return <h3 data-slot="card-title" className={cn('font-semibold leading-none', className)} {...props} />
}
function CardDescription({ className, ...props }: React.ComponentProps<'p'>): React.JSX.Element {
  return <p data-slot="card-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
}
function CardContent({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="card-content" className={cn('px-6', className)} {...props} />
}
function CardFooter({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="card-footer" className={cn('flex items-center px-6', className)} {...props} />
}
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
