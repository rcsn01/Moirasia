import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'

const output = resolve('native/staged/native-view-bridge.node')
await mkdir(dirname(output), { recursive: true })
const include = resolve(process.execPath, '../../include/node')
const result = spawnSync('xcrun', [
  'clang++', '-std=c++20', '-fobjc-arc', '-ObjC++', '-bundle', '-undefined', 'dynamic_lookup',
  '-framework', 'AppKit', '-I', include,
  '-DNODE_GYP_MODULE_NAME=native_view_bridge',
  'native/native-view-bridge/bridge.mm', '-o', output
], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
