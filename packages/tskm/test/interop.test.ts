import { describe, expect, it } from "bun:test"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import * as v from "valibot"
import { number, object, string } from "../src/index.ts"

/**
 * Runtime interop proof (issue #23, requirement 6). The type-level conformance against
 * the real `@standard-schema/spec` package is asserted elsewhere; here a single generic
 * consumer that knows ONLY the spec drives both a tskm schema and a `valibot` schema,
 * proving the consumer is genuinely validator-agnostic and tskm conforms to the same
 * contract as another Standard Schema library.
 */

type Consumed<S extends StandardSchemaV1> =
  | { readonly ok: true; readonly value: StandardSchemaV1.InferOutput<S> }
  | { readonly ok: false; readonly issues: ReadonlyArray<StandardSchemaV1.Issue> }

async function consume<S extends StandardSchemaV1>(
  schema: S,
  input: unknown,
): Promise<Consumed<S>> {
  let result = schema["~standard"].validate(input)
  if (result instanceof Promise) {
    result = await result
  }
  return result.issues === undefined
    ? { ok: true, value: result.value }
    : { ok: false, issues: result.issues }
}

const tskmUser = object({ name: string(), age: number() })
const valibotUser = v.object({ name: v.string(), age: v.number() })

describe("Standard Schema interop: one generic consumer, two libraries", () => {
  it("consumes a valid value through a tskm schema", async () => {
    const r = await consume(tskmUser, { name: "ada", age: 36 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual({ name: "ada", age: 36 })
    }
  })

  it("consumes a valid value through a valibot schema with the same consumer", async () => {
    const r = await consume(valibotUser, { name: "ada", age: 36 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual({ name: "ada", age: 36 })
    }
  })

  it("reports failure uniformly for both libraries", async () => {
    const bad = { name: "ada", age: "not a number" }
    const fromTskm = await consume(tskmUser, bad)
    const fromValibot = await consume(valibotUser, bad)

    expect(fromTskm.ok).toBe(false)
    expect(fromValibot.ok).toBe(false)

    // The consumer reads each issue the same way regardless of which library produced it:
    // a string message and a path locating the offending key.
    for (const result of [fromTskm, fromValibot]) {
      if (result.ok) {
        throw new Error("expected a failure result")
      }
      expect(result.issues.length).toBeGreaterThan(0)
      const issue = result.issues[0]
      expect(typeof issue?.message).toBe("string")
      expect(
        issue?.path?.map((segment) => (typeof segment === "object" ? segment.key : segment)),
      ).toEqual(["age"])
    }
  })
})
