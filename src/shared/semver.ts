const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export interface Semver {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
}

export function parseSemver(version: string): Semver | undefined {
  const match = SEMVER.exec(version)
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? []
  }
}

export function compareSemver(leftVersion: string, rightVersion: string): number {
  const left = parseSemver(leftVersion)
  const right = parseSemver(rightVersion)
  if (!left || !right) throw new TypeError('Cannot compare invalid semantic versions.')

  for (const key of ['major', 'minor', 'patch'] as const) {
    const difference = left[key] - right[key]
    if (difference !== 0) return Math.sign(difference)
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1

  const identifierCount = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue

    const leftIsNumber = /^\d+$/.test(leftIdentifier)
    const rightIsNumber = /^\d+$/.test(rightIdentifier)
    if (leftIsNumber && rightIsNumber) return Math.sign(Number(leftIdentifier) - Number(rightIdentifier))
    if (leftIsNumber) return -1
    if (rightIsNumber) return 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }

  return 0
}
