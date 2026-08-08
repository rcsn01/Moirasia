import React, { useEffect, useState } from 'react'
import { APPEARANCES, type Appearance, type AppearanceApi } from './index'

export function DesktopAppFrame({ children, appBar }: { readonly children: React.ReactNode; readonly appBar: React.ReactNode }): React.JSX.Element {
  return <div className="desktop-app-frame"><div className="desktop-app-bar">{appBar}</div><div className="desktop-app-content">{children}</div></div>
}

export function DesktopPageHeader({ product, title, subtitle, actions }: { readonly product: string; readonly title?: string; readonly subtitle?: string; readonly actions?: React.ReactNode }): React.JSX.Element {
  const macos = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent)
  return <header className={`desktop-page-header ${macos ? 'macos' : ''}`}><div className="desktop-page-identity"><span>{product}</span>{title && <strong>{title}</strong>}{subtitle && <small>{subtitle}</small>}</div>{actions && <div className="desktop-page-actions">{actions}</div>}</header>
}

export function AppearanceControl({ value, onChange, label = 'Appearance', mixed = false }: { readonly value: Appearance; readonly onChange: (value: Appearance) => void; readonly label?: string; readonly mixed?: boolean }): React.JSX.Element {
  return <label className="appearance-control"><span className="sr-only">{label}</span><select aria-label={label} value={mixed ? 'mixed' : value} onChange={(event) => { if (event.target.value !== 'mixed') onChange(event.target.value as Appearance) }}>{mixed && <option value="mixed">Mixed</option>}{APPEARANCES.map((item) => <option key={item} value={item}>{item[0]!.toUpperCase() + item.slice(1)}</option>)}</select></label>
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
