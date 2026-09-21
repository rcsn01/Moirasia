import React, { useCallback, useEffect, useState } from 'react'
import { APPEARANCES, type Appearance, type AppearanceApi } from './index'
import { idleUpdateState, type GitHubUpdatesApi, type UpdateState } from './app-updater'

export interface DesktopNavigationItem<Id extends string = string> {
  readonly id: Id
  readonly label: string
  readonly icon?: React.ReactNode
  readonly badge?: React.ReactNode
}

export interface DesktopNavigationGroup<Id extends string = string> {
  readonly id: string
  readonly label: string
  readonly items: readonly DesktopNavigationItem<Id>[]
}

type DesktopNavigationProps<Id extends string> = {
  readonly label: string
  readonly active: Id
  readonly onSelect: (id: Id) => void
} & (
  | { readonly items: readonly DesktopNavigationItem<Id>[]; readonly groups?: never }
  | { readonly groups: readonly DesktopNavigationGroup<Id>[]; readonly items?: never }
)

/**
 * Owns the full viewport of a primary BrowserWindow, including product chrome.
 * Do not nest this shell inside an embedded feature panel.
 */
export function DesktopAppShell({ product, appearance, onAppearanceChange, navigation, footer, children }: {
  readonly product: string
  readonly appearance: Appearance
  readonly onAppearanceChange: (appearance: Appearance) => void
  readonly navigation?: React.ReactNode
  readonly footer?: React.ReactNode
  readonly children: React.ReactNode
}): React.JSX.Element {
  const macos = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent)
  return <div className="desktop-shell">
    <header className={`desktop-shell__chrome ${macos ? 'desktop-shell__chrome--macos' : ''}`}>
      <strong className="desktop-shell__product">{product}</strong>
      <AppearanceToggle value={appearance} onChange={onAppearanceChange} />
    </header>
    <div className={`desktop-shell__body ${navigation ? 'desktop-shell__body--navigation' : ''}`}>
      {navigation && <aside className="desktop-shell__navigation-region">{navigation}{footer && <div className="desktop-shell__navigation-footer">{footer}</div>}</aside>}
      <div className="desktop-shell__content">{children}</div>
    </div>
  </div>
}

export function DesktopNavigation<Id extends string>(props: DesktopNavigationProps<Id>): React.JSX.Element {
  const { label, active, onSelect } = props
  const navigationId = React.useId()
  const groups = props.groups
  const orderedItems = groups?.flatMap((group) => group.items) ?? props.items ?? []
  const renderItem = (item: DesktopNavigationItem<Id>, index: number): React.JSX.Element => <button key={item.id} type="button" className="desktop-navigation__item" data-active={active === item.id || undefined} aria-current={active === item.id ? 'page' : undefined} onClick={() => onSelect(item.id)} onKeyDown={(event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? orderedItems.length - 1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % orderedItems.length : (index - 1 + orderedItems.length) % orderedItems.length
    const next = orderedItems[nextIndex]
    if (!next) return
    onSelect(next.id)
    const buttons = event.currentTarget.closest('.desktop-navigation')?.querySelectorAll<HTMLButtonElement>('.desktop-navigation__item')
    buttons?.[nextIndex]?.focus()
  }}>
    {item.icon}<span>{item.label}</span>{item.badge != null && <span className="desktop-navigation__badge">{item.badge}</span>}
  </button>

  if (!groups) return <nav className="desktop-navigation" aria-label={label}>{orderedItems.map(renderItem)}</nav>

  let itemIndex = 0
  return <nav className="desktop-navigation" aria-label={label}>{groups.map((group) => {
    const groupLabelId = `${navigationId}-${group.id}`
    return <div key={group.id} className="desktop-navigation__group" role="group" aria-labelledby={groupLabelId}>
      <span id={groupLabelId} className="desktop-navigation__group-label">{group.label}</span>
      {group.items.map((item) => renderItem(item, itemIndex++))}
    </div>
  })}</nav>
}

export function DesktopPage({ width = 'standard', scroll = 'page', className = '', children }: {
  readonly width?: 'compact' | 'standard' | 'wide' | 'full'
  readonly scroll?: 'page' | 'contained'
  readonly className?: string
  readonly children: React.ReactNode
}): React.JSX.Element {
  return <main className={`desktop-page desktop-page--${width} desktop-page--scroll-${scroll} ${className}`.trim()}>{children}</main>
}

