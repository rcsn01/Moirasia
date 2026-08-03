import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@moirasia/ui-react/components/card'
import { Label } from '@moirasia/ui-react/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@moirasia/ui-react/components/select'
import { Separator } from '@moirasia/ui-react/components/separator'
import { Switch } from '@moirasia/ui-react/components/switch'
import type { ShellAppearance } from '../../../shared/contracts'
import type { ShellController } from '../controller'

interface SettingRowProps {
  readonly label: string
  readonly description: string
  readonly control: React.ReactNode
}

function SettingRow({ label, description, control }: SettingRowProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div className="space-y-1"><p className="text-sm font-medium">{label}</p><p className="text-sm text-muted-foreground">{description}</p></div>
      {control}
    </div>
  )
}

export function SettingsScreen({ controller }: { readonly controller: ShellController }): React.JSX.Element {
  const { settings, snapshot } = controller
  return (
    <section className="w-full max-w-3xl" aria-labelledby="settings-heading">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Preferences</p>
      <h1 id="settings-heading" className="text-4xl font-semibold tracking-tight">Settings</h1>
      <Card className="mt-8 gap-0">
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Control how Moirasia looks and starts.</CardDescription>
        </CardHeader>
        <CardContent className="mt-2">
          <SettingRow label="Appearance" description="Use the system theme or choose one explicitly." control={
            <Select value={settings.appearance} onValueChange={(value) => { if (value) void controller.updateSettings({ appearance: value as ShellAppearance }) }}>
              <SelectTrigger aria-label="Appearance"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="system">System</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem></SelectContent>
            </Select>
          } />
          <Separator />
          <SettingRow label="Launch at login" description="Open Moirasia after you sign in." control={
            <Switch aria-label="Launch at login" checked={settings.launchAtLogin} onCheckedChange={(checked) => void controller.updateSettings({ launchAtLogin: checked })} />
          } />
          <Separator />
          <SettingRow label="Restore last selection" description="Return to the most recently selected module or page." control={
            <Switch aria-label="Restore last selected module or page" checked={settings.restoreLastSelection} onCheckedChange={(checked) => void controller.updateSettings({ restoreLastSelection: checked })} />
          } />
        </CardContent>
      </Card>
      <Card className="mt-4 gap-0">
        <CardHeader><CardTitle>Start with Moirasia</CardTitle><CardDescription>Choose modules to start automatically.</CardDescription></CardHeader>
        <CardContent className="mt-2">
          {snapshot.modules.map((module, index) => (
            <div key={module.id}>
              {index > 0 && <Separator />}
              <SettingRow label={module.label} description={`Start ${module.label} when the shell opens.`} control={
                <Switch aria-label={`Start ${module.label} with Moirasia`} checked={settings.autoStart[module.id]} onCheckedChange={(checked) => void controller.updateSettings({ autoStart: { [module.id]: checked } })} />
              } />
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}
