import { Menu, type BrowserWindow } from 'electron'
import { APPLICATION_IDS, IPC, type ApplicationId, type ControllerPage } from '../shared/contracts'
export function installApplicationMenu(window: BrowserWindow, open: (id: ApplicationId) => void): void {
  const navigate = (page: ControllerPage) => window.webContents.send(IPC.navigate, page)
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Moirasia', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => navigate('settings') }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [{ label: 'Applications', click: () => navigate('apps') }, { type: 'separator' }, { role: 'close' }] },
    { label: 'Applications', submenu: APPLICATION_IDS.map((id, index) => ({ label: id === 'exithibition' ? 'Exithibition' : id[0]!.toUpperCase() + id.slice(1), accelerator: `CommandOrControl+${index + 1}`, click: () => open(id) })) },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] }
  ]))
}