export function DesktopContentHeader({ title, description, status, actions }: {
  readonly title: string
  readonly description?: React.ReactNode
  readonly status?: React.ReactNode
  readonly actions?: React.ReactNode
}): React.JSX.Element {
  return <header className="desktop-content-header"><div className="desktop-content-header__copy"><div className="desktop-content-header__title-row"><h1>{title}</h1>{status}</div>{description && <p>{description}</p>}</div>{actions && <div className="desktop-content-header__actions">{actions}</div>}</header>
}

/** @deprecated Use DesktopAppShell. */
export function DesktopAppFrame({ children, appBar }: { readonly children: React.ReactNode; readonly appBar: React.ReactNode }): React.JSX.Element {
  return <div className="desktop-app-frame"><div className="desktop-app-bar">{appBar}</div><div className="desktop-app-content">{children}</div></div>
}

/** @deprecated Use DesktopContentHeader. */
export function DesktopPageHeader({ product, title, subtitle, actions }: { readonly product: string; readonly title?: string; readonly subtitle?: string; readonly actions?: React.ReactNode }): React.JSX.Element {
  const macos = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent)
  return <header className={`desktop-page-header ${macos ? 'macos' : ''}`}><div className="desktop-page-identity"><span>{product}</span>{title && <strong>{title}</strong>}{subtitle && <small>{subtitle}</small>}</div>{actions && <div className="desktop-page-actions">{actions}</div>}</header>
}

export function AppearanceControl({ value, onChange, label = 'Appearance', mixed = false }: { readonly value: Appearance; readonly onChange: (value: Appearance) => void; readonly label?: string; readonly mixed?: boolean }): React.JSX.Element {
  return <label className="desktop-appearance-control"><span className="desktop-shell__sr-only">{label}</span><select aria-label={label} value={mixed ? 'mixed' : value} onChange={(event) => { if (event.target.value !== 'mixed') onChange(event.target.value as Appearance) }}>{mixed && <option value="mixed">Mixed</option>}{APPEARANCES.map((item) => <option key={item} value={item}>{item[0]!.toUpperCase() + item.slice(1)}</option>)}</select></label>
}

