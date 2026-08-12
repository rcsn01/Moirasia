import { AlertCircle } from '@moirasia/ui-react/lib/icons'
import { Alert, AlertDescription, AlertTitle } from '@moirasia/ui-react/components/alert'
import { AppWindow, Settings } from '@moirasia/ui-react/lib/icons'
import { DesktopAppShell, DesktopNavigation, DesktopPage } from '@moirasia/desktop-shell/react'
import { AppsScreen } from './screens/home'
import { SettingsScreen } from './screens/settings'
import { useController } from './controller'

export function App(): React.JSX.Element {
  const controller = useController()
  const appearance = controller.snapshot.appearances.values.moirasia
  const navigation = <DesktopNavigation label="Moirasia sections" active={controller.page} onSelect={controller.setPage} items={[{ id: 'apps', label: 'Apps', icon: <AppWindow aria-hidden="true" /> }, { id: 'settings', label: 'Settings', icon: <Settings aria-hidden="true" /> }]}/>
  return <DesktopAppShell product="Moirasia" appearance={appearance} onAppearanceChange={(value) => controller.setAppearance('moirasia', value)} navigation={navigation}>
    <DesktopPage width="standard" className="controller-main">{controller.loading ? <p role="status">Loading applications…</p> : controller.page === 'apps' ? <AppsScreen controller={controller} /> : <SettingsScreen controller={controller} />}</DesktopPage>
    {controller.error && <Alert variant="destructive" className="controller-error"><AlertCircle/><AlertTitle>Action failed</AlertTitle><AlertDescription>{controller.error}</AlertDescription></Alert>}
  </DesktopAppShell>
}
