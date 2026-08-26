import { readdir, readFile } from "node:fs/promises"
import { extname, resolve } from "node:path"

const workspace = resolve(import.meta.dirname, "..")
const rendererRoots = [
  "src/renderer",
  "apps/Amove/src/renderer",
  "apps/Vox/src/renderer",
  "apps/Exithibition/src/renderer",
  "apps/Bonded/src/renderer",
  "apps/Orbis/src/renderer"
]
const coreVariables = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border", "input", "ring", "radius", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5"]
const coreDefinition = new RegExp(`--(?:${coreVariables.join("|")}):\\s*`)
const presetLiterals = ["oklch(0.147 0.004 49.25)", "oklch(0.216 0.006 56.043)", "oklch(0.985 0.001 106.423)", "JetBrains Mono Variable", "Geist Variable"]
const failures = []
const unscopedShellElements = /^(?:aside|nav|header|main|button|input|select|textarea|a)(?=$|[\s.#:[>+~])/i

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
    if (path.endsWith(".css") && !path.includes("/renderer/shelf/")) {
      for (const match of content.matchAll(/(?:^|})([^{}]+)\{/gm)) {
        const selectors = match[1].trim()
        if (selectors.startsWith("@")) continue
        for (const selector of selectors.split(",").map((value) => value.trim())) {
          if (unscopedShellElements.test(selector)) failures.push(`${path}: unscoped ${selector.split(/[\s.#:[>+~]/, 1)[0]} selector can override the shared shell`)
        }
      }
    }
  }
}

const requiredImports = new Map([
  ["apps/Amove/src/renderer/main/main.css", "@moirasia/ui-react/products/amove.css"],
  ["apps/Amove/src/renderer/shelf/shelf.css", "@moirasia/ui-react/products/amove.css"],
  ["apps/Vox/src/renderer/styles.css", "@moirasia/ui-react/products/vox.css"],
  ["apps/Exithibition/src/renderer/styles.css", "@moirasia/ui-react/products/exithibition.css"],
  ["apps/Orbis/src/renderer/styles.css", "@moirasia/desktop-shell/styles.css"],
  ["apps/Bonded/src/renderer/styles.css", "@moirasia/ui-react/products/bonded.css"]
])
for (const [relativePath, expected] of requiredImports) {
  const content = await readFile(resolve(workspace, relativePath), "utf8")
  if (!content.includes(expected)) failures.push(`${relativePath}: missing ${expected}`)
  if (!content.includes("@source")) failures.push(`${relativePath}: missing renderer-owned Tailwind @source declaration`)
}

const embeddedStyleEntrypoints = [
  ["apps/Amove/src/renderer/main/main.css", ".amove-feature-panel"],
  ["apps/Exithibition/src/renderer/styles.css", ".exithibition-feature-panel"],
  ["apps/Orbis/src/renderer/styles.css", ".orbis-feature-panel"]
]
for (const [relativePath, prefix] of embeddedStyleEntrypoints) {
  const content = await readFile(resolve(workspace, relativePath), "utf8")
  for (const match of content.matchAll(/(?:^|})([^{}]+)\{/gm)) {
    let selectors = match[1].trim()
    if (selectors.includes(";")) selectors = selectors.split(";").at(-1)?.trim() ?? ""
    if (!selectors || selectors.startsWith("@")) continue
    for (const selector of selectors.split(",").map((value) => value.trim())) {
      if (/^(?:html|body|#root)(?:$|[\s.#:[>+~])/.test(selector) || /\.(?:loading|setting-row|workspace)(?:$|[\s.#:[>+~])/.test(selector)) {
        failures.push(`${relativePath}: document or generic embedded selector is not allowed: ${selector}`)
      } else if (!selector.startsWith(prefix)) {
        failures.push(`${relativePath}: selector is outside ${prefix}: ${selector}`)
      }
    }
  }
}
const shellStyles = await readFile(resolve(workspace, "src/renderer/shell/styles.css"), "utf8")
for (const entry of ["../../../apps/Amove/src/renderer/main/main.css", "../../../apps/Exithibition/src/renderer/styles.css", "../../../apps/Orbis/src/renderer/styles.css"]) {
  if (!shellStyles.includes(entry)) failures.push(`src/renderer/shell/styles.css: missing scoped feature import ${entry}`)
}

const voxStyles = await readFile(resolve(workspace, "apps/Vox/src/renderer/styles.css"), "utf8")
for (const [index, line] of voxStyles.split("\n").entries()) {
  if (line.includes("--vox-color-") && !/privacy-dot|notice|hero-orb|status-light|model-state|simple-list|overlay-shell|overlay-orb|wave/.test(line)) {
    failures.push(`apps/Vox/src/renderer/styles.css:${index + 1}: product color is outside an allowed voice/status visualization or overlay`)
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

const bondedStylesPath = "apps/Bonded/src/renderer/styles.css"
const bondedStyles = await readFile(resolve(workspace, bondedStylesPath), "utf8")
for (const match of bondedStyles.matchAll(/(?:^|})([^{}]+)\{([^{}]*)\}/gm)) {
  const selectors = match[1].trim()
  const body = match[2]
  if (body.includes("--bonded-color-") && !/\.status|\.active-badge|\.inactive-badge|\.firewall|\.migration-notice|\.unenforced-badge|\.missing-label|\.protocol|\.retry-bar|\.error-banner|\.notice/.test(selectors)) {
    failures.push(`${bondedStylesPath}: ${selectors}: product color is outside a protocol/status indicator`)
  }
}

const productTokens = JSON.parse(await readFile(resolve(workspace, "packages/design-system/product-tokens.json"), "utf8")).product
const allowedTokens = {
  vox: new Set(["signal", "signal-strong", "signal-soft", "signal-glow", "overlay", "danger"]),
  exithibition: new Set(["cool", "warm", "hot", "load-low", "load-high", "focus", "selected", "battery", "storage", "fan"]),
  bonded: new Set(["status-active", "status-warning", "status-inactive", "status-danger", "protocol-tcp", "protocol-udp", "protocol-quic"])
}
for (const [product, allowed] of Object.entries(allowedTokens)) {
  for (const [mode, group] of Object.entries(productTokens[product])) {
    if (mode.startsWith("$")) continue
    for (const token of Object.keys(group.color).filter((key) => key !== "$type")) if (!allowed.has(token)) failures.push(`packages/design-system/product-tokens.json: ${product}.${mode}.${token} is not a visualization token`)
  }
}
for (const mode of Object.keys(productTokens.amove).filter((key) => !key.startsWith("$") && key !== "shelf")) failures.push(`packages/design-system/product-tokens.json: amove.${mode} is structural; only the bespoke shelf may own product colors`)

if (failures.length) {
  console.error(`UI ownership check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`)
  process.exitCode = 1
} else console.log("UI ownership check passed")
