// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppearanceScope, DesktopAppShell, DesktopContentHeader, DesktopNavigation, DesktopPage } from '../packages/desktop-shell/src/react'

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

  it('renders grouped navigation and moves focus across group boundaries', () => {
    const select = vi.fn()
    render(<DesktopNavigation label="Moirasia sections" active="features" onSelect={select} groups={[
      { id: 'essentials', label: 'Essentials', items: [{ id: 'general', label: 'General' }, { id: 'features', label: 'Features' }] },
      { id: 'apps', label: 'Apps', items: [{ id: 'amove', label: 'Amove' }] },
      { id: 'empty', label: 'Empty', items: [] }
    ]}/>)

    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'Essentials' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Apps' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Empty' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Features' })).toHaveAttribute('aria-current', 'page')

    const features = screen.getByRole('button', { name: 'Features' })
    features.focus()
    fireEvent.keyDown(features, { key: 'ArrowDown' })
    expect(select).toHaveBeenCalledWith('amove')
    expect(screen.getByRole('button', { name: 'Amove' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Amove' }), { key: 'Home' })
    expect(select).toHaveBeenLastCalledWith('general')
    expect(screen.getByRole('button', { name: 'General' })).toHaveFocus()
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

  it('keeps embedded appearance local to its product subtree', () => {
    const { container, rerender } = render(<AppearanceScope appearance="dark" className="feature-scope"><p>Telemetry</p></AppearanceScope>)
    expect(container.querySelector('.appearance-scope.dark.feature-scope')).toBeTruthy()
    expect(document.documentElement).not.toHaveClass('dark')
    rerender(<AppearanceScope appearance="light" className="feature-scope"><p>Telemetry</p></AppearanceScope>)
    expect(container.querySelector('.appearance-scope.light.feature-scope')).toBeTruthy()
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('locks the compact geometry and neutral semantic token ownership', async () => {
    const styles = await readFile(resolve(process.cwd(), 'packages/desktop-shell/src/styles.css'), 'utf8')
    expect(styles).toMatch(/--desktop-chrome-height:\s*36px/)
    expect(styles).toMatch(/\.desktop-shell__chrome--macos[^}]*padding-left:84px/)
    expect(styles).toMatch(/\.desktop-appearance-toggle[^}]*width:24px[^}]*height:24px/)
    expect(styles).toMatch(/\.desktop-appearance-toggle[^}]*border:0[^}]*background:transparent/)
    expect(styles).toMatch(/\.desktop-appearance-control select[^}]*height:24px/)
    expect(styles).toMatch(/\.desktop-shell__product[^}]*font-size:12px/)
    expect(styles).toMatch(/\.desktop-shell[^}]*position:fixed[^}]*inset:0[^}]*display:grid[^}]*grid-template-rows:var\(--desktop-chrome-height\) minmax\(0,1fr\)/)
    expect(styles).toMatch(/\.desktop-shell[^}]*overscroll-behavior:none/)
    expect(styles).toMatch(/\.desktop-shell__body[^}]*min-height:0[^}]*overflow:hidden/)
    expect(styles).toMatch(/\.desktop-shell__content[^}]*overflow:hidden[^}]*overscroll-behavior:none/)
    expect(styles).toMatch(/\.desktop-page--scroll-page[^}]*overscroll-behavior:contain/)
    expect(styles).toContain('--desktop-page-padding-y: 24px')
    expect(styles).toContain('--desktop-page-padding-x: 30px')
    expect(styles).toMatch(/\.desktop-page--scroll-page\s*\{[^}]*padding:\s*var\(--desktop-page-padding-y\)\s*var\(--desktop-page-padding-x\)/)
    expect(styles).toMatch(/\.desktop-page--scroll-contained\s*\{[^}]*padding:\s*var\(--desktop-page-padding-y\)\s*var\(--desktop-page-padding-x\)/)
    expect(styles).not.toMatch(/@media[^}]*--desktop-page-padding-[xy]/)
    expect(styles).not.toMatch(/\.desktop-page--scroll-page\s*\{[^}]*padding:\s*\d/)
    expect(styles).not.toMatch(/\.desktop-page--scroll-contained\s*\{[^}]*padding:\s*\d/)
    expect(styles).not.toMatch(/\.desktop-shell__body[^}]*calc\(100% - var\(--desktop-chrome-height\)\)/)
    expect(styles).toContain('--desktop-chrome-background: var(--background)')
    expect(styles).toContain('--desktop-chrome-control-background: var(--card)')
    expect(styles).toMatch(/@media\(max-width:720px\)[\s\S]*\.desktop-navigation__group\{display:contents\}/)
    expect(styles).toMatch(/@media\(max-width:720px\)[\s\S]*\.desktop-navigation__group-label\{position:absolute;width:1px/)
    expect(styles).not.toMatch(/(?:height|min-height):52px|calc\(100% - 52px\)/)

    const tokens = JSON.parse(await readFile(resolve(process.cwd(), 'packages/design-system/product-tokens.json'), 'utf8')).product
    expect(tokens.amove).not.toHaveProperty('light')
    expect(tokens.vox.light.color).not.toHaveProperty('canvas')
    expect(tokens.exithibition.light.color).not.toHaveProperty('surface')
    expect(tokens.bonded.light.color).not.toHaveProperty('background')
  })

  it('owns the unified Orbis page margin across every app stylesheet', async () => {
    const read = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')
    const hub = await read('src/renderer/shell/styles.css')
    const amove = await read('apps/integrated/Amove/src/renderer/main/main.css')
    const exithibition = await read('apps/standalone/Exithibition/src/renderer/styles.css')
    const bonded = await read('apps/integrated/Bonded/src/renderer/styles.css')
    const orbis = await read('apps/standalone/Orbis/src/renderer/styles.css')

    // Each app's exact page selector must leave the frame margin to the shell's
    // DesktopPage rules; anchored \s*\{ keeps sibling rules (e.g.
    // .amove-feature-panel__page button{…}, .exithibition-feature-panel__page > [data-slot="alert"]{…})
    // from false-positive matches.
    expect(hub).not.toMatch(/\.controller-main\s*\{[^}]*padding/)
    expect(orbis).not.toMatch(/\.orbis-feature-panel__page\s*\{[^}]*padding/)
    expect(amove).not.toMatch(/\.amove-feature-panel__page\s*\{[^}]*padding/)
    expect(amove).not.toMatch(/\.amove-feature-panel__settings-page\s*\{[^}]*padding/)
    expect(exithibition).not.toMatch(/\.exithibition-feature-panel__page\s*\{[^}]*padding/)
    expect(bonded).not.toMatch(/\.bonded-feature-panel \.content\s*\{[^}]*padding/)

    // Bonded's absolutely positioned banner must track the shared responsive margin.
    expect(bonded).toMatch(/\.bonded-feature-panel \.error-banner\s*\{[^}]*left:\s*var\(--desktop-page-padding-x\)/)
    expect(bonded).toMatch(/\.bonded-feature-panel \.error-banner\s*\{[^}]*right:\s*var\(--desktop-page-padding-x\)/)
  })
})
