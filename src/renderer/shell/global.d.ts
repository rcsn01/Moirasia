import type { MainBridge } from '../../../apps/integrated/Amove/src/shared/contracts'
import type { ExithibitionAPI } from '../../../apps/integrated/Exithibition/src/shared/contracts'
import type { OrbisApi } from '../../../apps/integrated/Orbis/src/shared/contracts'
import type { ControllerApi } from '../../shared/contracts'

declare global {
  interface Window {
    readonly moirasia: ControllerApi
    readonly amove: MainBridge
    readonly exithibition: ExithibitionAPI
    readonly orbis: OrbisApi
  }
}

export {}
