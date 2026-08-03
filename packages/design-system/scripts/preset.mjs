import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { decodePreset, encodePreset, isValidPreset } from "shadcn/preset"

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceDir = resolve(packageDir, "../..")
const sourcePath = resolve(packageDir, "preset.source.json")
const productPath = resolve(packageDir, "product-tokens.json")
const lockPath = resolve(packageDir, "preset.lock.json")
const command = process.argv[2] ?? "sync"

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

const CORE_LIGHT = {
  background: "oklch(1 0 0)", foreground: "oklch(0.147 0.004 49.25)", card: "oklch(1 0 0)", "card-foreground": "oklch(0.147 0.004 49.25)", popover: "oklch(1 0 0)", "popover-foreground": "oklch(0.147 0.004 49.25)", primary: "oklch(0.216 0.006 56.043)", "primary-foreground": "oklch(0.985 0.001 106.423)", secondary: "oklch(0.97 0.001 106.424)", "secondary-foreground": "oklch(0.216 0.006 56.043)", muted: "oklch(0.97 0.001 106.424)", "muted-foreground": "oklch(0.553 0.013 58.071)", accent: "oklch(0.97 0.001 106.424)", "accent-foreground": "oklch(0.216 0.006 56.043)", destructive: "oklch(0.577 0.245 27.325)", border: "oklch(0.923 0.003 48.717)", input: "oklch(0.923 0.003 48.717)", ring: "oklch(0.709 0.01 56.259)", "chart-1": "oklch(0.869 0.005 56.366)", "chart-2": "oklch(0.553 0.013 58.071)", "chart-3": "oklch(0.444 0.011 73.639)", "chart-4": "oklch(0.374 0.01 67.558)", "chart-5": "oklch(0.268 0.007 34.298)", sidebar: "oklch(0.985 0.001 106.423)", "sidebar-foreground": "oklch(0.147 0.004 49.25)", "sidebar-primary": "oklch(0.216 0.006 56.043)", "sidebar-primary-foreground": "oklch(0.985 0.001 106.423)", "sidebar-accent": "oklch(0.97 0.001 106.424)", "sidebar-accent-foreground": "oklch(0.216 0.006 56.043)", "sidebar-border": "oklch(0.923 0.003 48.717)", "sidebar-ring": "oklch(0.709 0.01 56.259)"
}

const CORE_DARK = {
  background: "oklch(0.147 0.004 49.25)", foreground: "oklch(0.985 0.001 106.423)", card: "oklch(0.216 0.006 56.043)", "card-foreground": "oklch(0.985 0.001 106.423)", popover: "oklch(0.216 0.006 56.043)", "popover-foreground": "oklch(0.985 0.001 106.423)", primary: "oklch(0.923 0.003 48.717)", "primary-foreground": "oklch(0.216 0.006 56.043)", secondary: "oklch(0.268 0.007 34.298)", "secondary-foreground": "oklch(0.985 0.001 106.423)", muted: "oklch(0.268 0.007 34.298)", "muted-foreground": "oklch(0.709 0.01 56.259)", accent: "oklch(0.268 0.007 34.298)", "accent-foreground": "oklch(0.985 0.001 106.423)", destructive: "oklch(0.704 0.191 22.216)", border: "oklch(1 0 0 / 10%)", input: "oklch(1 0 0 / 15%)", ring: "oklch(0.553 0.013 58.071)", "chart-1": "oklch(0.869 0.005 56.366)", "chart-2": "oklch(0.553 0.013 58.071)", "chart-3": "oklch(0.444 0.011 73.639)", "chart-4": "oklch(0.374 0.01 67.558)", "chart-5": "oklch(0.268 0.007 34.298)", sidebar: "oklch(0.216 0.006 56.043)", "sidebar-foreground": "oklch(0.985 0.001 106.423)", "sidebar-primary": "oklch(0.488 0.243 264.376)", "sidebar-primary-foreground": "oklch(0.985 0.001 106.423)", "sidebar-accent": "oklch(0.268 0.007 34.298)", "sidebar-accent-foreground": "oklch(0.985 0.001 106.423)", "sidebar-border": "oklch(1 0 0 / 10%)", "sidebar-ring": "oklch(0.553 0.013 58.071)"
}

