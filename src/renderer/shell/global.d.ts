import type { MainBridge } from '../../../apps/integrated/Amove/src/shared/contracts'
import type { BondedApi } from '../../../apps/integrated/Bonded/src/shared/contracts'
import type { ControllerApi } from '../../shared/contracts'

declare global {
  interface Window {
    readonly moirasia: ControllerApi
    readonly amove: MainBridge
    readonly bonded: BondedApi
  }
}

export {}
