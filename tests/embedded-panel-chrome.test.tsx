// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AmovePanel } from '../apps/integrated/Amove/src/renderer/main/AmovePanel'
import { BondedPanel } from '../apps/integrated/Bonded/src/renderer/App'

const pending = new Promise<never>(() => {})

afterEach(cleanup)

describe('embedded product panels', () => {
  it('leave product chrome and appearance controls to the Moirasia shell', () => {
    const amove = { getState: () => pending, subscribe: () => () => undefined }
    const bonded = { getSnapshot: () => pending, subscribeSnapshot: () => () => undefined }

    const { container } = render(<>
      <AmovePanel bridge={amove as never} appearance="light" />
      <BondedPanel bridge={bonded as never} appearance="light" />
    </>)

    expect(container.querySelector('[class$="feature-panel__header"]')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Switch to (?:light|dark) appearance/ })).not.toBeInTheDocument()
    expect(container.querySelector('.bonded-feature-panel > .content')).toHaveClass('desktop-page--wide')
  })
})
