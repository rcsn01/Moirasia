import assert from "node:assert/strict"
import test from "node:test"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, dirname } from "node:path"
import { spawnSync } from "node:child_process"
import { buildOutputs, run, workspaceDir } from "../scripts/preset.mjs"
import { resolveFoundation, resolveProducts, tokenVars } from "../scripts/foundation.mjs"
import { colorToSrgb } from "../scripts/colors.mjs"
import { modeValues } from "../scripts/adapters/css.mjs"
const json = async path => JSON.parse(await readFile(resolve(workspaceDir, path), "utf8"))
const source = await json("packages/design-system/preset.source.json")
const foundation = await json("packages/design-system/foundation.tokens.json")
const products = await json("packages/design-system/product-tokens.json")
const compatibility = await json("packages/design-system/test/fixtures/compatibility.json")
const reference = await json("packages/design-system/test/fixtures/react-reference.json")
const outputs = buildOutputs(source, foundation, products)

test("React reference is byte-stable and all adapters share resolved semantic data", () => {
  for (const [path, content] of Object.entries(reference)) assert.equal(outputs.get(path), content, path)
  const resolved = resolveFoundation(foundation)
  const swift = outputs.get("packages/ui-swift/Sources/MoirasiaUI/MoiraTokens.swift")
  for (const mode of ["light", "dark"]) {
    const values = modeValues(resolved, mode)
    for (const [name, role] of Object.entries(resolved.web.colorRoles)) {
      assert.equal(values[`moira-color-${role}`], resolved.semantic[mode].color[role].$value, name)
      assert.ok(outputs.get("packages/ui-react/src/generated/preset.css").includes(`--${name}: ${values[`moira-color-${role}`]};`))
    }
    for (const name of compatibility.swift.MoiraColor) {
      const role = name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
      const match = new RegExp(`public static let ${name} = dynamic\\(light: RGB\\(([^)]+)\\), dark: RGB\\(([^)]+)\\)\\)`).exec(swift)
      assert.ok(match, name)
      const actual = match[mode === "light" ? 1 : 2].split(",").map(Number)
      const expected = colorToSrgb(resolved.semantic[mode].color[role].$value)
      actual.forEach((channel, index) => assert.ok(Math.abs(channel - expected[index]) <= 0.000000005, `${mode}.${name}[${index}]`))
    }
  }
  assert.match(swift, /self.red = red/)
  assert.match(swift, /\.system\(\.body, design: design\)\.weight\(weight\)/)
  assert.match(swift, /\.system\(size: 15, weight: weight, design: design\)/)
  assert.match(swift, /normal: Double = 0.18/)
  const fixed = swift.split("public enum MoiraExithibition")[1].split("private struct RGB")[0]
  assert.doesNotMatch(fixed, /dynamic\(/)
  assert.match(fixed, /windowBackground = color\(/)
})

test("web typography uses Actor for main text and preserves JetBrains Mono for code", () => {
  const react = outputs.get("packages/ui-react/src/generated/preset.css")
  const css = outputs.get("packages/ui-css/foundation.css")
  assert.ok(react.includes('--font-sans: "Actor", ui-sans-serif, system-ui, sans-serif;'))
  assert.ok(css.includes('--moira-font-family-sans: "Actor", ui-sans-serif, system-ui, sans-serif;'))
  assert.ok(react.includes('--font-mono: "JetBrains Mono Variable", ui-monospace, monospace;'))
  assert.ok(css.includes('--moira-font-family-mono: "JetBrains Mono Variable", ui-monospace, monospace;'))
  assert.ok(css.includes('@import "@fontsource/actor";'))
})

test("all legacy CSS names and Swift exports remain available", () => {
  const allCss = [...outputs].filter(([path]) => path.endsWith(".css") && path.includes("ui-css")).map(([, content]) => content).join("\n")
  const names = new Set([...allCss.matchAll(/(--moira-[\w-]+)\s*:/g)].map(match => match[1]))
  for (const [path, expected] of Object.entries(compatibility)) if (path !== "swift") for (const name of expected) assert.ok(names.has(name), `${path}: ${name}`)
  const swift = outputs.get("packages/ui-swift/Sources/MoirasiaUI/MoiraTokens.swift")
  for (const [type, expected] of Object.entries(compatibility.swift)) {
    const body = swift.split(`public enum ${type} {`)[1].split("\n}")[0]
    for (const name of expected) assert.match(body, new RegExp(`public static (?:let|func) ${name}\\b`))
  }
})

test("fixed-mode product CSS overrides all appearance-sensitive roles, not only color-scheme", () => {
  const resolved = resolveFoundation(foundation)
  for (const [name, mode] of [["litemaptica", "dark"], ["mini-nsw", "light"], ["exithibition", "dark"]]) {
    const css = outputs.get(`packages/ui-css/themes/${name}.css`)
    assert.match(css, new RegExp(`color-scheme: ${mode}`))
    const declarations = new Map([...css.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2]]))
    for (const [role, value] of Object.entries(modeValues(resolved, mode))) assert.equal(declarations.get(role), value, `${name}.${role}`)
    if (name === "exithibition") {
      assert.equal(declarations.get("moira-color-telemetry-focus"), products.product.exithibition.dark.color.focus.$value)
      assert.equal(declarations.get("moira-color-telemetry-selected"), products.product.exithibition.dark.color.selected.$value)
    }
    assert.doesNotMatch(css, /--moira-(?:radius|font|motion|space)-/)
  }
  const domain = tokenVars(resolveProducts(products).litemaptica.base.color, "moira-color-")
  assert.equal(domain["moira-color-confidence-high"], "#4acd76")
})

