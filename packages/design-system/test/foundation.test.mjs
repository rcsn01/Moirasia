import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { resolveFoundation, resolveProducts, dimensionPoints } from "../scripts/foundation.mjs"
import { colorToSrgb, opaqueColor } from "../scripts/colors.mjs"
const authored = JSON.parse(await readFile(new URL("../foundation.tokens.json", import.meta.url)))
const products = JSON.parse(await readFile(new URL("../product-tokens.json", import.meta.url)))
const mutate = callback => { const input = structuredClone(authored); callback(input); return input }

for (const [name, change, message] of [
  ["missing role", input => delete input.semantic.light.color.canvas, /light.color.canvas: missing/],
  ["missing dark mode", input => delete input.semantic.dark, /semantic.dark: missing/],
  ["unknown mode", input => input.semantic.auto = {}, /semantic.auto: unsupported/],
  ["unknown reference", input => input.semantic.light.color.canvas.$value = "{primitive.color.nope}", /primitive.color.nope: unknown/],
  ["cyclic reference", input => input.semantic.light.color.canvas.$value = "{semantic.light.color.canvas}", /cyclic/],
  ["cross-token cycle", input => { input.semantic.light.color.canvas.$value = "{semantic.light.color.surface}"; input.semantic.light.color.surface.$value = "{semantic.light.color.canvas}" }, /cyclic/],
  ["unsupported color", input => input.semantic.dark.color.canvas.$value = "var(--unknown)", /dark.color.canvas: Unsupported/],
  ["out-of-range color", input => input.semantic.dark.color.canvas.$value = "rgba(256, 0, 0, 1)", /out of range/],
  ["unsupported unit", input => input.primitive.space[1].$value.unit = "em", /primitive.space.1: unsupported/],
  ["negative duration", input => input.primitive.motion.fast.$value.value = -1, /unsupported duration/],
  ["bad role mapping", input => input.web.colorRoles.background = "missing", /web.colorRoles.background: unknown/],
  ["unsafe font syntax", input => input.primitive.font.family.sans.$value = "sans; color: red", /invalid font family/],
  ["font comment", input => input.primitive.font.family.sans.$value = "foo/*", /invalid font family/],
  ["unterminated font quote", input => input.primitive.font.family.sans.$value = '"JetBrains Mono Variable', /invalid font family/],
  ["conversion overflow", input => input.semantic.light.color.canvas.$value = "oklch(0.5 1e308 0)", /conversion overflow/],
  ["translucent window canvas", input => input.semantic.light.color.canvas.$value = "rgba(255, 255, 255, 0.5)", /must be opaque/],
  ["wrong spacing type", input => { input.primitive.space.$type = "duration"; input.primitive.space[1].$value.unit = "ms" }, /expected dimension type/],
  ["invalid opacity", input => input.primitive.opacity.disabled.$value = 1.2, /invalid opacity/],
  ["missing native policy", input => delete input.native.typeStyles.body, /native.typeStyles.body/],
  ["small touch target", input => input.primitive.control.height.touch.$value.value = 32, /below native touch minimum/]
]) test(`foundation rejects ${name} with a document/path error`, () => assert.throws(() => resolveFoundation(mutate(change)), message))

test("resolution is complete, immutable and preserves references' semantic values", () => {
  const before = structuredClone(authored)
  const foundation = resolveFoundation(authored)
  assert.deepEqual(authored, before)
  for (const mode of ["light", "dark"]) {
    const roles = foundation.semantic[mode].color
    assert.notEqual(roles.surface.$value, roles.canvas.$value)
    assert.equal(roles["window-background"].$value, roles.canvas.$value)
    for (const [name, node] of Object.entries(roles)) if (!name.startsWith("$")) assert.equal(colorToSrgb(node.$value).length, 4)
  }
  assert.equal(dimensionPoints({ $value: { value: 0.625, unit: "rem" } }, foundation), 10)
  assert.equal(foundation.primitive.control.height.touch.$value.value, 44)
})

test("all product groups are complete and reject structural overrides and unsupported modes", () => {
  assert.equal(Object.keys(resolveProducts(products)).length, 7)
  for (const name of Object.keys(products.product)) {
    const input = structuredClone(products)
    const mode = Object.keys(input.product[name]).find(key => !key.startsWith("$"))
    input.product[name][mode].color.typography = { $value: "#000000" }
    assert.throws(() => resolveProducts(input), /typography: unsupported/)
    delete input.product[name][mode].color.typography
    delete input.product[name][mode].color[Object.keys(input.product[name][mode].color).find(key => !key.startsWith("$"))]
    assert.throws(() => resolveProducts(input), /missing required role/)
  }
  const input = structuredClone(products)
  input.product.exithibition.base = input.product.exithibition.dark
  assert.throws(() => resolveProducts(input), /exithibition.base: unsupported/)
  delete input.product.exithibition.base
  input.product["mini-nsw"].$extensions["moirasia.themePolicy"] = "dark"
  assert.throws(() => resolveProducts(input), /expected theme policy light/)
})

function close(actual, expected, tolerance = 0.000002) {
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= tolerance, `${actual} != ${expected}`))
}
test("CSS Color 4 conversion fixtures include black/white, primaries, alpha and gamut clipping", () => {
  close(colorToSrgb("oklch(0 0 0)"), [0, 0, 0, 1])
  close(colorToSrgb("oklch(1 0 0)"), [1, 1, 1, 1])
  // CSS Color 4 sample conversions, OKLCH equivalents of sRGB red/green/blue.
  close(colorToSrgb("oklch(0.6279553606 0.2576833077 29.2338851923)"), [1, 0, 0, 1])
  close(colorToSrgb("oklch(0.8664396115 0.2948272403 142.4953388878)"), [0, 1, 0, 1])
  close(colorToSrgb("oklch(0.4520137184 0.3132143717 264.0520206381)"), [0, 0, 1, 1])
  close(colorToSrgb("oklch(1 0 0 / 10%)"), [1, 1, 1, 0.1])
  close(colorToSrgb("#ff000080"), [1, 0, 0, 128 / 255])
  close(colorToSrgb("rgba(0, 128, 255, 0.25)"), [0, 128 / 255, 1, 0.25])
  assert.equal(colorToSrgb("oklch(0.7 0.5 30)")[0], 1)
  assert.equal(colorToSrgb("oklch(0.7 0.5 30)")[1], 0)
  assert.throws(() => colorToSrgb("oklch(0.5 1e308 0)"), /overflow/)
  assert.ok(colorToSrgb("oklch(0.5 0.1 1e308)").every(Number.isFinite))
  close(opaqueColor("rgba(255, 255, 255, 0.1)", "#000000"), [0.1, 0.1, 0.1, 1])
  assert.throws(() => opaqueColor("#ffffff", "rgba(0, 0, 0, 0.5)"), /opaque surface/)
  for (const color of ["oklch(2 0 0)", "oklch(0.5 -1 0)", "oklch(0.5 0 0 / 101%)", "rgba(1, 2, 3, -1)", "color-mix(in oklab, red, blue)"]) assert.throws(() => colorToSrgb(color))
})
