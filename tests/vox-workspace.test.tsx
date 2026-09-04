// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VoxPanel } from '../apps/integrated/Vox/src/renderer/App'
import { DEFAULT_SETTINGS, type DashboardSnapshot } from '../apps/integrated/Vox/src/shared/types'

const snapshot: DashboardSnapshot = {
  settings: DEFAULT_SETTINGS,
  state: { status: 'idle', captureMode: null, handsFreeEnabled: false, partialTranscript: '', lastResult: '', warning: null, error: null, level: 0 },
  permissions: { microphone: 'granted', 'speech-recognition': 'not-determined', accessibility: 'granted', 'screen-recording': 'not-determined' },
  capabilities: null,
  models: [],
  aggregates: { todayWords: 0, todayUtterances: 0, streakDays: 0 },
  profiles: [],
  customModes: [],
  snippets: [],
  corrections: [],
}

afterEach(cleanup)

describe('Vox workspace', () => {
  it('shows model download percentage and transfer speed', async () => {
    const bridge = {
      getSnapshot: async () => ({
        ...snapshot,
        models: [{ id: 'parakeet-v3', status: 'downloading', progress: 0.42, bytesPerSecond: 1_500_000 }],
      }),
      onEvent: () => () => undefined,
    }
    render(<VoxPanel bridge={bridge as never} appearance="light" />)

    fireEvent.click(await screen.findByRole('tab', { name: 'Models' }))
    expect(await screen.findByText('42% · 1.5 MB/s')).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Parakeet v3 Fast download' })).toHaveAttribute('aria-valuenow', '42')
  })

  it('shows Parakeet v3 and Parakeet Streaming as separate choices', async () => {
    const bridge = {
      getSnapshot: async () => ({
        ...snapshot,
        models: [{ id: 'parakeet-v3', status: 'ready', progress: 1, sizeBytes: 1_500_000_000 }],
      }),
      onEvent: () => () => undefined,
    }
    render(<VoxPanel bridge={bridge as never} appearance="light" />)

    fireEvent.click(await screen.findByRole('tab', { name: 'Models' }))
    expect(screen.getByText('Parakeet v3 Fast')).toBeVisible()
    expect(screen.getByText('Downloaded · 1.50 GB')).toBeVisible()
    expect(screen.getByText('Parakeet Streaming')).toBeVisible()
    expect(screen.getByText('Live push-to-talk · 320 ms')).toBeVisible()

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(screen.getByRole('option', { name: 'Parakeet v3' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'Parakeet Streaming (push-to-talk only)' })).toBeVisible()

    fireEvent.click(screen.getByRole('tab', { name: 'Profiles' }))
    expect(screen.getByRole('option', { name: 'Parakeet Streaming (push-to-talk only)' })).toBeVisible()
  })

  it('does not render the repeated page heading and actions on any tab', async () => {
    const bridge = {
      getSnapshot: async () => snapshot,
      onEvent: () => () => undefined,
    }
    render(<VoxPanel bridge={bridge as never} appearance="light" />)

    await screen.findByText('Speak. Vox handles the rest.')
    for (const name of ['Stats', 'Meetings', 'Models', 'Profiles', 'Commands', 'Settings']) {
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }))
      expect(screen.queryByText('Daily dictation review build')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Hands-free/ })).not.toBeInTheDocument()
    }
  })
})
