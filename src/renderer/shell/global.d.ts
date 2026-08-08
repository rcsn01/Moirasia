import type { ControllerApi } from '../../shared/contracts'

declare global {
  interface Window {
    readonly moirasia: ControllerApi
  }
}

export {}
