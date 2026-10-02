import { colorToSrgb } from "./colors.mjs"

export const coreRoles = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border", "input", "ring", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "sidebar", "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground", "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring"]
const sharedColors = ["canvas", "canvas-deep", "surface", "surface-sunken", "surface-raised", "surface-overlay", "surface-overlay-strong", "text-primary", "text-muted", "text-subtle", "border", "border-strong", "control", "control-hover", "control-selected", "action-primary", "action-primary-hover", "action-primary-pressed", "action-primary-border", "text-on-action", "focus", "focus-soft", "success-surface", "success-text", "warning-surface", "warning-border", "warning-text", "danger-surface", "danger-text", "danger-action", "danger-action-hover", "text-on-danger", "window-background", "overlay", "overlay-subtle", "backdrop", "shadow", "hairline-light", "hairline-dark", "accent", "accent-muted", "accent-surface", "accent-surface-subtle", "accent-border", "accent-border-subtle", "accent-soft", "accent-glow"]
const requiredGroups = {
  "primitive.space": ["0", "1", "2", "3", "4", "5", "6", "7", "8", "10"],
  "primitive.radius": ["control", "card", "panel", "overlay", "pill"],
  "primitive.control.height": ["small", "medium", "large", "touch"],
  "primitive.motion": ["fast", "normal", "deliberate"],
  "primitive.font.family": ["sans", "mono"],
  "primitive.opacity": ["disabled"],
  "primitive.font.size": ["micro", "label", "detail", "compact", "caption", "small", "body", "body-large", "title-small", "title-medium", "title-large"]
}
export const productRoles = {
  amove: ["canvas", "surface", "surface-raised", "surface-overlay", "text-primary", "text-muted", "border", "control", "control-hover", "selection", "focus", "close", "close-mark", "document", "document-fold", "shadow"],
  vox: ["signal", "signal-strong", "signal-soft", "signal-glow", "overlay", "danger"],
  exithibition: ["cool", "warm", "hot", "load-low", "load-high", "focus", "selected", "battery", "storage", "fan"],
  bonded: ["status-active", "status-warning", "status-inactive", "status-danger", "protocol-tcp", "protocol-udp", "protocol-quic"],
  yn360: ["status-connected", "status-scan", "status-reconnect", "channel-red", "channel-green", "channel-blue", "channel-warm", "channel-cool"],
  litemaptica: ["confidence-high", "confidence-medium", "confidence-low"],
  "mini-nsw": ["timeline-marker"]
}
const keys = object => Object.keys(object).filter(key => !key.startsWith("$"))
const at = (document, path) => path.split(".").reduce((node, key) => node?.[key], document)
function fail(document, path, message) { throw new Error(`${document}: ${path}: ${message}`) }
function required(document, path, names, label, exact = false) {
  const group = at(document, path)
  if (!group || typeof group !== "object" || Array.isArray(group)) fail(label, path, "missing required group")
  for (const name of names) if (!Object.hasOwn(group, name)) fail(label, `${path}.${name}`, "missing required role")
  if (exact) for (const name of keys(group)) if (!names.includes(name)) fail(label, `${path}.${name}`, "unsupported role or mode")
}

// References remain DTCG-style {document.path}; resolve and validate before adapters run.
function resolveDocument(input, label) {
  const document = structuredClone(input)
  const active = new Set()
  const resolved = new Set()
  function resolveToken(path, type) {
    const node = at(document, path)
    if (!node || typeof node !== "object" || !Object.hasOwn(node, "$value")) fail(label, path, "unknown reference or missing token value")
    if (active.has(path)) fail(label, path, "cyclic reference")
    if (!resolved.has(path)) {
      active.add(path)
      const reference = typeof node.$value === "string" && /^\{([^{}]+)\}$/.exec(node.$value)
      if (reference) node.$value = structuredClone(resolveToken(reference[1], type).$value)
      active.delete(path)
      resolved.add(path)
    }
    try {
      const value = node.$value
      if (type === "color") colorToSrgb(value)
      else if (type === "dimension" || type === "duration") {
        const units = type === "dimension" ? ["px", "rem"] : ["ms"]
        if (!value || typeof value !== "object" || !Number.isFinite(value.value) || value.value < 0 || !units.includes(value.unit) || Object.keys(value).some(key => !["value", "unit"].includes(key))) throw new Error(`unsupported ${type}: ${JSON.stringify(value)}`)
      } else if (type === "number") {
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("invalid opacity")
      } else if (type === "shadow") {
        if (typeof value !== "string" || !/^(?:\d+(?:px)?\s+){3,4}rgba\([\d.,\s]+\)$/.test(value)) throw new Error("unsupported shadow")
      } else if (type === "fontFamily") {
        if (typeof value !== "string" || !value.split(",").every(name => /^(?:"[a-z0-9 _-]+"|'[a-z0-9 _-]+'|[a-z][a-z0-9 _-]*)$/i.test(name.trim()))) throw new Error("invalid font family")
      } else throw new Error(`unsupported token type ${type}`)
    } catch (error) { fail(label, path, error.message) }
    return node
  }
  function walk(group, path = "", inheritedType) {
    if (!group || typeof group !== "object" || Array.isArray(group)) fail(label, path, "expected token group")
    if (inheritedType && group.$type && group.$type !== inheritedType) fail(label, path, "token type differs from its group")
    const type = group.$type ?? inheritedType
    if (Object.hasOwn(group, "$value")) { resolveToken(path, type); return }
    for (const name of keys(group)) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) fail(label, `${path}.${name}`, "invalid token name")
      walk(group[name], path ? `${path}.${name}` : name, type)
    }
  }
  // Adapter policies aren't token groups, so walk only authored token sections.
  for (const section of ["primitive", "semantic", "product"]) if (document[section]) walk(document[section], section)
  return document
}

