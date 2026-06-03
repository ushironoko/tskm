import { afterAll, describe, expect, it } from "bun:test"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { generate } from "../src/index.ts"

// Real-tsgo gate for TOP-LEVEL nullability. The existing `account` gate only exercises
// `nullable`/`optional` *inside* an `object`, where the `& {}` of the `__P` query wrapper
// is applied at the object level and never touches the property values. A top-level
// `nullable`/`nullish`/`union([…, null_()])` is the one shape that flows the bare union
// straight through `__P` — the precise spot where `null`/`undefined` could be dropped.
const fixtureRoot = fileURLToPath(new URL("./fixtures/nullish", import.meta.url))
const sidecar = fileURLToPath(new URL("./fixtures/nullish/src/edge.schema.gen.ts", import.meta.url))
const query = fileURLToPath(
  new URL("./fixtures/nullish/src/edge.schema.tskm-query.ts", import.meta.url),
)

afterAll(() => {
  for (const f of [sidecar, query]) {
    if (existsSync(f)) rmSync(f)
  }
})

/** The right-hand side of `export type <name> = …`, up to the next type or EOF. */
function typeBody(gen: string, name: string): string {
  const match = gen.match(new RegExp(`export type ${name} =([\\s\\S]*?)(?=\\nexport type |\\s*$)`))
  return match?.[1] ?? ""
}

describe("top-level nullable/nullish/union-with-null survive __P (real tsgo)", () => {
  it("keeps null and undefined members in the emitted sidecar", async () => {
    await generate({
      root: fixtureRoot,
      config: { mode: "sidecar", include: ["src/*.schema.ts"], tsconfig: "tsconfig.json" },
    })

    const gen = readFileSync(sidecar, "utf8")

    // nullable(string()) → string | null
    const maybeName = typeBody(gen, "MaybeName")
    expect(maybeName).toContain("string")
    expect(maybeName).toContain("null")

    // nullish(number()) → number | null | undefined
    const maybeAge = typeBody(gen, "MaybeAge")
    expect(maybeAge).toContain("number")
    expect(maybeAge).toContain("null")
    expect(maybeAge).toContain("undefined")

    // union([string(), number(), null_()]) → string | number | null
    const idOrCode = typeBody(gen, "IdOrCode")
    expect(idOrCode).toContain("null")
  }, 60_000)
})
