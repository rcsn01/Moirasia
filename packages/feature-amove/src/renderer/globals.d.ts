import type { MainBridge, ShelfBridge } from "../shared/contracts";
import type { AppearanceApi } from '@moirasia/desktop-shell';
declare global { interface Window { amove: MainBridge; amoveShelf: ShelfBridge; desktopShell: AppearanceApi; } }
export {};
