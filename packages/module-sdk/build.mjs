import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

export async function hashPayload(root) {
  const hash = createHash('sha256')
  for (const file of await files(root)) {
    const name = relative(root, file).replaceAll('\\', '/')
    if (name === 'manifest.json') continue
    const content = await readFile(file)
    hash.update(`${name}\0${content.byteLength}\0`)
    hash.update(content)
  }
  return hash.digest('hex')
}

async function files(root) {
  const result = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...await files(path))
    else if (entry.isFile()) result.push(path)
    else throw new Error(`Module payload cannot contain links or special files: ${path}`)
  }
  return result.sort()
}
