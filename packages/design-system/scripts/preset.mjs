import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { decodePreset, encodePreset, isValidPreset } from "shadcn/preset"
import { resolveFoundation, resolveProducts } from "./foundation.mjs"
import { reactOutputs } from "./adapters/react.mjs"
import { cssOutputs } from "./adapters/css.mjs"
import { swiftOutput } from "./adapters/swift.mjs"

export const workspaceDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const sourceFile = "packages/design-system/preset.source.json"
const foundationFile = "packages/design-system/foundation.tokens.json"
const productFile = "packages/design-system/product-tokens.json"
const lockFile = "packages/design-system/preset.lock.json"
const generatorFiles = ["preset.mjs", "foundation.mjs", "colors.mjs", "adapters/react.mjs", "adapters/css.mjs", "adapters/swift.mjs"]
const stableJson = value => `${JSON.stringify(value, null, 2)}\n`
const hash = value => createHash("sha256").update(value).digest("hex")

const EXPECTED = {
  menuColor: "default-translucent",
  menuAccent: "subtle",
  radius: "medium",
  font: "jetbrains-mono",
  iconLibrary: "lucide",
  theme: "stone",
  baseColor: "stone",
  style: "mira",
  chartColor: "stone",
  fontHeading: "inherit"
}

function validateSource(source) {
  if (source.primitiveBase !== "base-ui" || source.tailwindVersion !== 4 || source.cssVariables !== true || source.shadcnVersion !== "4.16.1") throw new Error("Unsupported preset source metadata")
  if (!isValidPreset(source.code)) throw new Error(`Invalid shadcn preset code: ${source.code}`)
  const decoded = decodePreset(source.code)
  if (!decoded || encodePreset(decoded) !== source.code) throw new Error("Preset did not round-trip through the pinned decoder")
  for (const [key, value] of Object.entries(EXPECTED)) if (decoded[key] !== value) throw new Error(`Preset ${source.code} is not supported by this generated template (${key}: ${decoded[key]})`)
  return decoded
}

export function buildOutputs(source, authoredFoundation, authoredProducts, inputHashes = {}) {
  const decoded = validateSource(source)
  const foundation = resolveFoundation(authoredFoundation)
  const products = resolveProducts(authoredProducts)
  const outputs = new Map([
    ...reactOutputs(foundation, products),
    ...cssOutputs(foundation, products),
    ["packages/ui-swift/Sources/MoirasiaUI/MoiraTokens.swift", swiftOutput(foundation, products)]
  ])
  const hashes = Object.fromEntries([...outputs].map(([path, content]) => [path, hash(content)]))
  const lock = { presetCode: source.code, decoded, generator: "@moirasia/design-system@0.1.0", formatVersion: 1, shadcnVersion: source.shadcnVersion, tailwindVersion: source.tailwindVersion, cssVariables: source.cssVariables, inputs: inputHashes, outputHash: hash(Object.entries(hashes).flat().join("\n")), outputs: hashes }
  outputs.set(lockFile, stableJson(lock))
  return outputs
}

async function json(root, path) {
  const content = await readFile(resolve(root, path), "utf8")
  try { return { content, value: JSON.parse(content) } }
  catch (error) { throw new Error(`${path}: invalid JSON: ${error.message}`) }
}
async function assembled(root, code) {
  const source = await json(root, sourceFile)
  const foundation = await json(root, foundationFile)
  const products = await json(root, productFile)
  if (code !== undefined) { source.value.code = code; source.content = stableJson(source.value) }
  const inputs = Object.fromEntries([[sourceFile, source.content], [foundationFile, foundation.content], [productFile, products.content]].map(([path, content]) => [path, hash(content)]))
  for (const file of generatorFiles) {
    const path = `packages/design-system/scripts/${file}`
    inputs[path] = hash(await readFile(resolve(root, path), "utf8"))
  }
  return { source: source.content, outputs: buildOutputs(source.value, foundation.value, products.value, inputs) }
}
async function readArtifact(root, path) {
  try { return await readFile(resolve(root, path), "utf8") }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error }
}

// root is an internal test seam. CLI callers always use the location-derived workspace.
export async function run(command = "sync", code, root = workspaceDir) {
  if (!["sync", "check", "set"].includes(command)) throw new Error(`Unknown preset command: ${command}`)
  if (command === "set" && !code) throw new Error("Usage: pnpm ui:preset:set <code>")
  const { source, outputs } = await assembled(root, command === "set" ? code : undefined)
  if (command === "check") {
    const failures = []
    for (const [path, content] of outputs) if (await readArtifact(root, path) !== content) failures.push(`${path}: missing or stale generated artifact`)
    for (const [path, expected] of [
      ["packages/ui-react/package.json", { "@fontsource-variable/jetbrains-mono": "^5.3.0", shadcn: "4.16.1" }],
      ["packages/ui-css/package.json", { "@fontsource-variable/jetbrains-mono": "^5.3.0" }],
      ["apps/standalone/Vox/package.json", { "@fontsource-variable/jetbrains-mono": "^5.3.0" }]
    ]) {
      const content = await readArtifact(root, path)
      let manifest
      try { manifest = content && JSON.parse(content) } catch { failures.push(`${path}: invalid JSON`) }
      for (const [name, version] of Object.entries(expected)) if (manifest?.dependencies?.[name] !== version) failures.push(`${path}: expected ${name} ${version}`)
    }
    if (failures.length) throw new Error(`UI artifacts/dependencies are stale:\n${failures.map(failure => `- ${failure}`).join("\n")}`)
    return
  }
  // All validation and rendering has completed before even set can write its source.
  if (command === "set") await writeFile(resolve(root, sourceFile), source)
  for (const [path, content] of outputs) {
    await mkdir(dirname(resolve(root, path)), { recursive: true })
    await writeFile(resolve(root, path), content)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await run(process.argv[2] ?? "sync", process.argv[3]) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
