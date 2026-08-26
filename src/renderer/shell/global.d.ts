import type { MainBridge } from '../../../apps/Amove/src/shared/contracts'
import type { ExithibitionAPI } from '../../../apps/Exithibition/src/shared/contracts'
import type { OrbisApi } from '../../../apps/Orbis/src/shared/contracts'
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