function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n` }
function hash(value) { return createHash("sha256").update(value).digest("hex") }
function cssVars(values, prefix = "") { return Object.entries(values).map(([key, value]) => `  --${prefix}${key}: ${value};`).join("\n") }
function valueOf(node) { return node.$value }
function tokenVars(node, prefix) {
  const values = {}
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$")) continue
    if (child && typeof child === "object" && "$value" in child) values[`${prefix}${key}`] = valueOf(child)
    else Object.assign(values, tokenVars(child, `${prefix}${key}-`))
  }
  return values
}

function validateSource(source) {
  if (source.primitiveBase !== "base-ui" || source.tailwindVersion !== 4 || source.cssVariables !== true || source.shadcnVersion !== "4.16.1") throw new Error("Unsupported preset source metadata")
  if (!isValidPreset(source.code)) throw new Error(`Invalid shadcn preset code: ${source.code}`)
  const decoded = decodePreset(source.code)
  if (!decoded || encodePreset(decoded) !== source.code) throw new Error("Preset did not round-trip through the pinned decoder")
  for (const [key, value] of Object.entries(EXPECTED)) if (decoded[key] !== value) throw new Error(`Preset ${source.code} is not supported by this generated template (${key}: ${decoded[key]})`)
  return decoded
}

function presetCss() {
  const themeColors = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border", "input", "ring", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "sidebar", "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground", "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring"]
  const inline = themeColors.map((name) => `  --color-${name}: var(--${name});`).join("\n")
  return `/* Generated from shadcn preset bKZTOcpW. Do not edit. */
@custom-variant dark (&:is(.dark *));

@theme inline {
  --font-sans: "JetBrains Mono Variable", ui-monospace, monospace;
  --font-mono: "JetBrains Mono Variable", ui-monospace, monospace;
  --font-heading: var(--font-sans);
${inline}
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

:root {
  color-scheme: light;
  --radius: 0.625rem;
  --menu-background: color-mix(in oklab, var(--popover), transparent 12%);
  --menu-border: color-mix(in oklab, var(--border), transparent 18%);
  --menu-shadow: 0 16px 48px rgb(28 25 23 / 14%);
  --menu-backdrop-filter: blur(18px) saturate(1.12);
${cssVars(CORE_LIGHT)}
}

.dark {
  color-scheme: dark;
  --menu-background: color-mix(in oklab, var(--popover), transparent 14%);
  --menu-border: color-mix(in oklab, var(--border), transparent 12%);
  --menu-shadow: 0 18px 54px rgb(0 0 0 / 34%);
${cssVars(CORE_DARK)}
}

@layer base {
  * { @apply border-border outline-ring/50; }
  html { @apply font-mono; }
  body { @apply bg-background font-sans text-foreground antialiased; }
}
`
}

function productCss(name, product) {
  const header = `/* Generated ${name} product tokens. Do not edit. */\n`
  if (name === "amove") {
    const light = tokenVars(product.light, "amove-")
    const dark = tokenVars(product.dark, "amove-")
    const shelf = tokenVars(product.shelf, "amove-shelf-")
    return `${header}:root {\n${cssVars({ ...light, ...shelf })}\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n${cssVars(dark)}\n  }\n}\n`
  }
  if (name === "vox") {
    const light = tokenVars(product.light, "vox-")
    const dark = tokenVars(product.dark, "vox-")
    return `${header}:root {\n${cssVars(light)}\n}\n\n.dark {\n${cssVars(dark)}\n}\n`
  }
  return `${header}:root {\n  color-scheme: dark;\n${cssVars(tokenVars(product.base, `${name}-`))}\n}\n`
}

function componentsJson() {
  return stableJson({ "$schema": "https://ui.shadcn.com/schema.json", style: "base-mira", rsc: false, tsx: true, tailwind: { css: "src/styles.css", baseColor: "stone", cssVariables: true, prefix: "" }, iconLibrary: "lucide", aliases: { components: "#components", utils: "#lib/utils", ui: "#components", lib: "#lib", hooks: "#lib/hooks" }, rtl: false, menuColor: "default-translucent", menuAccent: "subtle", registries: {} })
}

function mainTokens(products) {
  const value = (product, mode, key) => products[product][mode].color[key].$value
  return `// Generated by @moirasia/design-system. Do not edit.\nexport const windowBackgrounds = {\n  moirasia: { light: "#ffffff", dark: "#1c1917" },\n  amove: { light: ${JSON.stringify(value("amove", "light", "window-background"))}, dark: ${JSON.stringify(value("amove", "dark", "window-background"))}, shelf: ${JSON.stringify(products.amove.shelf.color.canvas.$value)} },\n  vox: { light: ${JSON.stringify(value("vox", "light", "window-background"))}, dark: ${JSON.stringify(value("vox", "dark", "window-background"))} },\n  exithibition: { dark: ${JSON.stringify(value("exithibition", "base", "window-background"))} }\n} as const\n`
}

