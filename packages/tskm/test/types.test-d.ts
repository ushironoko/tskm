import { describe, test } from "bun:test"
import { expectTypeOf } from "expect-type"
import {
  array,
  assert,
  type BigintSchema,
  type BooleanSchema,
  coerce,
  type DateSchema,
  type DescriptionAction,
  description,
  type InferInput,
  type InferOutput,
  is,
  maxValue,
  minValue,
  type NumberSchema,
  number,
  object,
  objectAsync,
  optional,
  type PipeItem,
  type PreprocessSchema,
  parse,
  pipe,
  preprocess,
  preprocessAsync,
  type StringSchema,
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

describe("preprocess and coerce types", () => {
  test("coerce helpers keep the inner schema as TWrapped and unknown as the input", () => {
    expectTypeOf<ReturnType<typeof coerce.string>>().toEqualTypeOf<PreprocessSchema<StringSchema>>()
    expectTypeOf<ReturnType<typeof coerce.number>>().toEqualTypeOf<PreprocessSchema<NumberSchema>>()
    expectTypeOf<ReturnType<typeof coerce.boolean>>().toEqualTypeOf<
      PreprocessSchema<BooleanSchema>
    >()
    expectTypeOf<ReturnType<typeof coerce.bigint>>().toEqualTypeOf<PreprocessSchema<BigintSchema>>()
    expectTypeOf<ReturnType<typeof coerce.date>>().toEqualTypeOf<PreprocessSchema<DateSchema>>()

    const port = pipe(coerce.number(), minValue(1), maxValue(65535))
    expectTypeOf<InferInput<typeof port>>().toEqualTypeOf<unknown>()
    expectTypeOf<InferOutput<typeof port>>().toEqualTypeOf<number>()

    const shape = object({ port })
    expectTypeOf<InferInput<typeof shape>>().toEqualTypeOf<{ port: unknown }>()
    expectTypeOf<InferOutput<typeof shape>>().toEqualTypeOf<{ port: number }>()

    const counted = pipe(
      preprocess((value) => String(value), string()),
      transform((text: string) => text.length),
    )
    expectTypeOf<InferInput<typeof counted>>().toEqualTypeOf<unknown>()
    expectTypeOf<InferOutput<typeof counted>>().toEqualTypeOf<number>()

    const maybe = optional(coerce.number())
    expectTypeOf<InferOutput<typeof maybe>>().toEqualTypeOf<number | undefined>()
  })

  test("preprocess rejects an async schema; preprocessAsync accepts it", () => {
    const asyncSchema = objectAsync({ a: string() })
    // @ts-expect-error — preprocess is sync-only
    preprocess((value) => value, asyncSchema)
    const wrapped = preprocessAsync(async (value) => value, asyncSchema)
    expectTypeOf<InferInput<typeof wrapped>>().toEqualTypeOf<unknown>()
    expectTypeOf<InferOutput<typeof wrapped>>().toEqualTypeOf<InferOutput<typeof asyncSchema>>()
  })

  test("is and assert narrow the original value to InferOutput", () => {
    const schema = coerce.number()
    const value: unknown = "8080"
    if (is(schema, value)) {
      expectTypeOf(value).toEqualTypeOf<number>()
    }
    const flagged: unknown = "8080"
    assert(schema, flagged)
    expectTypeOf(flagged).toEqualTypeOf<number>()
  })
})
