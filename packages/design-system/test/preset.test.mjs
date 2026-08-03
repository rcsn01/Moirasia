import assert from "node:assert/strict"
import test from "node:test"
import { execFileSync, spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { decodePreset, encodePreset, isValidPreset } from "shadcn/preset"

const packageDir = resolve(import.meta.dirname, "..")

test("the authoritative preset decodes without fallback fields", async () => {
  const source = (await import("../preset.source.json", { with: { type: "json" } })).default
  assert.equal(isValidPreset(source.code), true)
  const decoded = decodePreset(source.code)
  assert.deepEqual(decoded, { menuColor: "default-translucent", menuAccent: "subtle", radius: "medium", font: "jetbrains-mono", iconLibrary: "lucide", theme: "stone", baseColor: "stone", style: "mira", chartColor: "stone", fontHeading: "inherit" })
  assert.equal(encodePreset(decoded), source.code)
})

test("committed generated artifacts have no drift", () => {
  execFileSync(process.execPath, ["scripts/preset.mjs", "check"], { cwd: packageDir, stdio: "pipe" })
})

test("invalid codes are rejected without changing the source", async () => {
  assert.equal(isValidPreset("not-a-preset"), false)
  const sourcePath = resolve(packageDir, "preset.source.json")
  const before = await readFile(sourcePath, "utf8")
  const result = spawnSync(process.execPath, ["scripts/preset.mjs", "set", "not-a-preset"], { cwd: packageDir, encoding: "utf8" })
  assert.notEqual(result.status, 0)
  assert.equal(await readFile(sourcePath, "utf8"), before)
})
