// Builds the Exithibition Swift helper (release) and stages it for the suite bundle.
// The SwiftPM package stays in apps/Exithibition; only the binary is copied in.
import { copyFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') process.exit(0)

const productDir = 'apps/Exithibition'
const configuration = 'release'
const result = spawnSync('env', ['-u', 'SDKROOT', 'CLANG_MODULE_CACHE_PATH=/private/tmp/exithibition-module-cache', 'swift', 'build', '--disable-sandbox', '-c', configuration, '--arch', 'arm64'], { cwd: productDir, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)

mkdirSync('native/staged/features', { recursive: true })
copyFileSync(`${productDir}/.build/arm64-apple-macosx/${configuration}/ExithibitionNative`, 'native/staged/features/ExithibitionNative')