export function AppearanceToggle({ value, onChange }: { readonly value: Appearance; readonly onChange: (value: Appearance) => void }): React.JSX.Element {
  const [systemDark, setSystemDark] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const dark = value === 'dark' || (value === 'system' && systemDark)
  const next: Appearance = dark ? 'light' : 'dark'
  const label = `Switch to ${next} appearance`
  return <button className="desktop-appearance-toggle" type="button" aria-label={label} title={label} data-effective-appearance={dark ? 'dark' : 'light'} onClick={() => onChange(next)}>
    {dark
      ? <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></svg>
      : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.35 15.35A9 9 0 0 1 8.65 3.65a9 9 0 1 0 11.7 11.7Z"/></svg>}
  </button>
}

export function resolveEffectiveAppearance(appearance: Appearance, systemDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches): 'light' | 'dark' {
  return appearance === 'dark' || (appearance === 'system' && systemDark) ? 'dark' : 'light'
}

/**
 * Apply a product appearance to a local subtree. Unlike useProductAppearance,
 * this never touches document.documentElement, which lets embedded products
 * coexist with the shell and with one another.
 */
export function AppearanceScope({ appearance, className = '', children }: {
  readonly appearance: Appearance
  readonly className?: string
  readonly children: React.ReactNode
}): React.JSX.Element {
  const [systemDark, setSystemDark] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const effective = resolveEffectiveAppearance(appearance, systemDark)
  return <div className={`appearance-scope ${effective} ${className}`.trim()} data-appearance={appearance} data-effective-appearance={effective} style={{ colorScheme: effective }}>{children}</div>
}

export function applyDocumentAppearance(appearance: Appearance, systemDark = matchMedia('(prefers-color-scheme: dark)').matches): void {
  const dark = appearance === 'dark' || (appearance === 'system' && systemDark)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.dataset.appearance = appearance
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

export function useGitHubUpdates(api: GitHubUpdatesApi | undefined): {
  readonly state: UpdateState
  check(): void
  openRelease(): void
} {
  const [state, setState] = useState<UpdateState>(() => idleUpdateState())
  useEffect(() => {
    if (!api) return
    let active = true
    void api.getUpdateState().then((value) => { if (active) setState(value) })
    const unsubscribe = api.onUpdateState((value) => { if (active) setState(value) })
    return () => { active = false; unsubscribe() }
  }, [api])
  const check = useCallback((): void => { if (api) void api.checkForUpdate().then(setState) }, [api])
  const openRelease = useCallback((): void => { if (api) void api.openReleasePage() }, [api])
  return { state, check, openRelease }
}

export function GitHubUpdatesPanel({ product, state, onCheck, onOpenRelease, availableNote, variant = 'card' }: {
  readonly product: string
  readonly state: UpdateState
  readonly onCheck: () => void
  readonly onOpenRelease: () => void
  readonly availableNote?: string | undefined
  readonly variant?: 'card' | 'flush' | undefined
}): React.JSX.Element {
  const headingId = `${product.replace(/\s+/g, '-').toLowerCase()}-updates-heading`
  const busy = state.status === 'checking'
  return <section className={`desktop-updates desktop-updates--${variant}`} aria-labelledby={headingId}>
    <div className="desktop-updates__heading">
      <h2 id={headingId}>Updates</h2>
      <p>{state.currentVersion ? `Current version ${state.currentVersion}. ` : ''}Check GitHub Releases for a newer build.</p>
    </div>
    <div className="desktop-updates__body">
      {state.status !== 'error' && <p className="desktop-updates__status" role="status">{statusCopy(state)}</p>}
      {state.status === 'available' && availableNote && <p className="desktop-updates__note">{availableNote}</p>}
      {state.status === 'available' && !availableNote && <p className="desktop-updates__note">Open the GitHub release to download the DMG. After installing, reopen {product}.</p>}
      {state.notes && state.status === 'available' && <p className="desktop-updates__notes">{state.notes}</p>}
      {state.status === 'available' && state.releaseUrl && <a className="desktop-updates__link" href={state.releaseUrl} onClick={(event) => { event.preventDefault(); onOpenRelease() }}>{state.releaseUrl}</a>}
      {state.status === 'error' && state.error && <p className="desktop-updates__error" role="alert">{state.error}</p>}
      {state.status !== 'available' && <div className="desktop-updates__actions">
        <button type="button" className="desktop-updates__button" disabled={busy} onClick={onCheck}>{state.status === 'checking' ? 'Checking…' : 'Check for Updates'}</button>
      </div>}
    </div>
  </section>
}

export function StandaloneGitHubUpdates({ product, api, availableNote, variant = 'card' }: {
  readonly product: string
  readonly api: GitHubUpdatesApi | undefined
  readonly availableNote?: string | undefined
  readonly variant?: 'card' | 'flush' | undefined
}): React.JSX.Element | null {
  const updates = useGitHubUpdates(api)
  if (!api) return null
  return <GitHubUpdatesPanel product={product} state={updates.state} onCheck={updates.check} onOpenRelease={updates.openRelease} availableNote={availableNote} variant={variant} />
}

function statusCopy(update: UpdateState): string {
  if (update.status === 'checking') return 'Checking GitHub Releases…'
  if (update.status === 'up-to-date') return "You're up to date."
  if (update.status === 'available' && update.latestVersion) return `Version ${update.latestVersion} is available.`
  return 'No check has run yet.'
}

export function useProductAppearance(api: AppearanceApi | undefined): readonly [Appearance, (appearance: Appearance) => void] {
  const [appearance, setAppearanceState] = useState<Appearance>('system')
  useEffect(() => { if (!api) return; let active = true; void api.getAppearance().then((value) => active && setAppearanceState(value)); const unsubscribe = api.onAppearance((value) => active && setAppearanceState(value)); return () => { active = false; unsubscribe() } }, [api])
  useEffect(() => { if (typeof matchMedia !== 'function') { applyDocumentAppearance(appearance, false); return }; const media = matchMedia('(prefers-color-scheme: dark)'); const apply = () => applyDocumentAppearance(appearance, media.matches); apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply) }, [appearance])
  return [appearance, (value) => { if (api) void api.setAppearance(value).then(setAppearanceState); else setAppearanceState(value) }] as const
}
