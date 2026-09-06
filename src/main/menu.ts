import { Menu, type BrowserWindow } from 'electron'
import { sendToRenderer } from '@moirasia/desktop-shell/main'
import { applicationCatalog } from '@moirasia/desktop-shell'
import { IPC, type ApplicationId, type ControllerPage } from '../shared/contracts'
export function installApplicationMenu(window: BrowserWindow, open: (id: ApplicationId) => void, reportPage: (page: ControllerPage) => void = () => undefined): void {
  const navigate = (page: ControllerPage) => { reportPage(page); sendToRenderer(window.webContents, IPC.navigate, page) }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Moirasia', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => navigate('general') }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [{ label: 'Features', click: () => navigate('features') }, { type: 'separator' }, { role: 'close' }] },
    { label: 'Applications', submenu: applicationCatalog.entries.map((entry, index) => ({ label: entry.label, accelerator: `CommandOrControl+${index + 1}`, click: () => open(entry.id) })) },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] }
  ]))
}
