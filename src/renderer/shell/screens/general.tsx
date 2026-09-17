import { RadioGroup, RadioGroupItem } from '@moirasia/ui-react/components/radio-group'
import type { AppPresenceMode } from '../../../shared/contracts'

export function GeneralScreen({ appPresence, onAppPresenceChange }: { appPresence: AppPresenceMode; onAppPresenceChange(mode: AppPresenceMode): void }): React.JSX.Element {
  const options: ReadonlyArray<{ mode: AppPresenceMode; title: string; detail: string }> = [
    { mode: 'menu-bar', title: 'Menu Bar', detail: 'Keep Moirasia available from the menu bar and hide its Dock icon.' },
    { mode: 'dock', title: 'Dock Icon', detail: 'Show Moirasia in the Dock.' }
  ]

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
  </section>
}
