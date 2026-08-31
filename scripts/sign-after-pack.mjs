import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export default async function signAfterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const voxNative = join(app, 'Contents', 'Resources', 'features', 'vox', 'native', 'VoxNative')
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', voxNative], { stdio: 'inherit' })
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', voxNative], { stdio: 'inherit' })
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' })
}
