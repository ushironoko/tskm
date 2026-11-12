import type { Satisfies } from "@schema-benchmarks/utils"
import { getVersion } from "@schema-benchmarks/utils/node" with { type: "macro" }
import {
  email,
  type InferInput,
  type InferOutput,
  is,
  number,
  object,
  parse,
  pipe,
  safeParse,
  safeParseCompiled,
  string,
  type TransformContext,
  transform,
  url,
} from "@tskm/core"
import { withJsonSchema } from "@tskm/core/json-schema"
import ts from "dedent"

import type { JsonSchemaInputData, JsonSchemaOutputData } from "#src"
import { assertNotReached, defineBenchmarks } from "#src"

import { productSchema } from "."

function decimalIntegerStringToNumber(value: string, ctx: TransformContext): number {
  if (!/^[0-9]+$/.test(value)) {
    ctx.issue("price must be a decimal integer string")
    return 0
  }
  return Number(value)
}

const jsonSchemaSubject = withJsonSchema(
  object({
    id: number(),
    name: string(),
    price: pipe(string(), transform(decimalIntegerStringToNumber)),
  }),
)

export type JsonSchemaSubjectInput = Satisfies<
  InferInput<typeof jsonSchemaSubject>,
  JsonSchemaInputData
>
export type JsonSchemaSubjectOutput = Satisfies<
  InferOutput<typeof jsonSchemaSubject>,
  JsonSchemaOutputData
>

export default defineBenchmarks({
  library: {
    name: "tskm",
    optimizeType: "none",
    version: await getVersion("tskm"),
  },
  validation: [
    {
      run(data) {
        return is(productSchema, data)
      },
      snippet: ts`is(schema, data)`,
    },
    {
      run(data) {
        return safeParseCompiled(productSchema, data).success
      },
      note: "compiled",
      snippet: ts`safeParseCompiled(schema, data).success`,
    },
  ],
  parsing: {
    allErrors: [
      {
        run(data) {
          return safeParse(productSchema, data)
        },
        validateResult: (result) => result.success,
        getData: (result) => (result.success ? result.output : undefined),
        snippet: ts`safeParse(schema, data)`,
      },
      {
        run(data) {
          return safeParseCompiled(productSchema, data)
        },
        validateResult: (result) => result.success,
        getData: (result) => (result.success ? result.output : undefined),
        note: "compiled",
        snippet: ts`safeParseCompiled(schema, data)`,
      },
    ],
    abortEarly: {
      run(data) {
        return safeParse(productSchema, data, { mode: "reject" })
      },
      validateResult: (result) => result.success,
      getData: (result) => (result.success ? result.output : undefined),
      snippet: ts`safeParse(schema, data, { mode: "reject" })`,
    },
  },
  standard: {
    allErrors: { schema: productSchema },
  },
  jsonSchema: {
    conversion: {
      toJson: {
        generate: ({ target, direction }) =>
          jsonSchemaSubject["~standard"].jsonSchema[direction]({ target }),
        snippet: ({ target, direction }) =>
          ts`
            // setup-start
            const schema = withJsonSchema(subject)
            // setup-end
            schema["~standard"].jsonSchema.${direction}({ target: "${target}" })
          `,
        source: { type: "native" },
        standardJsonSchema: { type: "native", schema: jsonSchemaSubject },
      },
    },
  },
  string: {
    email: {
      create() {
        const schema = pipe(string(), email())
        return (testString) => is(schema, testString)
      },
      snippet: ts`pipe(string(), email())`,
    },
    url: {
      create() {
        const schema = pipe(string(), url())
        return (testString) => is(schema, testString)
      },
      snippet: ts`pipe(string(), url())`,
    },
  },
  stack: {
    throw: (data) => {
      parse(productSchema, data)
      assertNotReached()
    },
    snippet: ts`parse(schema, data)`,
  },
})