test("one authored shared-role change reaches all three adapters", () => {
  const changed = structuredClone(foundation)
  changed.semantic.light.color.canvas.$value = "#123456"
  const generated = buildOutputs(source, changed, products)
  assert.ok(generated.get("packages/ui-react/src/generated/preset.css").includes("--background: #123456;"))
  assert.ok(generated.get("packages/ui-css/foundation.css").includes("--moira-color-canvas: #123456;"))
  assert.ok(generated.get("packages/ui-swift/Sources/MoirasiaUI/MoiraTokens.swift").includes("RGB(0.07058824, 0.20392157, 0.3372549, 1)"))
})

async function isolated(callback) {
  const root = await mkdtemp(resolve(tmpdir(), "moirasia-foundation-test-"))
  try {
    await cp(resolve(workspaceDir, "packages/design-system"), resolve(root, "packages/design-system"), { recursive: true, filter: path => !path.includes("node_modules") })
    for (const path of ["packages/ui-react/package.json", "packages/ui-css/package.json", "apps/standalone/Vox/package.json"]) {
      await mkdir(dirname(resolve(root, path)), { recursive: true })
      await cp(resolve(workspaceDir, path), resolve(root, path))
    }
    await callback(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

test("sync/check/set are deterministic, idempotent, read-only on check and invalid input", async () => isolated(async root => {
  await run("sync", undefined, root)
  await run("check", undefined, root)
  const paths = [...outputs.keys(), "packages/design-system/preset.source.json"]
  const contents = async () => Promise.all(paths.map(path => readFile(resolve(root, path), "utf8")))
  const before = await contents()
  await run("sync", undefined, root)
  assert.deepEqual(await contents(), before)
  await run("set", source.code, root)
  assert.deepEqual(await contents(), before)
  await assert.rejects(run("set", "not-a-preset", root), /Invalid shadcn/)
  const unsupported = { ...source, code: "a" }
  // This code round-trips in the pinned decoder but doesn't match supported fields.
  const { encodePreset, decodePreset } = await import("shadcn/preset")
  unsupported.code = encodePreset({ ...decodePreset(source.code), font: "geist" })
  await assert.rejects(run("set", unsupported.code, root), /not supported/)
  assert.deepEqual(await contents(), before)
  const foundationPath = resolve(root, "packages/design-system/foundation.tokens.json")
  const invalid = structuredClone(foundation)
  invalid.semantic.dark.color.canvas.$value = "var(--nope)"
  await writeFile(foundationPath, JSON.stringify(invalid))
  await assert.rejects(run("sync", undefined, root), /Unsupported color/)
  await assert.rejects(run("set", source.code, root), /Unsupported color/)
  assert.deepEqual(await contents(), before)
  assert.equal(await readFile(foundationPath, "utf8"), JSON.stringify(invalid))
}))

test("check reports every missing/stale output and dependency mismatch without writing", async () => isolated(async root => {
  await run("sync", undefined, root)
  for (const [index, path] of [...outputs.keys()].entries()) {
    if (index % 2) await rm(resolve(root, path))
    else await writeFile(resolve(root, path), "corrupted")
  }
  await writeFile(resolve(root, "packages/ui-css/package.json"), "{}")
  await assert.rejects(run("check", undefined, root), error => {
    for (const path of outputs.keys()) assert.ok(error.message.includes(path))
    assert.ok(error.message.includes("expected @fontsource-variable/jetbrains-mono ^5.3.0"))
    assert.ok(error.message.includes("expected @fontsource/actor ^5.3.0"))
    return true
  })
  for (const [index, path] of [...outputs.keys()].entries()) {
    if (index % 2) await assert.rejects(readFile(resolve(root, path)), { code: "ENOENT" })
    else assert.equal(await readFile(resolve(root, path), "utf8"), "corrupted")
  }
}))

test("CLI check works outside the workspace; importing generation has no CLI side effects", () => {
  const script = resolve(workspaceDir, "packages/design-system/scripts/preset.mjs")
  const result = spawnSync(process.execPath, [script, "check"], { cwd: tmpdir(), encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  const imported = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(new URL("../scripts/preset.mjs", import.meta.url).href)})`, "unsupported"], { cwd: tmpdir(), encoding: "utf8" })
  assert.equal(imported.status, 0, imported.stderr)
})
