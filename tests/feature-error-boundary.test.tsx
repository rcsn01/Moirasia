// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeatureErrorBoundary } from '../src/renderer/shell/components/feature-error-boundary'

function Boom({ shouldThrow }: { shouldThrow: boolean }): React.JSX.Element {
  if (shouldThrow) throw new Error('boom: module graph exploded')
  return <div>panel rendered</div>
}

/** Hosts the boundary under a remount key so tests can drive retry-without-reload. */
function Harness({ shouldThrow }: { shouldThrow: boolean }): React.JSX.Element {
  const [attempt, setAttempt] = useState(0)
  return (
    <div>
      <button onClick={() => setAttempt((value) => value + 1)}>remount</button>
      <FeatureErrorBoundary key={attempt} name="Exithibition">
        <Boom shouldThrow={shouldThrow} />
      </FeatureErrorBoundary>
    </div>
  )
}

describe('FeatureErrorBoundary', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    Object.defineProperty(window, 'location', { value: { ...window.location, reload: vi.fn() }, configurable: true, writable: true })
  })

  afterEach(() => {
    cleanup()
    consoleError.mockRestore()
    vi.restoreAllMocks()
  })

  it('renders the inline fallback instead of crashing the tree', () => {
    render(<FeatureErrorBoundary name="Exithibition"><Boom shouldThrow /></FeatureErrorBoundary>)
    expect(screen.getByText('Exithibition failed to load')).toBeInTheDocument()
    expect(screen.getByText(/boom: module graph exploded/)).toBeInTheDocument()
    expect(screen.queryByText('panel rendered')).not.toBeInTheDocument()
  })

  it('keeps sibling content alive when a child throws', () => {
    render(
      <div>
        <p>sidebar stands</p>
        <FeatureErrorBoundary name="Exithibition"><Boom shouldThrow /></FeatureErrorBoundary>
      </div>
    )
    expect(screen.getByText('sidebar stands')).toBeInTheDocument()
    expect(screen.getByText('Exithibition failed to load')).toBeInTheDocument()
  })

  it('logs the caught error with the feature name', () => {
    render(<FeatureErrorBoundary name="Exithibition"><Boom shouldThrow /></FeatureErrorBoundary>)
    expect(consoleError).toHaveBeenCalledWith('[shell] Exithibition failed to render:', expect.any(Error), expect.anything())
  })

  it('reloads the window from the fallback action', async () => {
    const user = userEvent.setup()
    render(<FeatureErrorBoundary name="Exithibition"><Boom shouldThrow /></FeatureErrorBoundary>)
    await user.click(screen.getByRole('button', { name: /Reload Moirasia/ }))
    expect(window.location.reload).toHaveBeenCalledTimes(1)
  })

  it('renders children again after a remount with fresh state', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness shouldThrow />)
    expect(screen.getByText('Exithibition failed to load')).toBeInTheDocument()
    rerender(<Harness shouldThrow={false} />)
    await user.click(screen.getByRole('button', { name: 'remount' }))
    expect(screen.getByText('panel rendered')).toBeInTheDocument()
    expect(screen.queryByText('Exithibition failed to load')).not.toBeInTheDocument()
  })
})