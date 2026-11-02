import { expect, test } from "bun:test"
import { H3, readValidatedBody } from "h3"
import { invalidUser, userSchema, validUser } from "../src/user-schema.ts"

function createApp() {
  const app = new H3()
  app.post("/users", async (event) => {
    const body = await readValidatedBody(event, userSchema)
    return body
  })
  return app
}

function post(body: unknown) {
  return createApp().request("/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

test("h3 readValidatedBody accepts a tskm schema", async () => {
  const response = await post(validUser)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(validUser)
})

test("h3 readValidatedBody rejects an invalid body", async () => {
  const response = await post(invalidUser)
  expect(response.status).toBe(400)
})
