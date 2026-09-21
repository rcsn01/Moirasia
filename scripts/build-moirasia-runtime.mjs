import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

if (process.platform !== 'darwin') process.exit(0)

const packagePath = 'native/moirasia-runtime'
const configuration = process.env.MOIRASIA_RUNTIME_CONFIGURATION ?? 'release'
const result = spawnSync('swift', ['build', '--package-path', packagePath, '-c', configuration, '--arch', 'arm64'], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)

const binPathResult = spawnSync('swift', ['build', '--show-bin-path', '--package-path', packagePath, '-c', configuration, '--arch', 'arm64'], { encoding: 'utf8' })
if (binPathResult.status !== 0) process.exit(binPathResult.status ?? 1)
const output = binPathResult.stdout.trim()
const destination = 'native/staged/runtime'
rmSync(destination, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })

const bundles = [
  {
    executable: 'MoirasiaHost',
    identifier: 'com.moirasia.desktop.host',
    usage: ''
  },
  {
    executable: 'MoirasiaFeatureService',
    identifier: 'com.moirasia.desktop.feature-service',
    usage: '<key>NSMicrophoneUsageDescription</key><string>Moirasia\'s Shout feature needs microphone access to boost the selected input.</string><key>NSAccessibilityUsageDescription</key><string>Moirasia\'s Amove feature needs Accessibility access to move windows and register global shortcuts.</string>'
  }
]
for (const bundle of bundles) {
  const executable = join(output, bundle.executable)
  const appBundle = join(destination, `${bundle.executable}.app`)
  const contents = join(appBundle, 'Contents')
  const macos = join(contents, 'MacOS')
  mkdirSync(macos, { recursive: true })
  copyFileSync(executable, join(macos, bundle.executable))
  chmodSync(join(macos, bundle.executable), 0o755)
  writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleDisplayName</key><string>${bundle.executable}</string><key>CFBundleExecutable</key><string>${bundle.executable}</string><key>CFBundleIdentifier</key><string>${bundle.identifier}</string><key>CFBundleInfoDictionaryVersion</key><string>6.0</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>1.0.0</string><key>CFBundleVersion</key><string>1</string><key>LSUIElement</key><true/>${bundle.usage}</dict></plist>\n`)
  writeFileSync(join(contents, 'PkgInfo'), 'APPL????\n')
  // Keep direct development copies for older scripts; packaged paths use the bundles.
  copyFileSync(executable, join(destination, bundle.executable))
  chmodSync(join(destination, bundle.executable), 0o755)
}
console.log(`Staged Moirasia native runtime (${configuration}) in ${destination}`)