function buildOutputs(source, productTokens) {
  const decoded = validateSource(source)
  const products = productTokens.product
  const outputs = new Map([
    ["packages/ui-react/src/generated/preset.css", presetCss()],
    ["packages/ui-react/src/products/amove.css", productCss("amove", products.amove)],
    ["packages/ui-react/src/products/vox.css", productCss("vox", products.vox)],
    ["packages/ui-react/src/products/exithibition.css", productCss("exithibition", products.exithibition)],
    ["packages/ui-react/src/generated/tokens.ts", mainTokens(products)],
    ["packages/ui-react/components.json", componentsJson()]
  ])
  const hashes = Object.fromEntries([...outputs].map(([path, content]) => [path, hash(content)]))
  const lock = { presetCode: source.code, decoded, generator: "@moirasia/design-system@0.1.0", shadcnVersion: source.shadcnVersion, tailwindVersion: source.tailwindVersion, cssVariables: source.cssVariables, outputHash: hash(Object.entries(hashes).flat().join("\n")), outputs: hashes }
  outputs.set("packages/design-system/preset.lock.json", stableJson(lock))
  return outputs
}

async function inputs(sourceOverride) {
  const source = sourceOverride ?? JSON.parse(await readFile(sourcePath, "utf8"))
  const products = JSON.parse(await readFile(productPath, "utf8"))
  return { source, products }
}

async function sync(sourceOverride) {
  const { source, products } = await inputs(sourceOverride)
  const outputs = buildOutputs(source, products)
  if (sourceOverride) await writeFile(sourcePath, stableJson(source))
  for (const [relativePath, content] of outputs) {
    const outputPath = resolve(workspaceDir, relativePath)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, content)
  }
}

async function check() {
  const { source, products } = await inputs()
  const outputs = buildOutputs(source, products)
  const stale = []
  for (const [relativePath, content] of outputs) if (await readFile(resolve(workspaceDir, relativePath), "utf8").catch(() => "") !== content) stale.push(relativePath)
  if (stale.length) throw new Error(`Generated UI artifacts are stale:\n${stale.map((path) => `- ${path}`).join("\n")}`)
  const uiPackage = JSON.parse(await readFile(resolve(workspaceDir, "packages/ui-react/package.json"), "utf8"))
  if (uiPackage.dependencies?.["@fontsource-variable/jetbrains-mono"] !== "^5.3.0" || uiPackage.dependencies?.shadcn !== "4.16.1") throw new Error("ui-react preset dependencies are stale")
  const voxPackage = JSON.parse(await readFile(resolve(workspaceDir, "apps/Vox/package.json"), "utf8"))
  if (voxPackage.dependencies?.["@fontsource-variable/jetbrains-mono"] !== "^5.3.0") throw new Error("Vox local font dependency is stale")
}

if (command === "set") {
  const code = process.argv[3]
  if (!code) throw new Error("Usage: pnpm ui:preset:set <code>")
  const current = JSON.parse(await readFile(sourcePath, "utf8"))
  await sync({ ...current, code })
} else if (command === "sync") await sync()
else if (command === "check") await check()
else throw new Error(`Unknown preset command: ${command}`)
