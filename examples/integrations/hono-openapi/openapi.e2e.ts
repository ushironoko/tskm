import { expect, test } from "bun:test"
import { type StandardJSONSchemaV1, withJsonSchema } from "@tskm/core/json-schema"
import { Hono } from "hono"
import { describeRoute, loadVendor, openAPIRouteHandler, resolver, validator } from "hono-openapi"
import { staticUserSchema } from "../shared/static-user.ts"
import { invalidUser, userSchema, validUser } from "../shared/user-schema.ts"

/**
 * hono-openapi 1.5.0 looks up a vendor function by `schema["~standard"].vendor`.
 * `tskm` is not one of the built-in names, so `/openapi` fails until the caller
 * passes `toJSONSchema` to `loadVendor`. That callback reads `~standard.jsonSchema`,
 * which `withJsonSchema` adds. The registration lives in this file only.
 */

/**
 * The document `toJSONSchema` asks tskm for (`draft-2020-12` input). For `userSchema`
 * this is the same object the AI SDK sample locks in `ai-sdk/tool.e2e.ts`.
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

const documented = withJsonSchema(userSchema)

function createApp(schema: typeof documented | typeof staticUserSchema = documented) {
  const app = new Hono()
  app.post(
    "/users",
    describeRoute({
      responses: {
        200: {
          description: "The created user",
          content: {
            "application/json": { schema: resolver(schema) },
          },
        },
      },
    }),
    validator("json", schema),
    (c) => c.json(c.req.valid("json")),
  )
  app.get(
    "/openapi",
    openAPIRouteHandler(app, {
      documentation: { info: { title: "Users", version: "1.0.0" } },
    }),
  )
  return app
}

/** The `toJSONSchema` hono-openapi 1.5.0 stores for a vendor. */
function toJSONSchema(schema: unknown) {
  return (schema as StandardJSONSchemaV1)["~standard"].jsonSchema.input({
    target: "draft-2020-12",
  })
}

type UserOperation = {
  requestBody?: { content?: { "application/json"?: { schema?: unknown } } }
  responses?: { "200"?: { content?: { "application/json"?: { schema?: unknown } } } }
}

test("GET /openapi is 500 until loadVendor, then 200 with the tskm schema", async () => {
  const unregistered = createApp()
  let failure: unknown
  unregistered.onError((error) => {
    failure = error
    return new Response(error.message, { status: 500 })
  })

  const denied = await unregistered.request("/openapi")
  expect(denied.status).toBe(500)
  expect(failure).toBeInstanceOf(Error)
  // The published class does not assign `this.name`, so `error.name` stays "Error".
  expect((failure as Error).constructor.name).toBe("UnsupportedVendorError")
  expect((failure as Error).message).toBe('standard-json: Unsupported schema vendor "tskm".')
  expect(await denied.text()).toBe((failure as Error).message)

  loadVendor("tskm", { toJSONSchema })

  const response = await createApp().request("/openapi")
  expect(response.status).toBe(200)
  const document = (await response.json()) as { paths?: { "/users"?: { post?: UserOperation } } }
  const post = document.paths?.["/users"]?.post

  expect(post?.requestBody?.content?.["application/json"]?.schema).toEqual(expectedSchema)
  expect(post?.responses?.["200"]?.content?.["application/json"]?.schema).toEqual(expectedSchema)

  const staticResponse = await createApp(staticUserSchema).request("/openapi")
  expect(staticResponse.status).toBe(200)
  expect(await staticResponse.json()).toEqual(document)
})

test("validator accepts the static schema and rejects an invalid body", async () => {
  loadVendor("tskm", { toJSONSchema })
  const app = createApp(staticUserSchema)

  const created = await app.request("/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validUser),
  })
  expect(created.status).toBe(200)
  expect(await created.json()).toEqual(validUser)

  const rejected = await app.request("/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(invalidUser),
  })
  expect(rejected.status).toBe(400)
})
