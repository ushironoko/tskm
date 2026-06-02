import { afterAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { generateJsonSchema } from "../src/index.ts"

// Runs the REAL isolated worker subprocess against the existing fixture schema module.
// The worker must import a `.ts` module that bare-imports `tskm`, so it needs a TS-capable
// runtime that can resolve the workspace `tskm`; we resolve a `bun` on PATH and pass it
// explicitly as the worker exec path.
const fixtureRoot = fileURLToPath(new URL("./fixtures/basic", import.meta.url))
const output = fileURLToPath(new URL("./fixtures/basic/src/account.schema.json", import.meta.url))
const noisySource = fileURLToPath(new URL("./fixtures/basic/src/noisy.schema.ts", import.meta.url))
const noisyOutput = fileURLToPath(
  new URL("./fixtures/basic/src/noisy.schema.json", import.meta.url),
)

function findBun(): string | undefined {
  const which = spawnSync("/bin/sh", ["-c", "command -v bun"], { encoding: "utf8" })
  const path = which.stdout?.trim()
  return path ? path : undefined
}
const bun = findBun()

afterAll(() => {
  for (const f of [output, noisySource, noisyOutput]) {
    if (existsSync(f)) rmSync(f)
  }
})

describe.skipIf(!bun)("generateJsonSchema — isolated subprocess (real import)", () => {
  it("walks the runtime schema objects into a JSON Schema file", async () => {
    const result = await generateJsonSchema({
      root: fixtureRoot,
      config: { include: ["src/account.schema.ts"] },
      execPath: bun,
    })

    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.schemaNames).toEqual(
      expect.arrayContaining(["accountSchema", "tagSchema"]),
    )
    // transform's output is not representable in JSON Schema — it must warn (the warning
    // is attributed to the exported schema, mentioning the non-representable action).
    expect(result.diagnostics.some((d) => d.includes("transform"))).toBe(true)
    expect(result.diagnostics.some((d) => d.includes("accountSchema"))).toBe(true)

    const doc = JSON.parse(readFileSync(output, "utf8")) as {
      accountSchema: {
        type: string
        properties: Record<string, { type?: string; items?: { type?: string } }>
        required: string[]
        additionalProperties: boolean
      }
      tagSchema: { type: string }
    }

    const account = doc.accountSchema
    expect(account.type).toBe("object")
    expect(account.additionalProperties).toBe(false)
    expect(account.properties.id?.type).toBe("string")
    expect(account.properties.age?.type).toBe("number")
    expect(account.properties.roles?.type).toBe("array")
    expect(account.properties.roles?.items?.type).toBe("string")
    // `nickname` is optional → present in properties but excluded from required.
    expect(account.properties.nickname).toBeDefined()
    expect(account.required).not.toContain("nickname")
    expect(account.required).toEqual(expect.arrayContaining(["id", "age", "roles", "nameLength"]))

    expect(doc.tagSchema).toEqual({ type: "string" })
  }, 60_000)

  it("tolerates a schema module that writes to stdout (envelope is file-based)", async () => {
    // A stray console.log used to corrupt the stdout envelope; the worker now writes to a
    // file, so module output cannot break parsing.
    writeFileSync(
      noisySource,
      `import { object, string } from "tskm"\nconsole.log("side effect on stdout")\nexport const noisySchema = object({ a: string() })\n`,
    )
    const result = await generateJsonSchema({
      root: fixtureRoot,
      config: { include: ["src/noisy.schema.ts"] },
      execPath: bun,
    })

    expect(result.diagnostics).toHaveLength(0)
    expect(result.files).toHaveLength(1)
    const doc = JSON.parse(readFileSync(noisyOutput, "utf8")) as {
      noisySchema: { type: string; properties: Record<string, { type?: string }> }
    }
    expect(doc.noisySchema.type).toBe("object")
    expect(doc.noisySchema.properties.a?.type).toBe("string")
  }, 60_000)
})
