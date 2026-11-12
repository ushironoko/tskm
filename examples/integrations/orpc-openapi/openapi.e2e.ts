import { expect, test } from "bun:test"
import { type AnySchema, oc } from "@orpc/contract"
import { OpenAPIGenerator, openapi } from "@orpc/openapi"
import { withJsonSchema } from "@tskm/core/json-schema"
import { staticUserSchema } from "../shared/static-user.ts"
import { userSchema } from "../shared/user-schema.ts"

/**
 * `@orpc/openapi` 2.0.0-beta.50 reads Standard JSON Schema when `OpenAPIGenerator`
 * is constructed with no converters. The fallback calls
 * `jsonSchema.input({ target: "draft-2020-12" })`. A plain tskm schema has no
 * `jsonSchema` member, and the generator leaves `requestBody` off the operation.
 */

/**
 * The document oRPC places on `requestBody`. `additionalProperties: false` is tskm's
 * output for an object. Draft 2020-12 for this schema matches the AI SDK's draft-07
 * document in `ai-sdk/tool.e2e.ts`.
 */
const expectedSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    email: { type: "string", format: "email" },
    age: { type: "number" },
  },
  required: ["name", "email", "age"],
  additionalProperties: false,
}

function createUser(schema: AnySchema) {
  return {
    createUser: oc
      .meta(openapi({ method: "POST", path: "/users", operationId: "createUser" }))
      .input(schema)
      .output(schema),
  }
}

async function operation(schema: AnySchema) {
  const spec = await new OpenAPIGenerator().generate(createUser(schema), {
    base: { info: { title: "Users", version: "1.0.0" } },
  })
  return spec.paths?.["/users"]?.post
}

function mediaSchema(content: unknown): unknown {
  if (typeof content !== "object" || content === null || !("application/json" in content)) {
    return undefined
  }
  const media = content["application/json"]
  if (typeof media !== "object" || media === null || !("schema" in media)) return undefined
  return media.schema
}

function requestSchema(post: Awaited<ReturnType<typeof operation>>) {
  const requestBody = post?.requestBody
  return requestBody && "content" in requestBody ? mediaSchema(requestBody.content) : undefined
}

function responseSchema(post: Awaited<ReturnType<typeof operation>>) {
  const response = post?.responses?.["200"]
  return response && "content" in response ? mediaSchema(response.content) : undefined
}

test("withJsonSchema is written on the request body and the success response", async () => {
  const post = await operation(withJsonSchema(userSchema))

  expect(requestSchema(post)).toEqual(expectedSchema)
  expect(responseSchema(post)).toEqual(expectedSchema)
})

test("withStaticJsonSchema matches withJsonSchema on the request body", async () => {
  const runtime = await operation(withJsonSchema(userSchema))
  const compiled = await operation(staticUserSchema)

  expect(requestSchema(compiled)).toEqual(requestSchema(runtime))
  expect(responseSchema(compiled)).toEqual(responseSchema(runtime))
  expect(JSON.parse(JSON.stringify(compiled))).toEqual(JSON.parse(JSON.stringify(runtime)))
})

test("a plain tskm schema omits requestBody", async () => {
  const post = await operation(userSchema)

  expect(post?.operationId).toBe("createUser")
  expect(post?.requestBody).toBeUndefined()
})
