import { Menu, type BrowserWindow } from 'electron'
import { IPC, MODULE_IDS, type ModuleId, type ShellPage } from '../shared/contracts'
import type { ModuleManager } from './modules/manager'

export function installApplicationMenu(
  window: BrowserWindow,
  manager: ModuleManager,
  requestShutdown: () => void,
  persistSelection?: (selection: ShellPage | ModuleId) => Promise<void>
): void {
  const navigatePage = (page: ShellPage): void => {
    void manager.hideActive().then(async () => {
      await persistSelection?.(page)
      window.webContents.send(IPC.navigate, page)
    }).catch((error: unknown) => console.error('Could not navigate', error))
  }
  const activate = (id: ModuleId): void => {
    void manager.activate(id).then(async () => {
      await persistSelection?.(id)
      window.webContents.send(IPC.navigate, id)
    }).catch((error: unknown) => console.error(`Could not activate ${id}`, error))
  }

  const menu = Menu.buildFromTemplate([
    {
      label: 'Moirasia',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CommandOrControl+,',
          click: () => navigatePage('settings')
        },
        { type: 'separator' },
        { label: 'Quit Moirasia', accelerator: 'CommandOrControl+Q', click: requestShutdown }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'Home', click: () => navigatePage('home') },
        { type: 'separator' },
        { role: 'close', accelerator: 'CommandOrControl+W' }
      ]
    },
    {
      label: 'Modules',
      submenu: MODULE_IDS.map((id, index) => ({
        label: id[0]!.toUpperCase() + id.slice(1),
        accelerator: `CommandOrControl+${index + 1}`,
        click: () => activate(id)
      }))
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    }
  ])
  Menu.setApplicationMenu(menu)
}
