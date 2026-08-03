import type { ShellAppearance } from '../../shared/contracts'

export type ResolvedTheme = 'light' | 'dark'

export function resolveTheme(appearance: ShellAppearance, systemDark: boolean): ResolvedTheme {
  return appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance
}

export function applyTheme(appearance: ShellAppearance, systemDark: boolean, root: HTMLElement = document.documentElement): ResolvedTheme {
  const resolved = resolveTheme(appearance, systemDark)
  root.classList.toggle('dark', resolved === 'dark')
  root.classList.toggle('light', resolved === 'light')
  root.style.colorScheme = resolved
  return resolved
}

export const systemThemeQuery = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)')

// Electron's nativeTheme.themeSource controls this media query before the page is shown.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const media = systemThemeQuery()
  applyTheme('system', media.matches)
}
