import { expect, test } from "bun:test"
import { chat, convertSchemaToJsonSchema, toolDefinition } from "@tanstack/ai"
import { fakeText } from "@tanstack/ai/testing"
import { withJsonSchema } from "@tskm/core/json-schema"
import { rejectionOf } from "../shared/issues.ts"
import { staticUserSchema } from "../shared/static-user.ts"
import { invalidUser, userSchema, validUser } from "../shared/user-schema.ts"

/**
 * TanStack AI 1.4.0 reads `~standard.jsonSchema.input({ target: "draft-07" })` when a
 * tool is sent to the model (`convertSchemaToJsonSchema`). A Standard Schema with no
 * `jsonSchema` member throws. The adapter is `fakeText` from `@tanstack/ai/testing`,
 * so no request leaves the process.
 *
 * `withStaticJsonSchema` serves the sidecar. `withJsonSchema` walks the schema. The
 * tool definition the model receives is the same document either way.
 */

/**
 * The document TanStack places on the tool. For `userSchema` this matches the AI SDK
 * sample in `ai-sdk/tool.e2e.ts` (draft-07, and draft-2020-12 is the same object).
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

type ToolSchema = typeof staticUserSchema | ReturnType<typeof withJsonSchema<typeof userSchema>>

function createUser(schema: ToolSchema, received: unknown[]) {
  return toolDefinition({
    name: "createUser",
    description: "Create a user",
    inputSchema: schema,
  }).server(async (input) => {
    received.push(input)
    return input
  })
}

function toolInputs(tools: unknown) {
  if (!Array.isArray(tools)) return tools
  return tools.map((tool) => {
    const record = tool as { name?: unknown; description?: unknown; inputSchema?: unknown }
    return {
      name: record.name,
      description: record.description,
      inputSchema: record.inputSchema,
    }
  })
}

/** The tools the fake model receives on the first call. */
async function toolsSent(schema: ToolSchema) {
  const fake = fakeText()
  let tools: unknown
  fake.setResponses([
    (call) => {
      tools = call.request.tools
      return { text: "ok" }
    },
  ])
  for await (const _chunk of chat({
    adapter: fake,
    messages: [{ role: "user", content: "Create Ada" }],
    threadId: "schema",
    tools: [createUser(schema, [])],
  })) {
    // Drain the scripted stream.
  }
  return tools
}

type Chunk = { type: string; content?: unknown; message?: string }

async function runCall(schema: ToolSchema, input: unknown) {
  const fake = fakeText()
  const received: unknown[] = []
  fake.setResponses([{ toolCalls: [{ name: "createUser", input }] }, { text: "done" }])
  const chunks: Chunk[] = []
  for await (const chunk of chat({
    adapter: fake,
    messages: [{ role: "user", content: "Create Ada" }],
    threadId: "call",
    tools: [createUser(schema, received)],
  })) {
    chunks.push(chunk as Chunk)
  }
  return { received, chunks, callCount: fake.state.callCount }
}

function chunkText(chunks: readonly Chunk[]) {
  return chunks
    .map((chunk) => {
      if (typeof chunk.content === "string") return chunk.content
      if (typeof chunk.message === "string") return chunk.message
      return ""
    })
    .join("\n")
}

test("withStaticJsonSchema matches withJsonSchema on the tool definition", async () => {
  const runtime = withJsonSchema(userSchema)
  const staticTools = toolInputs(await toolsSent(staticUserSchema))
  const runtimeTools = toolInputs(await toolsSent(runtime))

  expect(staticTools).toEqual(runtimeTools)
  expect(staticTools).toEqual([
    {
      name: "createUser",
      description: "Create a user",
      inputSchema: expectedInputSchema,
    },
  ])
  expect(convertSchemaToJsonSchema(staticUserSchema)).toEqual(convertSchemaToJsonSchema(runtime))
})

test("a valid tool call runs the tool with the validated input", async () => {
  const { received, chunks } = await runCall(staticUserSchema, validUser)

  expect(received).toEqual([validUser])
  expect(chunkText(chunks)).not.toContain("Input validation failed")
})

test("an invalid tool call is rejected by tskm, and the tool does not run", async () => {
  const { received, chunks, callCount } = await runCall(staticUserSchema, invalidUser)
  const text = chunkText(chunks)

  expect(received).toEqual([])
  expect(callCount).toBeGreaterThan(0)
  expect(text).toContain("Input validation failed for tool createUser")
  expect(text).toContain("min_length")
  expect(text).toContain("email")
  expect(text).toContain("number")
})

test("a plain tskm schema throws because it does not expose a JSON Schema converter", async () => {
  expect(() => convertSchemaToJsonSchema(userSchema)).toThrow(
    /does not expose a JSON Schema converter/,
  )

  const fake = fakeText()
  fake.setResponses([{ text: "nope" }])
  const error = await rejectionOf(
    (async () => {
      for await (const _chunk of chat({
        adapter: fake,
        messages: [{ role: "user", content: "Create Ada" }],
        threadId: "plain",
        // The throw is the assertion. Leave TanStack's error logger off so the
        // expected failure does not print a stack.
        debug: false,
        tools: [
          toolDefinition({
            name: "createUser",
            description: "Create a user",
            inputSchema: userSchema,
          }),
        ],
      })) {
        // Drain. Conversion throws while the tools are prepared, before the fake runs.
      }
    })(),
  )

  expect((error as Error).message).toContain("does not expose a JSON Schema converter")
  expect(fake.state.callCount).toBe(0)
})
