import { describe, test } from "bun:test"
import { expectTypeOf } from "expect-type"
import {
  array,
  type InferInput,
  type InferOutput,
  number,
  object,
  objectAsync,
  optional,
  parse,
  pipe,
  string,
  transform,
} from "../src/index.ts"

describe("type inference", () => {
  test("object InferOutput is the concrete nested shape", () => {
    const schema = object({
      name: string(),
      age: number(),
      tags: array(string()),
    })
    expectTypeOf<InferOutput<typeof schema>>().toEqualTypeOf<{
      name: string
      age: number
      tags: string[]
    }>()
  })

  test("transform makes InferInput differ from InferOutput", () => {
    const schema = pipe(
      string(),
      transform((s: string) => s.length),
    )
    expectTypeOf<InferInput<typeof schema>>().toEqualTypeOf<string>()
    expectTypeOf<InferOutput<typeof schema>>().toEqualTypeOf<number>()
  })

  test("optional widens the output with undefined", () => {
    const schema = object({ nick: optional(string()) })
    expectTypeOf<InferOutput<typeof schema>>().toEqualTypeOf<{ nick: string | undefined }>()
  })
})

describe("sync/async soundness", () => {
  test("sync parse rejects an async schema at compile time", () => {
    const asyncSchema = objectAsync({ a: string() })
    // @ts-expect-error — parse only accepts synchronous schemas
    parse(asyncSchema, {})
  })
})
