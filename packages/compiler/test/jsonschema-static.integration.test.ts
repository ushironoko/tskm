import { existsSync, readFileSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { generate } from "../src/index.ts"
import { afterEach, describe, expect, it } from "./test-api.ts"
import { withTestTsgo } from "./tsgo-test-executable.ts"

const fixtureRoot = fileURLToPath(new URL("./fixtures/static-json", import.meta.url))
const genFile = fileURLToPath(
  new URL("./fixtures/static-json/src/user.schema.gen.ts", import.meta.url),
)
const queryFile = fileURLToPath(
  new URL("./fixtures/static-json/src/user.schema.tskm-query.ts", import.meta.url),
)

afterEach(() => {
  for (const file of [genFile, queryFile]) {
    if (existsSync(file)) rmSync(file)
  }
})

describe("jsonSchema.emit standard", () => {
  it("writes JSON literals for each target into the sidecar and fails closed on bigint", async () => {
    const result = await generate({
      root: fixtureRoot,
      config: withTestTsgo({
        include: ["src/user.schema.ts"],
        jsonSchema: { emit: "standard" },
        worker: { execPath: process.execPath },
      }),
    })

    expect(result.files).toHaveLength(1)
    const gen = readFileSync(genFile, "utf8")
    expect(gen).toContain("export type User =")
    expect(gen).toContain("export const userSchemaJsonSchema = ")
    expect(gen).toContain('"draft-2020-12"')
    expect(gen).toContain('"draft-07"')
    expect(gen).toContain('"openapi-3.0"')
    expect(gen).toContain('"input"')
    expect(gen).toContain('"output"')
    expect(gen).toContain('"default": 0')
    expect(gen).not.toContain("export const amountSchemaJsonSchema")
    expect(gen).not.toContain("convertToJsonSchema")
    expect(gen).not.toContain("new Function")
    expect(result.errors?.some((line) => line.includes("amountSchema"))).toBe(true)
    expect(result.errors?.some((line) => line.includes("bigint"))).toBe(true)

    const literal = gen.slice(gen.indexOf("export const userSchemaJsonSchema = "))
    const json = literal.slice(literal.indexOf("{"), literal.lastIndexOf("}") + 1)
    const docs = JSON.parse(json) as {
      "draft-2020-12": { input: { properties: { age: { default?: number } } } }
      "draft-07": unknown
      "openapi-3.0": unknown
    }
    expect(docs["draft-2020-12"].input.properties.age.default).toBe(0)
    expect(docs["draft-07"]).toBeDefined()
    expect(docs["openapi-3.0"]).toBeDefined()
  }, 60_000)

  it("does not write JSON literals when emit is omitted", async () => {
    const result = await generate({
      root: fixtureRoot,
      config: withTestTsgo({
        include: ["src/user.schema.ts"],
        worker: { execPath: process.execPath },
      }),
    })
    const gen = readFileSync(genFile, "utf8")
    expect(gen).not.toContain("JsonSchema")
    expect(result.errors).toBeUndefined()
  }, 60_000)
})
