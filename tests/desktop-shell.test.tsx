// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopAppShell, DesktopContentHeader, DesktopNavigation, DesktopPage } from '../packages/desktop-shell/src/react'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('DesktopAppShell', () => {
  it('owns identical product and appearance chrome', () => {
    const changed = vi.fn()
    const { container, rerender } = render(<DesktopAppShell product="Bonded" appearance="light" onAppearanceChange={changed}><p>Ready</p></DesktopAppShell>)
    const chrome = container.querySelector('.desktop-shell__chrome')!
    expect(chrome).toHaveTextContent('Bonded')
    expect(chrome.querySelectorAll('select')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark appearance' }))
    expect(changed).toHaveBeenCalledWith('dark')
    rerender(<DesktopAppShell product="Bonded" appearance="dark" onAppearanceChange={changed}><p>Ready</p></DesktopAppShell>)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light appearance' }))
    expect(changed).toHaveBeenLastCalledWith('light')
  })

  it('turns a retained system preference into the opposite explicit appearance', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const changed = vi.fn()
    render(<DesktopAppShell product="Moirasia" appearance="system" onAppearanceChange={changed}><p>Ready</p></DesktopAppShell>)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light appearance' }))
    expect(changed).toHaveBeenCalledWith('light')
  })

  it('renders optional accessible navigation, badges, and footer', () => {
    const select = vi.fn()
    const navigation = <DesktopNavigation label="Sections" active="apps" onSelect={select} items={[{ id: 'apps', label: 'Apps', badge: '2' }, { id: 'settings', label: 'Settings' }]}/>
    render(<DesktopAppShell product="Moirasia" appearance="light" onAppearanceChange={vi.fn()} navigation={navigation} footer={<p>Private</p>}><p>Content</p></DesktopAppShell>)
    expect(screen.getByRole('button', { name: /Apps/ })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(select).toHaveBeenCalledWith('settings')
    const apps = screen.getByRole('button', { name: /Apps/ })
    apps.focus()
    fireEvent.keyDown(apps, { key: 'End' })
    expect(select).toHaveBeenLastCalledWith('settings')
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus()
    expect(screen.getByText('Private')).toBeVisible()
  })

  it('exposes page width/scroll variants and content actions below chrome', () => {
    const { container } = render(<DesktopAppShell product="Vox" appearance="dark" onAppearanceChange={vi.fn()}><DesktopPage width="wide" scroll="contained"><DesktopContentHeader title="Stats" actions={<button>Hands-free</button>}/></DesktopPage></DesktopAppShell>)
    expect(container.querySelector('.desktop-page--wide.desktop-page--scroll-contained')).toBeTruthy()
    expect(container.querySelector('.desktop-shell__chrome')).not.toContainElement(screen.getByRole('button', { name: 'Hands-free' }))
  })

  it('keeps loading and error states below the shared chrome', () => {
    const { container } = render(<DesktopAppShell product="Amove" appearance="system" onAppearanceChange={vi.fn()}><div role="status">Opening…</div><div role="alert">Could not open</div></DesktopAppShell>)
    const chrome = container.querySelector('.desktop-shell__chrome')!
    const content = container.querySelector('.desktop-shell__content')!
    expect(chrome).toBeVisible()
    expect(content).toContainElement(screen.getByRole('status'))
    expect(content).toContainElement(screen.getByRole('alert'))
  })

  it('locks the compact geometry and neutral semantic token ownership', async () => {
    const styles = await readFile(resolve(process.cwd(), 'packages/desktop-shell/src/styles.css'), 'utf8')
    expect(styles).toMatch(/--desktop-chrome-height:\s*36px/)
    expect(styles).toMatch(/\.desktop-shell__chrome--macos[^}]*padding-left:84px/)
    expect(styles).toMatch(/\.desktop-appearance-toggle[^}]*width:24px[^}]*height:24px/)
    expect(styles).toMatch(/\.desktop-appearance-toggle[^}]*border:0[^}]*background:transparent/)
    expect(styles).toMatch(/\.desktop-appearance-control select[^}]*height:24px/)
    expect(styles).toMatch(/\.desktop-shell__product[^}]*font-size:12px/)
    expect(styles).toMatch(/\.desktop-shell__body[^}]*calc\(100% - var\(--desktop-chrome-height\)\)/)
    expect(styles).toContain('--desktop-chrome-background: var(--background)')
    expect(styles).toContain('--desktop-chrome-control-background: var(--card)')
    expect(styles).not.toMatch(/(?:height|min-height):52px|calc\(100% - 52px\)/)

    const tokens = JSON.parse(await readFile(resolve(process.cwd(), 'packages/design-system/product-tokens.json'), 'utf8')).product
    expect(tokens.amove).not.toHaveProperty('light')
    expect(tokens.vox.light.color).not.toHaveProperty('canvas')
    expect(tokens.exithibition.light.color).not.toHaveProperty('surface')
    expect(tokens.bonded.light.color).not.toHaveProperty('background')
  })
})
