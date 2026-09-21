import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { AppUpdater, githubUpdaterChannels, type AppUpdaterHost, type GitHubReleaseFeed, type UpdateState } from './app-updater'

export function createElectronAppUpdaterHost(): AppUpdaterHost {
  return {
    currentVersion: () => app.getVersion(),
    fetch: async (url, init) => {
      const response = await fetch(url, init)
      return { ok: response.ok, status: response.status, text: () => response.text() }
    },
    openExternal: (url) => shell.openExternal(url)
  }
}

export function createGitHubAppUpdater(feed: GitHubReleaseFeed): AppUpdater {
  return new AppUpdater(createElectronAppUpdaterHost(), feed)
}

export function registerGitHubUpdaterIpc(options: {
  prefix: string
  updater: AppUpdater
  authorize: (event: IpcMainInvokeEvent) => void
  sendState: (state: UpdateState) => void
}): () => void {
  const channels = githubUpdaterChannels(options.prefix)
  const registered: string[] = []
  const handle = (channel: string, listener: (event: IpcMainInvokeEvent) => unknown): void => {
    ipcMain.handle(channel, listener)
    registered.push(channel)
  }
  try {
    handle(channels.getState, (event) => { options.authorize(event); return options.updater.state() })
    handle(channels.check, (event) => { options.authorize(event); return options.updater.check() })
    handle(channels.openRelease, (event) => { options.authorize(event); return options.updater.openRelease() })
  } catch (error) {
    for (const channel of registered) ipcMain.removeHandler(channel)
    throw error
  }
  const unsubscribe = options.updater.subscribe((state) => options.sendState(state))
  return () => {
    unsubscribe()
    for (const channel of registered) ipcMain.removeHandler(channel)
  }
}
