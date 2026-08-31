// Build native feature resources and stage them under namespaced suite paths.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') process.exit(0)

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const amoveRoot = 'apps/integrated/Amove'
if (!existsSync(`${amoveRoot}/node_modules/.bin/napi`)) run('pnpm', ['install', '--frozen-lockfile', '--ignore-workspace', '--ignore-scripts'], amoveRoot)
run('pnpm', ['native:mac'], amoveRoot)
mkdirSync('native/staged/features/amove/native', { recursive: true })
mkdirSync('native/staged/features/amove/assets', { recursive: true })
copyFileSync(`${amoveRoot}/native/amove-native.darwin-arm64.node`, 'native/staged/features/amove/native/amove-native.darwin-arm64.node')
cpSync('apps/integrated/Amove/assets', 'native/staged/features/amove/assets', { recursive: true })

const orbisRoot = 'apps/integrated/Orbis'
if (!existsSync(`${orbisRoot}/node_modules/.bin/napi`)) run('pnpm', ['install', '--frozen-lockfile', '--ignore-workspace', '--ignore-scripts'], orbisRoot)
run('pnpm', ['native:mac'], orbisRoot)
mkdirSync('native/staged/features/orbis/native', { recursive: true })
copyFileSync(`${orbisRoot}/native/orbis-metadata.darwin-arm64.node`, 'native/staged/features/orbis/native/orbis-metadata.darwin-arm64.node')

const exithibitionRoot = 'apps/integrated/Exithibition'
const result = spawnSync('env', ['-u', 'SDKROOT', 'CLANG_MODULE_CACHE_PATH=/private/tmp/exithibition-module-cache', 'swift', 'build', '--disable-sandbox', '-c', 'release', '--arch', 'arm64'], { cwd: exithibitionRoot, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)

mkdirSync('native/staged/features', { recursive: true })
copyFileSync(`${exithibitionRoot}/.build/arm64-apple-macosx/release/ExithibitionNative`, 'native/staged/features/ExithibitionNative')

const bondedRoot = 'apps/integrated/Bonded'
run('pnpm', ['native:release'], bondedRoot)
mkdirSync('native/staged/features/bonded/native', { recursive: true })
copyFileSync(`${bondedRoot}/native/.build/arm64-apple-macosx/release/BondedFirewallHelper`, 'native/staged/features/bonded/native/BondedFirewallHelper')

const voxRoot = 'apps/integrated/Vox'
run('env', ['-u', 'SDKROOT', 'CLANG_MODULE_CACHE_PATH=/private/tmp/vox-clang-module-cache', 'swift', 'build', '--disable-sandbox', '--package-path', 'native', '-c', 'release', '--arch', 'arm64'], voxRoot)
const voxRelease = `${voxRoot}/native/.build/arm64-apple-macosx/release`
const voxStage = 'native/staged/features/vox/native'
rmSync(voxStage, { recursive: true, force: true })
mkdirSync(voxStage, { recursive: true })
copyFileSync(`${voxRelease}/VoxNative`, `${voxStage}/VoxNative`)
for (const entry of readdirSync(voxRelease, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.endsWith('.bundle')) cpSync(`${voxRelease}/${entry.name}`, `${voxStage}/${entry.name}`, { recursive: true })
}
