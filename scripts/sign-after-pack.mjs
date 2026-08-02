import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export default async function signAfterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' })
}
