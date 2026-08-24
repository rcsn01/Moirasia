// Build native feature resources and stage them under namespaced suite paths.
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') process.exit(0)

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const amoveRoot = 'apps/Amove'
if (!existsSync(`${amoveRoot}/node_modules/.bin/napi`)) run('pnpm', ['install', '--frozen-lockfile', '--ignore-workspace', '--ignore-scripts'], amoveRoot)
run('pnpm', ['native:mac'], amoveRoot)
mkdirSync('native/staged/features/amove/native', { recursive: true })
mkdirSync('native/staged/features/amove/assets', { recursive: true })
copyFileSync(`${amoveRoot}/native/amove-native.darwin-arm64.node`, 'native/staged/features/amove/native/amove-native.darwin-arm64.node')
cpSync('packages/feature-amove/assets', 'native/staged/features/amove/assets', { recursive: true })

const exithibitionRoot = 'apps/Exithibition'
const result = spawnSync('env', ['-u', 'SDKROOT', 'CLANG_MODULE_CACHE_PATH=/private/tmp/exithibition-module-cache', 'swift', 'build', '--disable-sandbox', '-c', 'release', '--arch', 'arm64'], { cwd: exithibitionRoot, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)

mkdirSync('native/staged/features', { recursive: true })
copyFileSync(`${exithibitionRoot}/.build/arm64-apple-macosx/release/ExithibitionNative`, 'native/staged/features/ExithibitionNative')
