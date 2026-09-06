import { app } from 'electron'
import { rm } from 'node:fs/promises'
import { writeSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { LoginItemControlResult } from './index'

/**
 * Serve the `--moirasia-control` login-item protocol and exit: the process is a
 * short-lived control command, never the application. Returns true when the
 * protocol claimed the process (the caller must not continue launching); false
 * for an ordinary interactive launch.
 */
export async function runLoginItemControl(appId: string, argv = process.argv): Promise<boolean> {
  const argument = argv.find((value) => value.startsWith('--moirasia-control='))
  const switchValue = app.commandLine.getSwitchValue('moirasia-control')
  if (!argument && !switchValue) return false
  const command = switchValue || argument!.slice('--moirasia-control='.length)
  const isolated = join(tmpdir(), `moirasia-control-${appId}-${process.pid}`)
  app.setPath('userData', isolated)
  let result: LoginItemControlResult
  try {
    await app.whenReady()
    if (command === 'login-item:set:on') app.setLoginItemSettings({ openAtLogin: true })
    else if (command === 'login-item:set:off') app.setLoginItemSettings({ openAtLogin: false })
    else if (command !== 'login-item:get') throw new Error('Unsupported control command')
    const settings = app.getLoginItemSettings()
    const status = process.platform !== 'darwin' ? 'unavailable' : settings.status === 'requires-approval' ? 'requires-approval' : settings.openAtLogin ? 'enabled' : command === 'login-item:set:on' ? 'requires-approval' : 'disabled'
    result = { protocolVersion: 1, appId, openAtLogin: settings.openAtLogin, status }
  } catch (error) {
    result = { protocolVersion: 1, appId, openAtLogin: false, status: process.platform === 'darwin' ? 'error' : 'unavailable', error: error instanceof Error ? error.message : String(error) }
  }
  writeSync(1, `${JSON.stringify(result)}\n`)
  await rm(isolated, { recursive: true, force: true }).catch(() => undefined)
  app.exit(result.status === 'error' ? 1 : 0)
  return true
}