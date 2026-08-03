import { describe, expect, it } from 'vitest'
import { isRailWidth, SHELL_RAIL_WIDTHS } from '../src/shared/contracts'

describe('shell rail width contract', () => {
  it('accepts compact, expanded, and animated widths without widening the IPC surface', () => {
    expect(SHELL_RAIL_WIDTHS).toEqual({ expanded: 256, compact: 48 })
    expect(isRailWidth(48)).toBe(true)
    expect(isRailWidth(180)).toBe(true)
    expect(isRailWidth(256)).toBe(true)
    expect(isRailWidth(47)).toBe(false)
    expect(isRailWidth(48.5)).toBe(false)
    expect(isRailWidth(321)).toBe(false)
  })
})
