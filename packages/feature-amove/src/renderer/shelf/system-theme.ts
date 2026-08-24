export function installSystemTheme(): void {
  const media = window.matchMedia("(prefers-color-scheme: dark)")
  const apply = (): void => { document.documentElement.classList.toggle("dark", media.matches) }
  apply()
  media.addEventListener("change", apply)
}
