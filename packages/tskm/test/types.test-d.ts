import { describe, test } from "bun:test"
import { expectTypeOf } from "expect-type"
import {
  array,
  type DescriptionAction,
  description,
  type InferInput,
  type InferOutput,
  number,
  object,
  objectAsync,
  optional,
  type PipeItem,
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

describe("description metadata", () => {
  test("description without explicit type args keeps the pipe output type", () => {
    const schema = pipe(string(), description("the query"))
    expectTypeOf<InferOutput<typeof schema>>().toEqualTypeOf<string>()
  })

  test("description after a transform preserves the accumulated output type", () => {
    const schema = pipe(
      string(),
      transform((s: string) => s.length),
      description("character count"),
    )
    expectTypeOf<InferOutput<typeof schema>>().toEqualTypeOf<number>()
  })

  test("DescriptionAction is a member of the public PipeItem union", () => {
    expectTypeOf<DescriptionAction<string>>().toExtend<PipeItem<string, string>>()
  })
})

describe("sync/async soundness", () => {
  test("sync parse rejects an async schema at compile time", () => {
    const asyncSchema = objectAsync({ a: string() })
    // @ts-expect-error — parse only accepts synchronous schemas
    parse(asyncSchema, {})
  })
})
