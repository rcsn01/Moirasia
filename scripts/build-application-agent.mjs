import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { userInfo } from 'node:os'
if (process.platform !== 'darwin') process.exit(0)
mkdirSync('native/staged', { recursive: true })
// A user-scoped cache: a shared /private/tmp cache breaks when one run (e.g. an
// admin-privileged install flow) creates it as root.
const moduleCache = `/private/tmp/moirasia-agent-module-cache-${userInfo().username}`
const result = spawnSync('xcrun', ['swiftc', '-O', '-module-cache-path', moduleCache, '-framework', 'AppKit', 'native/application-agent/main.swift', '-o', 'native/staged/application-agent'], { stdio: 'inherit', env: { ...process.env, CLANG_MODULE_CACHE_PATH: moduleCache } })
process.exit(result.status ?? 1)
