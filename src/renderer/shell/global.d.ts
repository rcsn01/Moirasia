import type { MainBridge } from '@moirasia/feature-amove/shared/contracts'
import type { ExithibitionAPI } from '@moirasia/feature-exithibition/shared/contracts'
import type { OrbisApi } from '@moirasia/feature-orbis/shared/contracts'
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
