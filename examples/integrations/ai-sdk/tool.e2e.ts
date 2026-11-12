import { expect, test } from "bun:test"
import { date, object, string } from "@tskm/core"
import { withJsonSchema } from "@tskm/core/json-schema"
import { generateText, InvalidToolInputError, TypeValidationError, tool } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import { type IssueLike, issueFields, rejectionOf } from "../shared/issues.ts"
import { staticUserSchema } from "../shared/static-user.ts"
import { invalidUser, userSchema, validUser } from "../shared/user-schema.ts"

/**
 * The AI SDK reads a tool's JSON Schema from `~standard.jsonSchema` and validates the tool
 * call with `~standard.validate`. `withStaticJsonSchema` serves the sidecar literals;
 * `withJsonSchema` walks the schema. The model is a `MockLanguageModelV4` from `ai/test`,
 * so no request leaves the process.
 */

/**
 * The document the model receives. `additionalProperties: false` is tskm's output for an
 * object, not something the SDK adds.
 */
const expectedInputSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    email: { type: "string", format: "email" },
    age: { type: "number" },
  },
  required: ["name", "email", "age"],
  additionalProperties: false,
}

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}

/** A model that makes one `createUser` call with `input`, then stops. */
function modelCalling(input: unknown) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "createUser",
          input: JSON.stringify(input),
        },
      ],
      finishReason: { unified: "tool-calls", raw: undefined },
      usage,
      warnings: [],
    },
  })
}

type DocumentedUser = ReturnType<typeof withJsonSchema<typeof userSchema>> | typeof staticUserSchema

/** `createUser` over a tskm schema that exposes `~standard.jsonSchema`. */
function createUser(received: unknown[], schema: DocumentedUser = withJsonSchema(userSchema)) {
  return tool({
    description: "Create a user",
    inputSchema: schema,
    execute: async (input) => {
      received.push(input)
      return input
    },
  })
}

/** The function-tool list the model receives for one `createUser` schema. */
async function toolsSent(schema: DocumentedUser) {
  const model = modelCalling(validUser)
  await generateText({ model, prompt: "Create Ada", tools: { createUser: createUser([], schema) } })
  const [call] = model.doGenerateCalls
  return JSON.parse(JSON.stringify(call?.tools))
}

test("the model receives the tskm JSON Schema document", async () => {
  expect(await toolsSent(withJsonSchema(userSchema))).toEqual([
    {
      type: "function",
      name: "createUser",
      description: "Create a user",
      inputSchema: expectedInputSchema,
    },
  ])
})

test("withStaticJsonSchema matches withJsonSchema on tool.inputSchema", async () => {
  const runtime = withJsonSchema(userSchema)
  const targets = ["draft-2020-12", "draft-07", "openapi-3.0"] as const
  for (const target of targets) {
    expect(staticUserSchema["~standard"].jsonSchema.input({ target })).toEqual(
      runtime["~standard"].jsonSchema.input({ target }),
    )
    expect(staticUserSchema["~standard"].jsonSchema.output({ target })).toEqual(
      runtime["~standard"].jsonSchema.output({ target }),
    )
  }
  expect(await toolsSent(staticUserSchema)).toEqual(await toolsSent(runtime))
})

test("a valid tool call runs when the schema is the static document", async () => {
  const received: unknown[] = []
  const result = await generateText({
    model: modelCalling(validUser),
    prompt: "Create Ada",
    tools: { createUser: createUser(received, staticUserSchema) },
  })

  expect(received).toEqual([validUser])
  expect(result.toolResults.map((part) => part.output)).toEqual([validUser])
})

test("a valid tool call runs the tool with the validated input", async () => {
  const received: unknown[] = []
  const result = await generateText({
    model: modelCalling(validUser),
    prompt: "Create Ada",
    tools: { createUser: createUser(received) },
  })

  expect(received).toEqual([validUser])
  expect(result.toolResults.map((part) => part.output)).toEqual([validUser])
})

test("an invalid tool call is rejected by tskm, and the tool does not run", async () => {
  const received: unknown[] = []
  const result = await generateText({
    model: modelCalling(invalidUser),
    prompt: "Create the bad user",
    tools: { createUser: createUser(received) },
  })

  expect(received).toEqual([])

  // The tool-error part keeps only the message. The error object stays on the invalid tool-call.
  expect(result.content.find((part) => part.type === "tool-error")).toMatchObject({
    toolName: "createUser",
    error: expect.stringContaining("Invalid input for tool createUser"),
  })
  const invalidCall = result.content.find(
    (part) => part.type === "tool-call" && part.invalid === true,
  )
  const invalidInput = invalidCall?.type === "tool-call" ? invalidCall.error : undefined
  expect(InvalidToolInputError.isInstance(invalidInput)).toBe(true)

  const typeError = (invalidInput as InvalidToolInputError).cause
  expect(TypeValidationError.isInstance(typeError)).toBe(true)
  const issues = (typeError as TypeValidationError).cause as IssueLike[]
  expect(issueFields(issues)).toEqual(["age", "email", "name"])
})

test("a plain tskm schema is refused, because the SDK reads only ~standard.jsonSchema", async () => {
  const model = modelCalling(validUser)
  const plain = tool({
    description: "Create a user",
    inputSchema: userSchema,
    execute: async (input) => input,
  })

  const error = await rejectionOf(
    generateText({ model, prompt: "Create Ada", tools: { createUser: plain } }),
  )
  expect((error as Error).message).toContain("does not support JSON Schema conversion")
  expect(model.doGenerateCalls).toEqual([])
})

test("a schema assembled at runtime that tskm cannot express fails before the model is called", async () => {
  const model = modelCalling({ at: "2026-11-10", name: "Ada" })
  const schedule = tool({
    description: "Schedule a user",
    inputSchema: withJsonSchema(object({ at: date(), name: string() })),
    execute: async () => "scheduled",
  })

  const error = await rejectionOf(
    generateText({ model, prompt: "Schedule Ada", tools: { schedule } }),
  )
  expect((error as Error).message).toMatch(/cannot convert schema type "date" to JSON Schema/)
  expect(model.doGenerateCalls).toEqual([])
})
