import assert from "node:assert/strict"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { type CompilerApi, contains, makeProject, type Suite } from "./support.ts"

/**
 * The overlay contract of `createTsgoClient` against the real checker: query documents resolve
 * from memory, failures are fail-closed, and a cleared document stops resolving.
 */
export function tsgoClientSuite(api: CompilerApi): Suite {
  const roots: string[] = []
  const project = () => {
    const made = makeProject()
    roots.push(made.root)
    return made
  }

  return {
    title: "TsgoClient (typescript/sync)",
    teardown: () => {
      for (const root of roots) rmSync(root, { recursive: true, force: true })
    },
    scenarios: [
      {
        name: "resolves an in-memory query without writing it, and fails closed on any/unknown/never",
        run: () => {
          const { root, tsconfig } = project()
          const client = api.createTsgoClient({ cwd: root, tsconfigPath: tsconfig })
          const query = join(root, "src/schema.tskm-query.ts")
          try {
            assert.equal(client.supportsOverlay, true)

            const body = `import { user } from "./schema"\ndeclare const __q: typeof user\n`
            client.applyOverlay([{ document: query, text: body }])
            assert.equal(existsSync(query), false)
            const resolved = client.resolveTypeAt(query, body.indexOf("__q"))
            assert.ok(resolved, "expected a resolved type")
            contains(resolved.text, "id: number")
            contains(resolved.text, "name: string")
            assert.equal(resolved.flags & api.FAILURE_TYPE_FLAGS, 0)

            for (const kind of ["any", "unknown", "never"] as const) {
              const text = `declare const __q: ${kind}\n`
              client.applyOverlay([{ document: query, text }])
              const failed = client.resolveTypeAt(query, text.indexOf("__q"))
              assert.ok(failed, `expected a ${kind} type`)
              assert.equal(failed.text, kind)
              assert.notEqual(failed.flags & api.FAILURE_TYPE_FLAGS, 0)
              assert.equal(existsSync(query), false)
            }

            const bad = `declare const __q: NotAType\n`
            client.applyOverlay([{ document: query, text: bad }])
            const diagnostics = client.getDiagnostics(query)
            assert.ok(
              diagnostics.some((d) => d.code === 2304),
              "expected code 2304",
            )
            assert.ok(
              diagnostics.some((d) => d.text?.includes("Cannot find name 'NotAType'")),
              "expected the 'Cannot find name' message",
            )
            assert.equal(existsSync(query), false)

            client.clearOverlay([query])
            assert.equal(existsSync(query), false)
            // Removal must take the document out of the program, not just stop the write:
            // the marker that resolved before must now be a missing type.
            assert.equal(client.resolveTypeAt(query, bad.indexOf("__q")), null)
          } finally {
            client.close()
            client.close()
          }
        },
      },
      {
        name: "fails closed for a document the project does not include",
        run: () => {
          const { root, tsconfig } = project()
          mkdirSync(join(root, "outside"))
          const client = api.createTsgoClient({ cwd: root, tsconfigPath: tsconfig })
          const outside = join(root, "outside/probe.tskm-query.ts")
          const text = `declare const __q: number = "not a number"\n`
          try {
            client.applyOverlay([{ document: outside, text }])
            // The checker reports "source file not found" for such a document. The client maps
            // that to a missing type, and a diagnostics call to the synthetic failure entry.
            assert.equal(client.resolveTypeAt(outside, text.indexOf("__q")), null)
            assert.deepEqual(client.getDiagnostics(outside), [{ code: -1, fileName: outside }])
            client.clearOverlay([outside])
          } finally {
            client.close()
          }
        },
      },
    ],
  }
}
