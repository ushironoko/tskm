import { describe, expect, it } from "bun:test"
import { number, object, optional, string } from "../src/index.ts"
import { withJsonSchema, withStaticJsonSchema } from "../src/json-schema.ts"

const targets = ["draft-2020-12", "draft-07", "openapi-3.0"] as const

const docs = {
  "draft-2020-12": {
    input: { type: "string", default: "anon" },
    output: { type: "string" },
  },
  "draft-07": {
    input: { type: "string", default: "anon" },
    output: { type: "string" },
  },
  "openapi-3.0": {
    input: { type: "string", default: "anon" },
    output: { type: "string" },
  },
} as const

describe("withStaticJsonSchema", () => {
  const schema = optional(string(), "anon")

  it("returns the precomputed document and does not mutate the argument", () => {
    const wrapped = withStaticJsonSchema(schema, docs)
    expect(schema["~standard"]).not.toHaveProperty("jsonSchema")
    expect(wrapped["~standard"].validate).toBe(schema["~standard"].validate)
    for (const target of targets) {
      expect(wrapped["~standard"].jsonSchema.input({ target })).toBe(docs[target].input)
      expect(wrapped["~standard"].jsonSchema.output({ target })).toBe(docs[target].output)
    }
  })

  it("throws for a target or side that was not emitted", () => {
    const partial = withStaticJsonSchema(string(), {
      "draft-2020-12": { input: { type: "string" } },
    })
    expect(partial["~standard"].jsonSchema.input({ target: "draft-2020-12" })).toEqual({
      type: "string",
    })
    expect(() => partial["~standard"].jsonSchema.output({ target: "draft-2020-12" })).toThrow(
      /no static JSON Schema document for output target "draft-2020-12"/,
    )
    expect(() => partial["~standard"].jsonSchema.input({ target: "draft-07" })).toThrow(
      /no static JSON Schema document for input target "draft-07"/,
    )
  })

  it("rejects libraryOptions.name instead of rewriting the document", () => {
    const wrapped = withStaticJsonSchema(object({ name: string() }), {
      "draft-2020-12": { output: { type: "object" } },
    })
    expect(() =>
      wrapped["~standard"].jsonSchema.output({
        target: "draft-2020-12",
        libraryOptions: { name: "User" },
      }),
    ).toThrow(/does not apply libraryOptions.name/)
  })

  it("still validates a malformed name the same way as withJsonSchema", () => {
    const wrapped = withStaticJsonSchema(number(), {
      "draft-2020-12": { output: { type: "number" } },
    })
    expect(() =>
      wrapped["~standard"].jsonSchema.output({
        target: "draft-2020-12",
        libraryOptions: { name: "a/b" },
      }),
    ).toThrow('tskm: jsonSchema libraryOptions.name must be a non-empty string without "/" or "#"')
    expect(() =>
      withJsonSchema(number())["~standard"].jsonSchema.output({ target: "nope" }),
    ).toThrow(/unsupported JSON Schema target/)
    expect(() => wrapped["~standard"].jsonSchema.output({ target: "nope" })).toThrow(
      /unsupported JSON Schema target/,
    )
  })

  it("accepts libraryOptions that carry no name", () => {
    const wrapped = withStaticJsonSchema(string(), {
      "draft-07": { input: { type: "string" } },
    })
    expect(
      wrapped["~standard"].jsonSchema.input({
        target: "draft-07",
        libraryOptions: { io: "input" },
      }),
    ).toEqual({ type: "string" })
  })
})
