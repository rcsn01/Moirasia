import * as React from 'react'
import { ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import type { TooltipContentProps, TooltipProps } from 'recharts/types/component/Tooltip'
import { cn } from '#lib/utils'

type ChartConfig = Record<string, { label?: React.ReactNode; color?: string }>
const ChartContext = React.createContext<ChartConfig>({})

function ChartContainer({ config, className, children, ...props }: React.ComponentProps<'div'> & { config: ChartConfig; children: React.ComponentProps<typeof ResponsiveContainer>['children'] }): React.JSX.Element {
  const variables = Object.fromEntries(Object.entries(config).filter(([, item]) => item.color).map(([key, item]) => [`--color-${key}`, item.color])) as React.CSSProperties
  return <ChartContext.Provider value={config}><div data-slot="chart" className={cn('flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/60 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border', className)} style={{ ...variables, ...props.style }} {...props}><ResponsiveContainer>{children}</ResponsiveContainer></div></ChartContext.Provider>
}

function ChartTooltip(props: TooltipProps<ValueType, NameType>): React.JSX.Element { return <RechartsTooltip content={ChartTooltipContent} {...props} /> }
function ChartTooltipContent({ active, payload, label }: TooltipContentProps<ValueType, NameType>): React.JSX.Element | null {
  const config = React.useContext(ChartContext)
  if (!active || !payload?.length) return null
  return <div data-slot="chart-tooltip" className="grid min-w-32 gap-1.5 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xl">{label != null && <div className="font-medium">{String(label)}</div>}{payload.map((item) => <div key={String(item.dataKey ?? item.name)} className="flex items-center justify-between gap-4"><span className="flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-sm" style={{ background: item.color }} />{config[String(item.dataKey)]?.label ?? item.name}</span><span className="font-mono font-medium tabular-nums">{String(item.value ?? '—')}</span></div>)}</div>
}
export { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig }
export { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Pie, PieChart, XAxis, YAxis } from 'recharts'
