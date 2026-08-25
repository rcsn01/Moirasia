import {
  scanFilesystem as scanFilesystemLegacy,
  type ScanOptions as LegacyScanOptions,
  type ScanResult
} from "./legacy-scanner"
import { ProgressiveScanControl, scanFilesystemProgressive, type ProgressivePreview } from "./progressive-scanner"
import type { DirectoryMetadataSource, FolderSizeEstimate } from "./scan-metadata"

export interface ScanOptions extends LegacyScanOptions {
  readonly control?: ProgressiveScanControl
  readonly onPreview?: (preview: ProgressivePreview) => void
  readonly initialEstimate?: FolderSizeEstimate
  readonly directoryMetadataSource?: DirectoryMetadataSource
  readonly nativeAddonPath?: string
}

export function scanFilesystem(options: ScanOptions): Promise<ScanResult> {
  if (process.env.ORBIS_LEGACY_SCAN === "1") return scanFilesystemLegacy(options)
  const control = options.control ?? new ProgressiveScanControl()
  return scanFilesystemProgressive({ ...options, control })
}

export * from "./legacy-scanner"
export { ProgressiveScanControl }
export type { ProgressivePreview }
