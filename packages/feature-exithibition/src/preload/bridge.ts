import type { ExithibitionAPI, ExithibitionEvent, HistoryRange } from '../shared/contracts'
import { isExithibitionEvent } from '../shared/contracts'

export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
}

export function createExithibitionBridge(renderer: IpcRendererLike): ExithibitionAPI {
  return {
    getSnapshot: () => renderer.invoke('exithibition:get-snapshot') as Promise<Awaited<ReturnType<ExithibitionAPI['getSnapshot']>>>,
    getHistory: (range: HistoryRange) => renderer.invoke('exithibition:get-history', range) as Promise<Awaited<ReturnType<ExithibitionAPI['getHistory']>>>,
    setSampling: (enabled: boolean) => renderer.invoke('exithibition:set-sampling', enabled) as Promise<Awaited<ReturnType<ExithibitionAPI['setSampling']>>>,
    setExperimentalSensorsEnabled: (enabled: boolean) => renderer.invoke('exithibition:set-experimental', enabled) as Promise<Awaited<ReturnType<ExithibitionAPI['setExperimentalSensorsEnabled']>>>,
    onEvent(listener: (event: ExithibitionEvent) => void) {
      const handler = (_event: unknown, ...args: unknown[]) => { const value = args[0]; if (isExithibitionEvent(value)) listener(value) }
      renderer.on('exithibition:event', handler)
      return () => { renderer.removeListener('exithibition:event', handler) }
    }
  }
}
