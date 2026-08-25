import {
  scanFilesystem as scanFilesystemLegacy,
  type ScanOptions as LegacyScanOptions,
  type ScanResult
} from "./legacy-scanner"
import { ProgressiveScanControl, scanFilesystemProgressive, type ProgressivePreview } from "./progressive-scanner"
import type { DirectoryMetadataSource, FolderSizeEstimate } from "./scan-metadata"
import type { FullScanResumeDescriptor, FullScanResumeStore } from './full-scan-resume'

export interface ScanOptions extends LegacyScanOptions {
  readonly control?: ProgressiveScanControl
  readonly onPreview?: (preview: ProgressivePreview) => void
  readonly initialEstimate?: FolderSizeEstimate
  readonly directoryMetadataSource?: DirectoryMetadataSource
  readonly nativeAddonPath?: string
  /** Internal traversal tuning used by tests and benchmarks. */
  readonly metadataBatchSize?: number
  readonly resumable?: { readonly descriptor: FullScanResumeDescriptor; readonly store: FullScanResumeStore; readonly resume: boolean }
  readonly onCheckpoint?: (sequence: number) => void
  readonly drainResumeJournal?: (eventId: string) => { readonly throughEventId: string; readonly scopes: readonly string[]; readonly restartReason?: string }
}

export function scanFilesystem(options: ScanOptions): Promise<ScanResult> {
  if (process.env.ORBIS_LEGACY_SCAN === "1") return scanFilesystemLegacy(options)
  const control = options.control ?? new ProgressiveScanControl()
  return scanFilesystemProgressive({ ...options, control })
}

export * from "./legacy-scanner"
export { ProgressiveScanControl }
export type { ProgressivePreview }
