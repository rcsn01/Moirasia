import { AppWindow, ShieldCheck } from '@moirasia/ui-react/lib/icons'
import type { FeatureIconKey } from '@moirasia/desktop-shell/feature'

/** Renderer-owned adapter from catalog icon keys to the shared icon set. React stays out of the catalog. */
export const FEATURE_ICONS: Record<FeatureIconKey, React.JSX.Element> = {
  'app-window': <AppWindow aria-hidden="true" />,
  'shield-check': <ShieldCheck aria-hidden="true" />
}