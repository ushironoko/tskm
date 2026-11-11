import { describe, expect, test } from "bun:test"
import { syncLockVersions } from "./sync-bun-lock-versions.ts"

// Shaped like bun.lock: the root entry has a name and no version, and each workspace entry
// has its key line, then a name line, then a version line.
const LOCK = `{
  "lockfileVersion": 1,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "tskm-monorepo",
      "devDependencies": {
        "typescript": "6.0.3",
      },
    },
    "packages/compiler": {
      "name": "@tskm/compiler",
      "version": "0.4.1",
      "dependencies": {
        "@tskm/core": "workspace:*",
      },
    },
    "packages/tskm": {
      "name": "@tskm/core",
      "version": "0.3.0",
    },
  },
  "packages": {
    "@tskm/compiler": ["@tskm/compiler@workspace:packages/compiler"],
    "@tskm/core": ["@tskm/core@workspace:packages/tskm"],
  }
}
`

const SYNCED = LOCK.replace('"version": "0.4.1"', '"version": "0.6.0"').replace(
  '"version": "0.3.0"',
  '"version": "0.4.0"',
)

const PACKAGE_VERSIONS: Record<string, string | undefined> = {
  "packages/compiler": "0.6.0",
  "packages/tskm": "0.4.0",
}
const versionOf = (dir: string): string => {
  const version = PACKAGE_VERSIONS[dir]
  if (version === undefined) throw new Error(`no version for ${dir}`)
  return version
}

describe("syncLockVersions", () => {
  test("rewrites only the stale workspace version lines", () => {
    const { text, changed } = syncLockVersions(LOCK, versionOf)

    expect(text).toBe(SYNCED)
    expect(changed).toEqual(["packages/compiler: 0.4.1 -> 0.6.0", "packages/tskm: 0.3.0 -> 0.4.0"])
  })

  test("returns the same text when every version already matches", () => {
    const { text, changed } = syncLockVersions(SYNCED, versionOf)

    expect(text).toBe(SYNCED)
    expect(changed).toEqual([])
  })

  test("fails closed when a workspace entry has no version line", () => {
    const withoutVersion = LOCK.replace('      "version": "0.3.0",\n', "")

    expect(() => syncLockVersions(withoutVersion, versionOf)).toThrow(
      "layout is not the one this script expects",
    )
  })
})
