import { ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import {
  IPC, actionPayloadSchema, presencePayloadSchema, recordShortcutPayloadSchema, resetShortcutPayloadSchema,
  shelfDraftPayloadSchema, shelfDragPayloadSchema, shelfIdsPayloadSchema, shelfModePayloadSchema, shelfPathsPayloadSchema,
  shelfRevealPayloadSchema, shelfThumbnailPayloadSchema
} from '../shared/contracts'
import type { AppController } from './app-controller'
import { authorizeIpcSender } from './ipc-authorization'

export function registerIpc(controller: AppController): () => void {
  const main = (event: IpcMainInvokeEvent) => authorizeIpcSender(event.sender, controller.getMainWebContents(), 'main')
  const shelf = (event: IpcMainEvent | IpcMainInvokeEvent) => authorizeIpcSender(event.sender, controller.shelf.getWindow()?.webContents, 'shelf')
  const registeredHandlers: string[] = []
  const handle = (channel: string, listener: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, listener)
    registeredHandlers.push(channel)
  }
  const preloadPaths = (event: IpcMainEvent, raw: unknown): void => {
    try {
      shelf(event)
      const paths = shelfPathsPayloadSchema.parse(raw).paths
      void controller.shelf.preloadPaths(paths).catch(() => undefined)
    } catch {
      // fire-and-forget IPC has no renderer-side rejection channel
    }
  }
  const beginDrag = (event: IpcMainEvent, raw: unknown): void => {
    try {
      shelf(event)
      controller.shelf.beginDrag(shelfDragPayloadSchema.parse(raw).ids)
    } catch {
      // fire-and-forget IPC has no renderer-side rejection channel
    }
  }

  try {
    handle(IPC.mainGetState, (event) => { main(event); return controller.getState() })
    handle(IPC.mainPerformAction, (event, raw) => { main(event); return controller.performAction(actionPayloadSchema.parse(raw).action) })
    handle(IPC.mainRecordShortcut, (event, raw) => { main(event); const value = recordShortcutPayloadSchema.parse(raw); return controller.recordShortcut(value.action, value.binding) })
    handle(IPC.mainSetShortcutRecording, (event, raw) => { main(event); return controller.setShortcutRecording(z.boolean().parse(raw)) })
    handle(IPC.mainResetShortcut, (event, raw) => { main(event); return controller.resetShortcut(resetShortcutPayloadSchema.parse(raw).action) })
    handle(IPC.mainSetPresence, (event, raw) => { main(event); return controller.setPresenceMode(presencePayloadSchema.parse(raw).mode) })
    handle(IPC.mainRefreshAccessibility, (event) => { main(event); return controller.refreshAccessibility() })
    handle(IPC.mainRequestAccessibility, (event) => { main(event); return controller.requestAccessibility() })
    handle(IPC.mainOpenAccessibilitySettings, (event) => { main(event); return controller.openAccessibilitySettings() })
    handle(IPC.mainShowShelf, (event) => { main(event); return controller.showShelf() })
    handle(IPC.mainCancelShelf, (event) => { main(event); return controller.cancelShelf() })
    handle(IPC.shelfGetState, (event) => { shelf(event); return controller.shelf.store.getState() })
    handle(IPC.shelfSetMode, async (event, raw) => { shelf(event); await controller.shelf.setMode(shelfModePayloadSchema.parse(raw).mode); return { ok: true, value: undefined } })
    handle(IPC.shelfSetItemsExpanded, async (event, raw) => { shelf(event); await controller.shelf.setItemsExpanded(z.boolean().parse(raw)); return { ok: true, value: undefined } })
    handle(IPC.shelfAddPaths, (event, raw) => { shelf(event); return controller.shelf.store.addPaths(shelfPathsPayloadSchema.parse(raw).paths, process.platform) })
    ipcMain.on(IPC.shelfPreloadPaths, preloadPaths)
    handle(IPC.shelfRemoveItems, (event, raw) => { shelf(event); controller.shelf.store.remove(shelfIdsPayloadSchema.parse(raw).ids); return { ok: true, value: undefined } })
    handle(IPC.shelfSetDraft, (event, raw) => { shelf(event); controller.shelf.store.setDraft(shelfDraftPayloadSchema.parse(raw).draft); return { ok: true, value: undefined } })
    ipcMain.on(IPC.shelfBeginDrag, beginDrag)
    handle(IPC.shelfRevealItems, (event, raw) => {
      shelf(event)
      const paths = controller.shelf.store.pathsFor(shelfRevealPayloadSchema.parse(raw).ids)
      for (const path of paths) shell.showItemInFolder(path)
      return paths.length > 0 ? { ok: true, value: undefined } : { ok: false, code: 'items-not-found', message: 'No staged items were available to reveal.' }
    })
    handle(IPC.shelfGetThumbnails, async (event, raw) => { shelf(event); const value = await controller.shelf.getThumbnails(shelfThumbnailPayloadSchema.parse(raw).ids); return { ok: true, value } })
    handle(IPC.shelfCompleteDrag, (event, raw) => { shelf(event); controller.shelf.completeDrag(z.boolean().parse(raw)); return { ok: true, value: undefined } })
    handle(IPC.shelfClose, (event) => { shelf(event); return controller.closeShelf() })
  } catch (error) {
    for (const channel of registeredHandlers) ipcMain.removeHandler(channel)
    ipcMain.removeListener(IPC.shelfPreloadPaths, preloadPaths)
    ipcMain.removeListener(IPC.shelfBeginDrag, beginDrag)
    throw error
  }

  return () => {
    for (const channel of registeredHandlers) ipcMain.removeHandler(channel)
    ipcMain.removeListener(IPC.shelfPreloadPaths, preloadPaths)
    ipcMain.removeListener(IPC.shelfBeginDrag, beginDrag)
  }
}
