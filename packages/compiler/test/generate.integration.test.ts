import { afterAll, describe, expect, it } from "bun:test"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { generate } from "../src/index.ts"

const fixtureRoot = fileURLToPath(new URL("./fixtures/basic", import.meta.url))
const sidecar = fileURLToPath(
  new URL("./fixtures/basic/src/account.schema.gen.ts", import.meta.url),
)
const queryGlob = fileURLToPath(
  new URL("./fixtures/basic/src/account.schema.tskm-query.ts", import.meta.url),
)

afterAll(() => {
  for (const f of [sidecar, queryGlob]) {
    if (existsSync(f)) rmSync(f)
  }
})

describe("compiler generate (real tsgo) — the gate", () => {
  it("materializes fully-expanded output types into a sidecar", async () => {
    const result = await generate({
      root: fixtureRoot,
      config: { mode: "sidecar", include: ["src/*.schema.ts"], tsconfig: "tsconfig.json" },
    })

    expect(result.files.length).toBe(1)
    const file = result.files[0]
    expect(file?.typeNames).toEqual(expect.arrayContaining(["Account", "Tag"]))

    const gen = readFileSync(sidecar, "utf8")
    // nested + array + optional + transform-derived output, all expanded concretely
    expect(gen).toContain("export type Account = {")
    expect(gen).toContain("id: string")
    expect(gen).toContain("age: number")
    expect(gen).toContain("roles: string[]")
    expect(gen).toContain("nickname")
    // transform's output type (string -> number) is captured by the type system
    expect(gen).toContain("nameLength: number")
    // a bare string schema materializes to `string`
    expect(gen).toContain("export type Tag = string")
  }, 60_000)

  it("leaves no query files behind", () => {
    expect(existsSync(queryGlob)).toBe(false)
  })
})
