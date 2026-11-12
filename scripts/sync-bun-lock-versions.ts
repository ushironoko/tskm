// Copies each workspace package's version from its package.json into bun.lock.
//
// Bun writes a workspace's "version" into bun.lock only when it saves the lockfile for a
// dependency change. A version bump (`changeset version`) changes no dependency, so neither
// `bun install` nor `bun install --lockfile-only` rewrites the line, and bun.lock drifts from
// package.json. This edits only those version values and nothing else. The root "version"
// script runs it after `changeset version`, so the Version PR commits a matching lockfile.
//
// Usage, from the repo root: bun run scripts/sync-bun-lock-versions.ts

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Every object in bun.lock's "workspaces" section starts with a 4-space key line. The root
// entry ("") has no version, so it never matches WORKSPACE below.
const OBJECT_KEY = /^ {4}"([^"]*)": \{$/gm
// Bun writes "name" and then "version" as the first two fields of a workspace entry.
const WORKSPACE = /^ {4}"([^"]+)": \{\n {6}"name": "[^"]*",\n {6}"version": "([^"]*)",$/gm

export type SyncResult = { text: string; changed: string[] }

// Pure: returns the lockfile text with each workspace version set to versionOf(dir). Throws
// when the layout differs from what Bun writes, so the caller never edits a lockfile this
// script does not understand.
export function syncLockVersions(lock: string, versionOf: (dir: string) => string): SyncResult {
  const keys = [...lock.matchAll(OBJECT_KEY)].map((match) => match[1]).filter((dir) => dir !== "")
  const workspaces = [...lock.matchAll(WORKSPACE)].map((match) => match[1])
  if (keys.length !== workspaces.length || keys.some((dir, i) => dir !== workspaces[i])) {
    throw new Error(
      "bun.lock layout is not the one this script expects: every workspace needs a key line, then a name line and a version line",
    )
  }

  const changed: string[] = []
  const text = lock.replace(WORKSPACE, (entry, dir: string, current: string) => {
    const wanted = versionOf(dir)
    if (wanted === current) return entry
    changed.push(`${dir}: ${current} -> ${wanted}`)
    return entry.replace(`"version": "${current}"`, `"version": "${wanted}"`)
  })
  return { text, changed }
}

function readWorkspaceVersion(root: string, dir: string): string {
  const manifest: { version?: unknown } = JSON.parse(
    readFileSync(join(root, dir, "package.json"), "utf8"),
  )
  if (typeof manifest.version !== "string") {
    throw new Error(`${dir}/package.json has no version`)
  }
  return manifest.version
}

if (import.meta.main) {
  const root = process.cwd()
  const lockPath = join(root, "bun.lock")
  const before = readFileSync(lockPath, "utf8")
  const { text, changed } = syncLockVersions(before, (dir) => readWorkspaceVersion(root, dir))
  if (changed.length === 0) {
    console.log("bun.lock workspace versions already match package.json")
  } else {
    writeFileSync(lockPath, text)
    for (const line of changed) console.log(`  ${line}`)
    console.log(`bun.lock: updated ${changed.length} workspace version(s)`)
  }
}
