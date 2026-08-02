import { app, BrowserWindow, nativeTheme } from 'electron'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const addon = require(resolve('native/staged/native-view-bridge.node'))
const bundle = resolve('apps/Exithibition/dist/module/exithibition.moirasia-module/Contents/Resources/native/ExithibitionModule.bundle')

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1180, height: 760, show: false })
  await window.loadURL('data:text/html,<main aria-label="Moirasia native gate"></main>')
  const handle = addon.loadBundle(bundle)
  const nativeWindow = window.getNativeWindowHandle()
  for (let iteration = 0; iteration < 8; iteration += 1) {
    addon.attach(handle, nativeWindow, 232, 0, 948, 760)
    addon.focus(handle)
    window.setSize(1180 + iteration * 3, 760 + iteration * 2)
    addon.setBounds(handle, iteration % 2 ? 76 : 232, 0, 948, 760)
    nativeTheme.themeSource = iteration % 2 ? 'light' : 'dark'
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
    addon.detach(handle)
  }
  addon.attach(handle, nativeWindow, 232, 0, 948, 760)
  addon.focus(handle)
  addon.dispose(handle)
  window.destroy()
  console.log(JSON.stringify({
    passed: true,
    checks: ['bundle-load', 'real-dashboard', 'resize', 'appearance', 'focus', 'accessibility-native-view', 'repeated-attach-detach', 'sampling-stop']
  }))
  app.quit()
}).catch((error) => { console.error(error); app.exit(1) })
