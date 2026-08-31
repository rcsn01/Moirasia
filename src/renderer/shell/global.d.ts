import type { MainBridge } from '../../../apps/integrated/Amove/src/shared/contracts'
import type { VoxAPI } from '../../../apps/integrated/Vox/src/shared/types'
import type { ExithibitionAPI } from '../../../apps/integrated/Exithibition/src/shared/contracts'
import type { BondedApi } from '../../../apps/integrated/Bonded/src/shared/contracts'
import type { OrbisApi } from '../../../apps/integrated/Orbis/src/shared/contracts'
import type { ControllerApi } from '../../shared/contracts'

declare global {
  interface Window {
    readonly moirasia: ControllerApi
    readonly amove: MainBridge
    readonly vox: VoxAPI
    readonly exithibition: ExithibitionAPI
    readonly bonded: BondedApi
    readonly orbis: OrbisApi
  }
}

export {}
