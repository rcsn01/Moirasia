import { describe, expect, it } from 'vitest'
import { buildChart } from '../packages/feature-orbis/src/main/chart'

const children = [
  { id: 'users', parentId: 'root', name: 'Users', path: '/Users', kind: 'directory' as const, sizeBytes: 26, confirmedBytes: 26, estimatedBytes: 0, directChildren: 1, descendantCount: 1, unreadableCount: 0, scanState: 'complete' as const, sizeAccuracy: 'exact' as const },
  { id: 'system', parentId: 'root', name: 'System', path: '/System', kind: 'directory' as const, sizeBytes: 74, confirmedBytes: 74, estimatedBytes: 0, directChildren: 1, descendantCount: 1, unreadableCount: 0, scanState: 'complete' as const, sizeAccuracy: 'exact' as const }
]
const root = { id: 'root', parentId: null, name: 'Disk', path: '/', kind: 'directory' as const, sizeBytes: 100, confirmedBytes: 100, estimatedBytes: 0, directChildren: 2, descendantCount: 2, unreadableCount: 0, scanState: 'complete' as const, sizeAccuracy: 'exact' as const }
const source = {
  getNode: (id: string) => id === root.id ? root : children.find((child) => child.id === id),
  getChildren: (id: string) => id === root.id ? children : [],
  countChildren: (id: string) => id === root.id ? children.length : 0
}

describe('Orbis chart disk-capacity scale', () => {
  it('leaves capacity outside the scanned root as a blank arc', () => {
    const chart = buildChart(source, root, { maxRings: 1, rootTotalBytes: 926 })
    const users = chart.find((segment) => segment.name === 'Users')

    expect(users?.percentage).toBeCloseTo(26 / 926 * 100)
    expect((users?.endAngle ?? 0) - (users?.startAngle ?? 0)).toBeCloseTo(26 / 926 * 360)
    expect(chart.at(-1)?.endAngle).toBeCloseTo(100 / 926 * 360)
    expect(chart.some((segment) => segment.name === 'Unscanned or system data')).toBe(false)
  })

  it('continues to fill the circle for a selected folder', () => {
    const chart = buildChart(source, root, { maxRings: 1 })

    expect(chart.at(-1)?.endAngle).toBe(360)
    expect(chart.reduce((sum, segment) => sum + segment.percentage, 0)).toBe(100)
  })
})
