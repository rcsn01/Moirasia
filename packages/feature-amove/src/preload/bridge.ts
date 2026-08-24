import type { MainBridge, MainState, PresenceMode, ShortcutBinding, WindowActionId } from '../shared/contracts'

export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
}

const IPC = {
  mainGetState: 'amove:main:get-state', mainStateChanged: 'amove:main:state-changed',
  mainPerformAction: 'amove:main:perform-action', mainRecordShortcut: 'amove:main:record-shortcut',
  mainSetShortcutRecording: 'amove:main:set-shortcut-recording', mainResetShortcut: 'amove:main:reset-shortcut',
  mainSetPresence: 'amove:main:set-presence', mainRefreshAccessibility: 'amove:main:refresh-accessibility',
  mainRequestAccessibility: 'amove:main:request-accessibility', mainOpenAccessibilitySettings: 'amove:main:open-accessibility-settings',
  mainShowShelf: 'amove:main:show-shelf', mainCancelShelf: 'amove:main:cancel-shelf'
} as const

export function createAmoveBridge(renderer: IpcRendererLike): MainBridge {
  return {
    getState: () => renderer.invoke(IPC.mainGetState) as Promise<MainState>,
    subscribe(listener) {
      const handler = (_event: unknown, ...args: unknown[]) => listener(args[0] as MainState)
      renderer.on(IPC.mainStateChanged, handler)
      return () => { renderer.removeListener(IPC.mainStateChanged, handler) }
    },
    performAction: (action: WindowActionId) => renderer.invoke(IPC.mainPerformAction, { action }) as Promise<ReturnType<MainBridge['performAction']> extends Promise<infer Value> ? Value : never>,
    recordShortcut: (action: WindowActionId, binding: ShortcutBinding) => renderer.invoke(IPC.mainRecordShortcut, { action, binding }) as Promise<Awaited<ReturnType<MainBridge['recordShortcut']>>>,
    setShortcutRecording: (active: boolean) => renderer.invoke(IPC.mainSetShortcutRecording, active) as Promise<Awaited<ReturnType<MainBridge['setShortcutRecording']>>>,
    resetShortcut: (action?: WindowActionId) => renderer.invoke(IPC.mainResetShortcut, action ? { action } : {}) as Promise<Awaited<ReturnType<MainBridge['resetShortcut']>>>,
    setPresenceMode: (mode: PresenceMode) => renderer.invoke(IPC.mainSetPresence, { mode }) as Promise<Awaited<ReturnType<MainBridge['setPresenceMode']>>>,
    refreshAccessibility: () => renderer.invoke(IPC.mainRefreshAccessibility) as Promise<Awaited<ReturnType<MainBridge['refreshAccessibility']>>>,
    requestAccessibility: () => renderer.invoke(IPC.mainRequestAccessibility) as Promise<Awaited<ReturnType<MainBridge['requestAccessibility']>>>,
    openAccessibilitySettings: () => renderer.invoke(IPC.mainOpenAccessibilitySettings) as Promise<Awaited<ReturnType<MainBridge['openAccessibilitySettings']>>>,
    showShelf: () => renderer.invoke(IPC.mainShowShelf) as Promise<Awaited<ReturnType<MainBridge['showShelf']>>>,
    cancelShelf: () => renderer.invoke(IPC.mainCancelShelf) as Promise<Awaited<ReturnType<MainBridge['cancelShelf']>>>
  }
}
