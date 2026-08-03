// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Alert, AlertDescription, AlertTitle } from '@moirasia/ui-react/components/alert'
import { Badge } from '@moirasia/ui-react/components/badge'
import { Button } from '@moirasia/ui-react/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@moirasia/ui-react/components/card'
import { Label } from '@moirasia/ui-react/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@moirasia/ui-react/components/select'
import { Separator } from '@moirasia/ui-react/components/separator'
import { Skeleton } from '@moirasia/ui-react/components/skeleton'
import { Switch } from '@moirasia/ui-react/components/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@moirasia/ui-react/components/tooltip'

afterEach(cleanup)

describe('@moirasia/ui-react', () => {
  it('renders the initial shared component inventory from public subpaths', () => {
    const view = render(
      <TooltipProvider>
        <Card>
          <CardHeader><CardTitle>Component smoke test</CardTitle></CardHeader>
          <CardContent>
            <Badge>Ready</Badge>
            <Separator />
            <Label htmlFor="notifications">Notifications</Label>
            <Switch id="notifications" aria-label="Notifications" />
            <Select defaultValue="one">
              <SelectTrigger aria-label="Choice"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="one">One</SelectItem></SelectContent>
            </Select>
            <Tooltip><TooltipTrigger><Button>Action</Button></TooltipTrigger><TooltipContent>Run action</TooltipContent></Tooltip>
            <Alert><AlertTitle>Notice</AlertTitle><AlertDescription>Shared controls loaded.</AlertDescription></Alert>
            <Skeleton aria-label="Placeholder" className="h-4" />
          </CardContent>
        </Card>
      </TooltipProvider>
    )

    expect(screen.getByRole('heading', { name: 'Component smoke test' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Action' })).toBeEnabled()
    expect(screen.getByRole('switch', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Choice' })).toBeInTheDocument()
    for (const slot of ['card', 'badge', 'separator', 'switch', 'select-trigger', 'alert', 'skeleton']) {
      expect(view.container.querySelector(`[data-slot="${slot}"]`)).not.toBeNull()
    }
  })
})
