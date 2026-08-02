import { contextBridge } from 'electron'
import type { ModuleId } from '../shared/contracts'

const argument = process.argv.find((value) => value.startsWith('--module-id='))
const value = argument?.slice('--module-id='.length)
if (value !== 'amove' && value !== 'vox' && value !== 'exithibition') {
  throw new Error('Missing or invalid module id')
}

contextBridge.exposeInMainWorld('moduleInfo', Object.freeze({ id: value satisfies ModuleId }))
