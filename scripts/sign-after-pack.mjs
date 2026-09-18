import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Signs nested code first, then the outer bundle, then verifies strictly.
 * The login item service must be signed before the outer app seals it. */
export default async function signAfterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const contents = join(app, 'Contents')
  const nested = [
    join(contents, 'Library', 'LoginItems', 'MoirasiaHost.app'),
    join(contents, 'Resources', 'runtime', 'MoirasiaFeatureService.app')
  ].filter((bundle) => existsSync(bundle))
  for (const bundle of nested) {
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', bundle], { stdio: 'inherit' })
  }
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' })
  for (const bundle of nested) {
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', bundle], { stdio: 'inherit' })
  }
}