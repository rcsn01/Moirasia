import { existsSync } from 'node:fs'

const forbidden = [
  'src/modules/amove', 'src/modules/vox', 'src/modules/exithibition', 'src/modules/bonded',
  'src/renderer/amove', 'src/renderer/vox', 'src/renderer/exithibition', 'src/renderer/bonded',
  'native/amove', 'native/vox', 'native/exithibition', 'native/bonded'
]
const found = forbidden.filter(existsSync)
if (found.length > 0) {
  console.error(`Application-owned source returned to Moirasia:\n${found.join('\n')}`)
  process.exitCode = 1
}
