// Build native feature resources and stage them under namespaced suite paths.
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { buildFeatureStagingPlan, loadFeatureArtifactData } from './feature-staging-plan.mjs'

if (process.platform !== 'darwin') process.exit(0)

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const repoRoot = resolve(import.meta.dirname, '..')
const productRoots = {
  amove: join(repoRoot, 'apps/integrated/Amove'),
  bonded: join(repoRoot, 'apps/integrated/Bonded'),
  shout: join(repoRoot, 'apps/integrated/Shout')
}

if (!existsSync(join(productRoots.amove, 'node_modules/.bin/napi'))) {
  run('pnpm', ['install', '--frozen-lockfile', '--ignore-workspace', '--ignore-scripts'], productRoots.amove)
}
run('pnpm', ['native:mac'], productRoots.amove)
run('pnpm', ['native:release'], productRoots.bonded)
run('pnpm', ['native:release'], productRoots.shout)
run('pnpm', ['native:driver:release'], productRoots.shout)

const plan = buildFeatureStagingPlan({
  repoRoot,
  productRoots,
  platform: 'darwin',
  arch: 'arm64',
  configuration: 'release'
}, loadFeatureArtifactData())

for (const record of plan) {
  if (!existsSync(record.expectedPath)) {
    throw new Error(`Feature staging source missing for '${record.featureId}/${record.artifactName}': ${record.expectedPath}`)
  }
  if (!existsSync(record.sourcePath)) {
    throw new Error(`Feature staging source missing for '${record.featureId}/${record.artifactName}': ${record.sourcePath}`)
  }
}

const stagingRoot = join(repoRoot, 'native/staged/features')
rmSync(stagingRoot, { recursive: true, force: true })
mkdirSync(stagingRoot, { recursive: true })

for (const record of plan) {
  try {
    if (record.mode === 'file') {
      mkdirSync(dirname(record.destinationPath), { recursive: true })
      copyFileSync(record.sourcePath, record.destinationPath)
    } else {
      cpSync(record.sourcePath, record.destinationPath, { recursive: true })
    }
  } catch (error) {
    throw new Error(`Failed to stage '${record.featureId}/${record.artifactName}' from '${record.sourcePath}' to '${record.destinationPath}': ${String(error)}`, { cause: error })
  }
}
