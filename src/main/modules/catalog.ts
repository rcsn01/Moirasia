import type { ModuleId } from '../../shared/contracts'

export interface ModuleCatalogEntry {
  readonly id: ModuleId
  readonly label: string
  readonly bundleId: string
  readonly developmentRepository: string
}

export const MODULE_CATALOG: readonly ModuleCatalogEntry[] = [
  { id: 'amove', label: 'Amove', bundleId: 'com.opense.Amove', developmentRepository: 'apps/Amove' },
  { id: 'vox', label: 'Vox', bundleId: 'com.moirasia.vox', developmentRepository: 'apps/Vox' },
  { id: 'exithibition', label: 'Exithibition', bundleId: 'com.local.Exithibition', developmentRepository: 'apps/Exithibition' }
]
