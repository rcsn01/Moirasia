import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createServer, preview } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { chromium } from "@playwright/test"
import { resolveFoundation } from "../../scripts/foundation.mjs"
import { colorToSrgb } from "../../scripts/colors.mjs"

const root = resolve(import.meta.dirname, "../../../..")
const evidence = resolve(root, "test-results/foundation-browser")
await mkdir(evidence, { recursive: true })
const foundation = resolveFoundation(JSON.parse(await readFile(resolve(root, "packages/design-system/foundation.tokens.json"), "utf8")))
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH })
const results = []
const fontFaces = page => page.evaluate(() => [...document.fonts].filter(font => font.family.includes("JetBrains Mono") && font.status === "loaded").length)
const cssRoles = page => page.evaluate(() => {
  const style = getComputedStyle(document.documentElement)
  return Object.fromEntries(["canvas", "surface", "text-primary", "danger-action", "warning-text", "focus", "shadow"].map(role => [role, style.getPropertyValue(`--moira-color-${role}`).trim()]))
})
async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready)
  assert.ok(await fontFaces(page) > 0, `${name}: bundled font did not load`)
  await page.screenshot({ path: resolve(evidence, `${name}.png`) })
}
async function withServer(options, callback, built = false) {
  const server = built ? await preview(options) : await createServer(options)
  if (!built) await server.listen()
  try { await callback(server.resolvedUrls.local[0]) }
  finally { if (built) await new Promise(resolve => server.httpServer.close(resolve)); else await server.close() }
}
try {
  await withServer({ root, configFile: false, plugins: [react(), tailwindcss()], optimizeDeps: { entries: ["packages/design-system/test/browser/index.html"] }, resolve: { dedupe: ["react", "react-dom"] }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" }, async url => {
    for (const route of ["reference", "shell", "standalone"]) for (const mode of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: mode })
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      await page.goto(`${url}packages/design-system/test/browser/index.html?route=${route}&mode=${mode}`)
      if (route === "reference") {
        await page.getByRole("button", { name: "Primary", exact: true }).waitFor()
        await page.getByRole("button", { name: "Outline", exact: true }).focus()
        const outline = await page.getByRole("button", { name: "Outline", exact: true }).evaluate(button => getComputedStyle(button).boxShadow)
        assert.notEqual(outline, "none", "keyboard focus has no ring")
        assert.equal(await page.getByRole("button", { name: "Disabled", exact: true }).isDisabled(), true)
        const scopes = await page.evaluate(() => Object.fromEntries(["outer-dark", "inner-light", "outer-light", "inner-dark"].map(id => [id, getComputedStyle(document.getElementById(id)).getPropertyValue("--background").trim()])))
        assert.equal(scopes["outer-dark"], scopes["inner-dark"])
        assert.equal(scopes["outer-light"], scopes["inner-light"])
        assert.notEqual(scopes["inner-dark"], scopes["inner-light"])
      } else {
        await page.getByText("Fixture browser", { exact: true }).waitFor()
        await page.getByRole("button", { expanded: false }).last().click()
        await page.getByText("example.test", { exact: true }).waitFor()
        if (route === "shell") {
          assert.equal(await page.getByRole("navigation", { name: "Moirasia sections" }).count(), 1)
          const roles = await page.locator(".bonded-feature-panel").evaluate(panel => ({ inner: getComputedStyle(panel).getPropertyValue("--background"), outer: getComputedStyle(document.documentElement).getPropertyValue("--background") }))
          assert.notEqual(roles.inner.trim(), roles.outer.trim(), "embedded feature failed to reset opposite appearance")
        } else {
          await page.getByRole("button", { name: "Settings", exact: true }).click()
          await page.getByRole("heading", { name: "Settings", exact: true }).waitFor()
        }
      }
      await capture(page, `${route}-${mode}`)
      assert.deepEqual(errors, [], `${route}-${mode}`)
      results.push({ context: `${route}-${mode}`, passed: true })
      await page.close()
    }
  })
  for (const [name, appRoot, outDir] of [["litemaptica", "apps/standalone/LiteMaptica", "dist"], ["mini-nsw", "apps/standalone/Mini-NSW/app", "out/renderer"]]) {
    for (const built of [false, true]) await withServer({ root: resolve(root, appRoot), configFile: false, build: { outDir }, server: { host: "127.0.0.1", port: 0 }, preview: { host: "127.0.0.1", port: 0 }, logLevel: "error", ...(name === "litemaptica" && !built ? { plugins: [react()] } : {}) }, async url => {
      let previous
      for (const colorScheme of ["light", "dark"]) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme })
        const errors = []
        page.on("pageerror", error => errors.push(error.message))
        await page.goto(url)
        await page.locator("canvas").waitFor()
        // Set preference before interactions: changing duration doesn't finish an active transition.
        await page.emulateMedia({ reducedMotion: "reduce" })
        if (name === "litemaptica") {
          await page.getByRole("button", { name: "Confidence", exact: true }).click()
          await page.getByRole("button", { name: "Block material", exact: true }).click()
          assert.equal(await page.getByRole("button", { name: "New project", exact: true }).isDisabled(), true)
          await page.keyboard.press("Tab")
          await page.getByRole("button", { name: "Confidence", exact: true }).focus()
          assert.equal(await page.getByRole("button", { name: "Confidence", exact: true }).evaluate(button => getComputedStyle(button).outlineStyle), "solid")
        } else {
          await page.locator("#speed input").first().waitFor({ state: "attached" })
          await page.locator("#play").click()
          assert.equal(await page.locator("#play").getAttribute("aria-label"), "Play simulation")
          await page.locator("#population-toggle").uncheck()
          await page.locator(".speed-option").first().click()
          assert.equal(await page.locator("#speed input").first().isChecked(), true)
          await page.mouse.move(900, 800)
          const selected = await page.locator(".speed-option").first().evaluate(label => ({ background: getComputedStyle(label).backgroundColor, text: getComputedStyle(label).color }))
          assert.deepEqual(colorToSrgb(selected.background), colorToSrgb(foundation.semantic.light.color["action-primary"].$value))
          assert.deepEqual(colorToSrgb(selected.text), colorToSrgb(foundation.semantic.light.color["text-on-action"].$value))
          assert.equal(await page.locator("#play").evaluate(button => getComputedStyle(button).height), "32px")
          assert.equal(await page.evaluate(() => document.body.dataset.startupError), undefined)
        }
        await page.emulateMedia({ reducedMotion: "reduce" })
        const duration = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--moira-motion-fast").trim())
        assert.equal(duration, "0ms")
        const roles = await cssRoles(page)
        const mode = name === "litemaptica" ? "dark" : "light"
        for (const [role, value] of Object.entries(roles)) {
          const expected = colorToSrgb(foundation.semantic[mode].color[role].$value)
          colorToSrgb(value).forEach((channel, index) => assert.ok(Math.abs(channel - expected[index]) < 0.000001, `${name} ${role}`))
        }
        if (previous) assert.deepEqual(roles, previous, `${name}: OS preference changed fixed roles`)
        previous = roles
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: horizontal viewport overflow`)
        await capture(page, `${name}-${built ? "built" : "dev"}-${colorScheme}`)
        await page.setViewportSize({ width: 860, height: 760 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: narrow viewport overflow`)
        await page.screenshot({ path: resolve(evidence, `${name}-${built ? "built" : "dev"}-${colorScheme}-narrow.png`) })
        assert.deepEqual(errors, [], `${name}: page errors`)
        results.push({ context: `${name}-${built ? "built" : "dev"}-${colorScheme}`, roles, passed: true })
        await page.close()
      }
    }, built)
  }
  await writeFile(resolve(evidence, "results.json"), `${JSON.stringify(results, null, 2)}\n`)
  console.log(`${results.length} rendered contexts passed; evidence: ${evidence}`)
} finally { await browser.close() }
