import { access, readFile } from "node:fs/promises"
import { constants } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const projectDirectory = resolve(process.argv[2] ?? process.cwd())
const require = createRequire(resolve(projectDirectory, "package.json"))
const electronPackage = require.resolve("electron/package.json")
const electronDirectory = dirname(electronPackage)
const pathFile = resolve(electronDirectory, "path.txt")

let relativeExecutable
try {
  relativeExecutable = (await readFile(pathFile, "utf8")).trim()
} catch {
  console.error("Electron is installed as a package but its binary is missing (node_modules/electron/path.txt was not generated).")
  console.error("Repair it with: pnpm rebuild electron")
  process.exit(1)
}

if (!relativeExecutable) {
  console.error("Electron path.txt is empty. Repair it with: pnpm rebuild electron")
  process.exit(1)
}

const executable = resolve(electronDirectory, "dist", relativeExecutable)
try {
  await access(executable, constants.X_OK)
} catch {
  console.error(`Electron executable is missing or not executable: ${executable}`)
  console.error("Repair it with: pnpm rebuild electron")
  process.exit(1)
}

const probe = spawnSync(executable, ["-e", "process.stdout.write('electron-ready')"], {
  encoding: "utf8",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
})

if (probe.status !== 0 || probe.stdout !== "electron-ready") {
  console.error("Electron exists but failed its headless execution probe.")
  if (probe.error) console.error(probe.error.message)
  if (probe.stderr) console.error(probe.stderr.trim())
  process.exit(1)
}

console.log(`Electron dev runtime ready for ${projectDirectory}: ${executable}`)
