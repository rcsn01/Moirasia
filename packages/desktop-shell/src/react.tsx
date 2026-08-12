import React, { useEffect, useState } from 'react'
import { APPEARANCES, type Appearance, type AppearanceApi } from './index'

export interface DesktopNavigationItem<Id extends string = string> {
  readonly id: Id
  readonly label: string
  readonly icon?: React.ReactNode
  readonly badge?: React.ReactNode
}

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
      <AppearanceControl value={appearance} onChange={onAppearanceChange} />
    </header>
    <div className={`desktop-shell__body ${navigation ? 'desktop-shell__body--navigation' : ''}`}>
      {navigation && <aside className="desktop-shell__navigation-region">{navigation}{footer && <div className="desktop-shell__navigation-footer">{footer}</div>}</aside>}
      <div className="desktop-shell__content">{children}</div>
    </div>
  </div>
}

export function DesktopNavigation<Id extends string>({ label, items, active, onSelect }: {
  readonly label: string
  readonly items: readonly DesktopNavigationItem<Id>[]
  readonly active: Id
  readonly onSelect: (id: Id) => void
}): React.JSX.Element {
  return <nav className="desktop-navigation" aria-label={label}>{items.map((item, index) => {
    return <button key={item.id} type="button" className="desktop-navigation__item" data-active={active === item.id || undefined} aria-current={active === item.id ? 'page' : undefined} onClick={() => onSelect(item.id)} onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length
      const next = items[nextIndex]
      if (!next) return
      onSelect(next.id)
      const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('.desktop-navigation__item')
      buttons?.[nextIndex]?.focus()
    }}>
      {item.icon}<span>{item.label}</span>{item.badge != null && <span className="desktop-navigation__badge">{item.badge}</span>}
    </button>
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

export function applyDocumentAppearance(appearance: Appearance, systemDark = matchMedia('(prefers-color-scheme: dark)').matches): void {
  const dark = appearance === 'dark' || (appearance === 'system' && systemDark)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.dataset.appearance = appearance
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

export function useProductAppearance(api: AppearanceApi | undefined): readonly [Appearance, (appearance: Appearance) => void] {
  const [appearance, setAppearanceState] = useState<Appearance>('system')
  useEffect(() => { if (!api) return; let active = true; void api.getAppearance().then((value) => active && setAppearanceState(value)); const unsubscribe = api.onAppearance((value) => active && setAppearanceState(value)); return () => { active = false; unsubscribe() } }, [api])
  useEffect(() => { if (typeof matchMedia !== 'function') { applyDocumentAppearance(appearance, false); return }; const media = matchMedia('(prefers-color-scheme: dark)'); const apply = () => applyDocumentAppearance(appearance, media.matches); apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply) }, [appearance])
  return [appearance, (value) => { if (api) void api.setAppearance(value).then(setAppearanceState); else setAppearanceState(value) }] as const
}
