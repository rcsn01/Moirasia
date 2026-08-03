import { readdir, readFile } from "node:fs/promises"
import { extname, resolve } from "node:path"

const workspace = resolve(import.meta.dirname, "..")
const rendererRoots = [
  "src/renderer",
  "apps/Amove/src/renderer",
  "apps/Vox/src/renderer",
  "apps/Exithibition/src/renderer"
]
const coreVariables = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border", "input", "ring", "radius", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5"]
const coreDefinition = new RegExp(`--(?:${coreVariables.join("|")}):\\s*`)
const presetLiterals = ["oklch(0.147 0.004 49.25)", "oklch(0.216 0.006 56.043)", "oklch(0.985 0.001 106.423)", "JetBrains Mono Variable", "Geist Variable"]
const failures = []

async function filesBelow(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "out" || entry.name === "dist" || entry.name === "release") continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) result.push(...await filesBelow(path))
    else if ([".css", ".ts", ".tsx"].includes(extname(entry.name))) result.push(path)
  }
  return result
}

for (const root of rendererRoots) {
  for (const path of await filesBelow(resolve(workspace, root))) {
    const content = await readFile(path, "utf8")
    if (coreDefinition.test(content)) failures.push(`${path}: redefines a core shadcn variable`)
    for (const literal of presetLiterals) if (content.includes(literal)) failures.push(`${path}: duplicates preset literal ${literal}`)
  }
}

const requiredImports = new Map([
  ["apps/Amove/src/renderer/main/main.css", "@moirasia/ui-react/products/amove.css"],
  ["apps/Amove/src/renderer/shelf/shelf.css", "@moirasia/ui-react/products/amove.css"],
  ["apps/Vox/src/renderer/styles.css", "@moirasia/ui-react/products/vox.css"],
  ["apps/Exithibition/src/renderer/styles.css", "@moirasia/ui-react/products/exithibition.css"]
])
for (const [relativePath, expected] of requiredImports) {
  const content = await readFile(resolve(workspace, relativePath), "utf8")
  if (!content.includes(expected)) failures.push(`${relativePath}: missing ${expected}`)
  if (!content.includes("@source")) failures.push(`${relativePath}: missing renderer-owned Tailwind @source declaration`)
}

const voxStyles = await readFile(resolve(workspace, "apps/Vox/src/renderer/styles.css"), "utf8")
if (/--vox-color-(?:canvas|panel|panel-raised|line|text-muted|window-background)\b/.test(voxStyles)) {
  failures.push("apps/Vox/src/renderer/styles.css: product palette is applied to general page chrome")
}
for (const [index, line] of voxStyles.split("\n").entries()) {
  if (line.includes("--vox-color-signal") && !/privacy-dot|hands-free\.active|notice|hero-orb|status-light|model-state|simple-list|overlay-orb|wave/.test(line)) {
    failures.push(`apps/Vox/src/renderer/styles.css:${index + 1}: signal color is outside an allowed voice/status visualization`)
  }
}

for (const relativePath of ["apps/Exithibition/src/renderer/styles.css", "apps/Exithibition/src/renderer/App.tsx"]) {
  const content = await readFile(resolve(workspace, relativePath), "utf8")
  for (const [index, line] of content.split("\n").entries()) {
    if (line.includes("--exithibition-color-") && !/legend|hardware-component|kind-|chartConfig/.test(line)) {
      failures.push(`${relativePath}:${index + 1}: telemetry color is outside a telemetry visualization`)
    }
  }
}

if (failures.length) {
  console.error(`UI ownership check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`)
  process.exitCode = 1
} else console.log("UI ownership check passed")