export function resolveFoundation(input) {
  const label = "foundation.tokens.json"
  for (const [path, names] of Object.entries(requiredGroups)) {
    required(input, path, names, label, true)
    const type = path.endsWith("family") ? "fontFamily" : path.endsWith("motion") ? "duration" : path.endsWith("opacity") ? "number" : "dimension"
    if (at(input, path).$type !== type) fail(label, `${path}.$type`, `expected ${type} type`)
  }
  required(input, "semantic", ["light", "dark"], label, true)
  for (const mode of ["light", "dark"]) required(input, `semantic.${mode}.color`, sharedColors, label)
  required(input, "web.colorRoles", coreRoles, label, true)
  for (const mode of ["light", "dark"]) if (input.semantic[mode].color.$type !== "color") fail(label, `semantic.${mode}.color.$type`, "expected color type")
  const foundation = resolveDocument(input, label)
  if (foundation.web.rootFontPixels !== 16) fail(label, "web.rootFontPixels", "expected explicit 16px rem-to-point mapping")
  const radius = foundation.web.radius
  if (radius?.$type !== "dimension" || !radius.$value || !Number.isFinite(radius.$value.value) || radius.$value.value < 0 || !["px", "rem"].includes(radius.$value.unit)) fail(label, "web.radius", "invalid web radius")
  for (const [name, role] of Object.entries(foundation.web.colorRoles)) {
    for (const mode of ["light", "dark"]) if (!foundation.semantic[mode].color[role]?.$value) fail(label, `web.colorRoles.${name}`, `unknown semantic role ${role}`)
  }
  for (const mode of ["light", "dark"]) {
    for (const role of ["canvas", "window-background"]) if (colorToSrgb(foundation.semantic[mode].color[role].$value)[3] !== 1) fail(label, `semantic.${mode}.color.${role}`, "window canvas roles must be opaque")
    required(foundation, `semantic.${mode}.shadow`, ["control", "hairline"], label, true)
    const menu = foundation.web.menu?.[mode]
    if (!menu || ![menu.backgroundTransparency, menu.borderTransparency].every(value => Number.isFinite(value) && value >= 0 && value <= 100) || typeof menu.shadow !== "string" || !/^\d+ \d+px \d+px rgb\(\d+ \d+ \d+ \/ \d+%\)$/.test(menu.shadow)) fail(label, `web.menu.${mode}`, "invalid menu policy")
  }
  if (![foundation.web.menu.blurPixels, foundation.web.menu.saturation].every(value => Number.isFinite(value) && value >= 0)) fail(label, "web.menu", "invalid filter dimensions")
  if (foundation.native?.fontFamily !== "system" || foundation.native.minimumTouchHeight < 44 || !Number.isFinite(foundation.native.minimumTouchHeight)) fail(label, "native", "native system fonts and minimum 44pt touch targets are required")
  for (const role of ["caption", "small", "body", "body-large", "title-small", "title-medium", "title-large"]) {
    if (!["caption", "footnote", "body", "title3", "title2", "largeTitle"].includes(foundation.native.typeStyles?.[role])) fail(label, `native.typeStyles.${role}`, "missing or unsupported native text style")
  }
  if (dimensionPoints(foundation.primitive.control.height.touch, foundation) < foundation.native.minimumTouchHeight) fail(label, "primitive.control.height.touch", "below native touch minimum")
  return foundation
}

export function resolveProducts(input) {
  const label = "product-tokens.json"
  required(input, "product", Object.keys(productRoles), label, true)
  for (const [name, roles] of Object.entries(productRoles)) {
    const modes = name === "amove" ? ["shelf"] : ["litemaptica", "mini-nsw"].includes(name) ? ["base"] : ["light", "dark"]
    required(input, `product.${name}`, modes, label, true)
    for (const mode of modes) {
      required(input, `product.${name}.${mode}`, ["color"], label, true)
      required(input, `product.${name}.${mode}.color`, roles, label, true)
      if (input.product[name][mode].color.$type !== "color") fail(label, `product.${name}.${mode}.color.$type`, "expected color type")
    }
    const policy = input.product[name].$extensions?.["moirasia.themePolicy"]
    const expected = name === "litemaptica" ? "dark" : name === "mini-nsw" ? "light" : "light-dark-system"
    if (policy !== expected) fail(label, `product.${name}.$extensions`, `expected theme policy ${expected}`)
  }
  return resolveDocument(input, label).product
}

export function cssValue(node) {
  const value = node.$value
  return typeof value === "object" ? `${value.value}${value.unit}` : String(value)
}
export function dimensionPoints(node, foundation) {
  return node.$value.value * (node.$value.unit === "rem" ? foundation.web.rootFontPixels : 1)
}
export function tokenVars(group, prefix = "") {
  const result = {}
  for (const name of keys(group)) {
    const node = group[name]
    if (Object.hasOwn(node, "$value")) result[`${prefix}${name}`] = cssValue(node)
    else Object.assign(result, tokenVars(node, `${prefix}${name}-`))
  }
  return result
}
export function cssVars(values, prefix = "") {
  return Object.entries(values).map(([name, value]) => `  --${prefix}${name}: ${value};`).join("\n")
}
