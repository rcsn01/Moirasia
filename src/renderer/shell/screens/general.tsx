import { RadioGroup, RadioGroupItem } from '@moirasia/ui-react/components/radio-group'
import { Button } from '@moirasia/ui-react/components/button'
import { Progress } from '@moirasia/ui-react/components/progress'
import type { AppPresenceMode, UpdateState } from '../../../shared/contracts'

export function GeneralScreen({ appPresence, onAppPresenceChange, update, onCheckForUpdate, onDownloadUpdate, onOpenRelease }: {
  appPresence: AppPresenceMode
  onAppPresenceChange(mode: AppPresenceMode): void
  update: UpdateState
  onCheckForUpdate(): void
  onDownloadUpdate(): void
  onOpenRelease(): void
}): React.JSX.Element {
  const options: ReadonlyArray<{ mode: AppPresenceMode; title: string; detail: string }> = [
    { mode: 'menu-bar', title: 'Menu Bar', detail: 'Keep Moirasia available from the menu bar and hide its Dock icon.' },
    { mode: 'dock', title: 'Dock Icon', detail: 'Show Moirasia in the Dock.' }
  ]
  const busy = update.status === 'checking' || update.status === 'downloading'

  return <section className="controller-page" aria-labelledby="general-heading">
    <p className="eyebrow">ESSENTIALS</p>
    <h1 id="general-heading">General</h1>
    <p className="lede">Choose how Moirasia appears on your Mac.</p>

    <section className="general-settings-section" aria-labelledby="app-presence-heading">
      <div className="general-settings-heading">
        <h2 id="app-presence-heading">App Presence</h2>
        <p>Choose where Moirasia stays available when its window is closed.</p>
      </div>
      <RadioGroup className="general-presence-group" aria-label="App presence" value={appPresence} onValueChange={(mode) => onAppPresenceChange(mode as AppPresenceMode)}>
        {options.map(({ mode, title, detail }) => <div className="general-presence-option" data-selected={appPresence === mode} key={mode} onClick={(event) => { if (!(event.target as Element).closest('input')) onAppPresenceChange(mode) }}>
          <RadioGroupItem value={mode} aria-label={title} />
          <span className="general-presence-copy" aria-hidden="true">
            <span className="general-presence-title">{title}</span>
            <span className="general-presence-detail">{detail}</span>
          </span>
        </div>)}
      </RadioGroup>
    </section>

    <section className="general-settings-section" aria-labelledby="updates-heading">
      <div className="general-settings-heading">
        <h2 id="updates-heading">Updates</h2>
        <p>{update.currentVersion ? `Current version ${update.currentVersion}. ` : ''}Check GitHub Releases for a newer installer.</p>
      </div>
      <div className="general-updates-body">
        {update.status !== 'error' && <p className="general-updates-status" role="status">{statusCopy(update)}</p>}
        {update.status === 'available' && <p className="general-updates-note">After installing, reopen Moirasia. Shout Mic or Bonded's firewall helper may ask to be reinstalled if those binaries changed.</p>}
        {update.status === 'available' && !update.canDownload && <p className="general-updates-note">Download the installer from a packaged Moirasia release, or open the release page.</p>}
        {update.notes && update.status === 'available' && <p className="general-updates-notes">{update.notes}</p>}
        {update.status === 'downloading' && <Progress value={Math.round((update.progress ?? 0) * 100)} aria-label="Download progress" />}
        {update.status === 'error' && update.error && <p className="general-updates-error" role="alert">{update.error}</p>}
        <div className="general-updates-actions">
          <Button size="sm" disabled={busy} onClick={onCheckForUpdate}>{update.status === 'checking' ? 'Checking…' : 'Check for Updates'}</Button>
          {update.canDownload && <Button size="sm" disabled={busy} onClick={onDownloadUpdate}>Download Installer</Button>}
          {update.releaseUrl && <Button size="sm" variant="outline" disabled={busy} onClick={onOpenRelease}>View Release</Button>}
        </div>
      </div>
    </section>
  </section>
}

function statusCopy(update: UpdateState): string {
  if (update.status === 'checking') return 'Checking GitHub Releases…'
  if (update.status === 'up-to-date') return "You're up to date."
  if (update.status === 'available' && update.latestVersion) return `Version ${update.latestVersion} is available.`
  if (update.status === 'downloading') return 'Downloading the installer…'
  if (update.status === 'ready') return 'Opened the installer. Drag Moirasia into Applications, then reopen it.'
  return 'No check has run yet.'
}
