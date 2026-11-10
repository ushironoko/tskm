import { describe, expect, it } from "bun:test"
import { asSchema } from "@ai-sdk/provider-utils"
import { array, number, object, optional, string } from "@tskm/core"
import { withJsonSchema } from "@tskm/core/json-schema"
import { tool } from "ai"

/**
 * Vercel AI SDK (`ai` 7 + `@ai-sdk/provider-utils` 5) accepts a Standard Schema
 * as a tool input only when `~standard.jsonSchema` is present. For any vendor
 * other than `"zod"` it calls `jsonSchema.input({ target: "draft-07" })` and
 * otherwise throws "does not support JSON Schema conversion".
 */

const User = withJsonSchema(
  object({
    name: string(),
    age: number(),
    tags: optional(array(string())),
  }),
)

const expected = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "number" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["name", "age"],
  additionalProperties: false,
}

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as typeof expected
}

describe("Vercel AI SDK consumes a tskm schema", () => {
  it("asSchema reads draft-07 input JSON Schema and validates", async () => {
    const converted = asSchema(User)
    expect(json(await converted.jsonSchema)).toEqual(expected)

    const ok = await converted.validate?.({ name: "ada", age: 36, tags: ["a"] })
    expect(ok).toEqual({ success: true, value: { name: "ada", age: 36, tags: ["a"] } })

    const bad = await converted.validate?.({ name: "ada", age: "nope" })
    expect(bad?.success).toBe(false)
  })

  it("tool({ inputSchema }) accepts the schema and exposes the same JSON Schema", async () => {
    const lookup = tool({
      description: "Look up a user",
      inputSchema: User,
      execute: async ({ name }) => name,
    })

    expect(lookup.description).toBe("Look up a user")
    const converted = asSchema(lookup.inputSchema)
    expect(json(await converted.jsonSchema)).toEqual(expected)

    const value = await lookup.execute?.(
      { name: "ada", age: 1, tags: undefined },
      {
        toolCallId: "call_1",
        messages: [],
        context: {},
      },
    )
    expect(value).toBe("ada")
  })
})
