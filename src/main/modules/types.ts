import type { ModuleId } from '../../shared/contracts'

export interface ModuleView {
  readonly id: ModuleId
}

export interface ModuleController {
  readonly id: ModuleId
  start(): Promise<ModuleView>
  activate(): Promise<void>
  deactivate(): Promise<void>
  preStop?(): Promise<ModuleStopWarning | null> | ModuleStopWarning | null
  stop(): Promise<void>
}

export interface ModuleStopWarning {
  readonly moduleId: ModuleId
  readonly title: string
  readonly detail: string
}

export type ModuleLoader = () => Promise<ModuleController>

export interface ModuleDefinition {
  readonly id: ModuleId
  readonly label: string
  readonly availability?: () => { available: true } | { available: false; reason: string }
  readonly load: ModuleLoader
}

export interface ModuleViewHost {
  attach(view: ModuleView): void
  detach(view: ModuleView): void
}
