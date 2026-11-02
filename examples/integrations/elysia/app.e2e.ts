import { expect, test } from "bun:test"
import { Elysia } from "elysia"
import { invalidUser, userSchema, validUser } from "../src/user-schema.ts"

function createApp() {
  return new Elysia().post("/users", ({ body }) => body, {
    body: userSchema,
  })
}

function post(body: unknown) {
  return createApp().handle(
    new Request("http://localhost/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

test("elysia body accepts a tskm schema", async () => {
  const response = await post(validUser)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(validUser)
})

test("elysia body rejects an invalid payload", async () => {
  const response = await post(invalidUser)
  expect(response.status).toBe(422)
})
