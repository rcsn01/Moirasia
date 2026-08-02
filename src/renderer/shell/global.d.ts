import type { ShellApi } from '../../shared/contracts'

declare global {
  interface Window {
    readonly moirasia: ShellApi
  }
}

export {}
