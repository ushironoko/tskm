import { describe, expectTypeOf, test } from "vitest"
import {
  type InferOutput,
  number,
  parse,
  type SafeParseAsyncResult,
  safeParseAsync,
  string,
  unionAsync,
} from "../src/index.ts"

describe("unionAsync type inference", () => {
  test("InferOutput is the union of the option outputs", () => {
    const schema = unionAsync([string(), number()])
    expectTypeOf<InferOutput<typeof schema>>().toEqualTypeOf<string | number>()
  })

  test("sync parse rejects an async union at compile time", () => {
    const schema = unionAsync([string(), number()])
    // @ts-expect-error — parse only accepts synchronous schemas
    parse(schema, "x")
  })

  test("safeParseAsync accepts an async union and returns a Promise", () => {
    const schema = unionAsync([string(), number()])
    expectTypeOf(safeParseAsync(schema, "x")).toEqualTypeOf<
      Promise<SafeParseAsyncResult<typeof schema>>
    >()
  })
})
