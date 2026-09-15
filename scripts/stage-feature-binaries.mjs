// Build native feature resources and stage them under namespaced suite paths.
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs'
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

const bondedRoot = 'apps/integrated/Bonded'
run('pnpm', ['native:release'], bondedRoot)
mkdirSync('native/staged/features/bonded/native', { recursive: true })
copyFileSync(`${bondedRoot}/native/.build/arm64-apple-macosx/release/BondedFirewallHelper`, 'native/staged/features/bonded/native/BondedFirewallHelper')

const shoutRoot = 'apps/integrated/Shout'
run('pnpm', ['native:release'], shoutRoot)
run('pnpm', ['native:driver:release'], shoutRoot)
mkdirSync('native/staged/features/shout/native', { recursive: true })
copyFileSync(`${shoutRoot}/native/.build/out/Products/Release/ShoutAudioHelper`, 'native/staged/features/shout/native/ShoutAudioHelper')
cpSync(`${shoutRoot}/native/driver/dist`, 'native/staged/features/shout/driver', { recursive: true })
