import { BrowserWindow, ipcMain, powerMonitor, type IpcMainInvokeEvent } from "electron"
import type { FeatureContext } from '@moirasia/desktop-shell/feature'
import type { ExithibitionEvent, ExithibitionSnapshot, HardwareSample, HistoryRange, RuntimeState } from "../shared/contracts"
import { isHistoryRange } from "../shared/contracts"
import { NativeClient } from "./native-client"
import { desktopWindowChromeOptions, neutralWindowBackground, registerProductAppearance } from '@moirasia/desktop-shell/main'

const MAX_HISTORY = 43_200
export class ExithibitionController {
  private view: BrowserWindow | undefined
  private disposeAppearance: (() => void) | undefined
  private native: NativeClient | undefined
  private snapshot: ExithibitionSnapshot | undefined
  private history: HardwareSample[] = []
  private disposers: (() => void)[] = []
  constructor(private readonly ctx: FeatureContext) {}
  async start(): Promise<void> {
    this.registerIPC()
    await this.createView()
    const native = new NativeClient(this.ctx.paths.nativeExecutable)
    this.native = native
    native.on("event", (event: ExithibitionEvent) => this.receive(event))
    native.on("protocol-error", (error: Error) => this.broadcast({ type: "error", payload: { message: error.message } }))
    native.on("fatal", (error: Error) => this.broadcast({ type: "error", payload: { message: error.message } }))
    native.start()
    const suspend = () => void native.invoke("resetBaseline")
    powerMonitor.on("suspend", suspend); powerMonitor.on("resume", suspend)
    this.disposers.push(() => { powerMonitor.off("suspend", suspend); powerMonitor.off("resume", suspend) })
  }
  activate() { if (this.view) { this.view.show(); this.view.focus() } }
  async stop() { for (const dispose of this.disposers.splice(0)) dispose(); this.disposeAppearance?.(); this.disposeAppearance = undefined; this.history = []; await this.native?.stop(); this.native = undefined; if (this.view && !this.view.isDestroyed()) this.view.destroy(); this.view = undefined }
  private async createView() {
    const window = new BrowserWindow({ title: "Exithibition", width: 1180, height: 760, minWidth: 1080, minHeight: 690, ...desktopWindowChromeOptions(), show: false, backgroundColor: neutralWindowBackground('dark'), webPreferences: { preload: this.ctx.paths.preload, contextIsolation: true, nodeIntegration: false, sandbox: true } })
    this.view = window; this.installSpaceHandler(window)
    this.disposeAppearance = await registerProductAppearance(this.ctx.productId, window)
    window.once("ready-to-show", () => window.show())
    if (this.ctx.paths.rendererUrl) await window.loadURL(this.ctx.paths.rendererUrl); else await window.loadFile(this.ctx.paths.rendererFile)
  }
  private installSpaceHandler(view: BrowserWindow) { view.webContents.on("before-input-event", (event, input) => { if (input.type === "keyDown" && input.key === " " && !input.control && !input.meta && !input.alt && !input.shift) { event.preventDefault(); if (this.snapshot) void this.setSampling(!this.snapshot.state.sampling) } }) }
  private authorize(event: IpcMainInvokeEvent) { if (!this.view || event.sender !== this.view.webContents || event.sender.isDestroyed()) throw new Error("Unauthorized IPC sender") }
  private receive(event: ExithibitionEvent) { if (event.type === "snapshot") this.snapshot = event.payload; if (event.type === "sample" && this.snapshot) { this.snapshot = { ...this.snapshot, sample: event.payload }; this.history.push(event.payload); if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY) } if (event.type === "state" && this.snapshot) this.snapshot = { ...this.snapshot, state: event.payload }; this.broadcast(event) }
  private broadcast(event: ExithibitionEvent) { if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.send("exithibition:event", event) }
  private async getSnapshot() { if (this.snapshot) return this.snapshot; const result = await this.native?.invoke("getSnapshot"); if (!result) throw new Error("Telemetry snapshot is not ready"); this.snapshot = result as ExithibitionSnapshot; return this.snapshot }
  private getHistory(range: HistoryRange) { const seconds = ({ "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "Session": Infinity } as const)[range]; if (!Number.isFinite(seconds)) return [...this.history]; const cutoff = Date.now() - seconds * 1000; return this.history.filter((sample) => Date.parse(sample.capturedAt) >= cutoff) }
  private async setSampling(enabled: boolean) { const state = await this.native?.invoke("setSampling", { enabled }) as RuntimeState | undefined; if (!state) throw new Error("Telemetry runtime is unavailable"); if (this.snapshot) this.snapshot = { ...this.snapshot, state }; return state }
  private registerIPC() {
    const channels = ["exithibition:get-snapshot", "exithibition:get-history", "exithibition:set-sampling", "exithibition:set-experimental"]
    ipcMain.handle(channels[0]!, (event) => { this.authorize(event); return this.getSnapshot() })
    ipcMain.handle(channels[1]!, (event, range: unknown) => { this.authorize(event); if (!isHistoryRange(range)) throw new Error("Invalid history range"); return this.getHistory(range) })
    ipcMain.handle(channels[2]!, (event, enabled: unknown) => { this.authorize(event); if (typeof enabled !== "boolean") throw new Error("enabled must be boolean"); return this.setSampling(enabled) })
    ipcMain.handle(channels[3]!, async (event, enabled: unknown) => { this.authorize(event); if (typeof enabled !== "boolean") throw new Error("enabled must be boolean"); const state = await this.native?.invoke("setExperimentalSensorsEnabled", { enabled }) as RuntimeState | undefined; if (!state) throw new Error("Telemetry runtime is unavailable"); if (this.snapshot) this.snapshot = { ...this.snapshot, state }; return state })
    this.disposers.push(() => channels.forEach((channel) => ipcMain.removeHandler(channel)))
  }
}
