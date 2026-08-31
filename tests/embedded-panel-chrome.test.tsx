// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AmovePanel } from '../apps/integrated/Amove/src/renderer/main/AmovePanel'
import { ExithibitionPanel } from '../apps/integrated/Exithibition/src/renderer/App'
import { OrbisPanel } from '../apps/integrated/Orbis/src/renderer/App'

const pending = new Promise<never>(() => {})

afterEach(cleanup)

describe('embedded product panels', () => {
  it('leave product chrome and appearance controls to the Moirasia shell', () => {
    const amove = { getState: () => pending, subscribe: () => () => undefined }
    const exithibition = { getSnapshot: () => pending, getHistory: () => pending, onEvent: () => () => undefined }
    const orbis = { getSnapshot: () => pending, subscribe: () => () => undefined }

    const { container } = render(<>
      <AmovePanel bridge={amove as never} appearance="light" />
      <ExithibitionPanel bridge={exithibition as never} appearance="light" />
      <OrbisPanel bridge={orbis as never} appearance="light" />
    </>)

    expect(container.querySelector('[class$="feature-panel__header"]')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Switch to (?:light|dark) appearance/ })).not.toBeInTheDocument()
  })
})
