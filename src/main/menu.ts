import { Menu } from 'electron'
import { applicationCatalog } from '@moirasia/desktop-shell'
import type { ApplicationId, ControllerPage } from '../shared/contracts'
export function installApplicationMenu(openApplication: (id: ApplicationId) => void, navigate: (page: ControllerPage) => void): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Moirasia', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => navigate('general') }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [{ label: 'Features', click: () => navigate('features') }, { type: 'separator' }, { role: 'close' }] },
    { label: 'Applications', submenu: applicationCatalog.entries.map((entry, index) => ({ label: entry.label, accelerator: `CommandOrControl+${index + 1}`, click: () => openApplication(entry.id) })) },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] }
  ]))
}
