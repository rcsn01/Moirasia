import type { ModuleId } from '../../shared/contracts'

declare global {
  interface Window {
    readonly moduleInfo: Readonly<{ id: ModuleId }>
  }
}

export {}
