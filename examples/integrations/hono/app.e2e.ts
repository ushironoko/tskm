import { expect, test } from "bun:test"
import { sValidator } from "@hono/standard-validator"
import { Hono } from "hono"
import { type IssueLike, issueFields } from "../shared/issues.ts"
import { invalidUser, userSchema, validUser } from "../shared/user-schema.ts"

function createApp() {
  return new Hono().post("/users", sValidator("json", userSchema), (c) => {
    return c.json(c.req.valid("json"))
  })
}

function post(body: unknown) {
  return createApp().request("/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

test("hono sValidator accepts a tskm schema", async () => {
  const response = await post(validUser)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(validUser)
})

test("hono sValidator rejects an invalid body", async () => {
  const response = await post(invalidUser)
  expect(response.status).toBe(400)
  const body = (await response.json()) as { error: IssueLike[] }
  expect(issueFields(body.error)).toEqual(["age", "email", "name"])
})
