import type { ExithibitionAPI } from "../shared/contracts"
import type { AppearanceApi } from '@moirasia/desktop-shell'
declare global { interface Window { exithibition: ExithibitionAPI; desktopShell: AppearanceApi } }
export {}
