import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
if (process.platform !== 'darwin') process.exit(0)
mkdirSync('native/staged', { recursive: true })
const result = spawnSync('xcrun', ['swiftc', '-O', '-module-cache-path', '/private/tmp/moirasia-agent-module-cache', '-framework', 'AppKit', 'native/application-agent/main.swift', '-o', 'native/staged/application-agent'], { stdio: 'inherit', env: { ...process.env, CLANG_MODULE_CACHE_PATH: '/private/tmp/moirasia-agent-module-cache' } })
process.exit(result.status ?? 1)
