import { AlertCircle } from '@moirasia/ui-react/lib/icons'
import { Alert, AlertDescription, AlertTitle } from '@moirasia/ui-react/components/alert'
import { Button } from '@moirasia/ui-react/components/button'
import { DesktopAppFrame, DesktopPageHeader } from '@moirasia/desktop-shell/react'
import { AppsScreen } from './screens/home'
import { SettingsScreen } from './screens/settings'
import { useController } from './controller'

export function App(): React.JSX.Element {
  const controller = useController()
  return <DesktopAppFrame appBar={<DesktopPageHeader product="Moirasia" title={controller.page === 'apps' ? 'Applications' : 'Settings'} actions={<nav><Button size="sm" variant={controller.page === 'apps' ? 'secondary' : 'ghost'} onClick={() => controller.setPage('apps')}>Apps</Button><Button size="sm" variant={controller.page === 'settings' ? 'secondary' : 'ghost'} onClick={() => controller.setPage('settings')}>Settings</Button></nav>} />}>
    <main className="controller-main">{controller.loading ? <p role="status">Loading applications…</p> : controller.page === 'apps' ? <AppsScreen controller={controller} /> : <SettingsScreen controller={controller} />}</main>
    {controller.error && <Alert variant="destructive" className="controller-error"><AlertCircle/><AlertTitle>Action failed</AlertTitle><AlertDescription>{controller.error}</AlertDescription></Alert>}
  </DesktopAppFrame>
}
