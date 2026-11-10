import { expect, test } from "bun:test"
import { call, os } from "@orpc/server"
import { type IssueLike, issueFields, rejectionOf } from "../shared/issues.ts"
import { invalidUser, userSchema, validUser } from "../shared/user-schema.ts"

const createUser = os.input(userSchema).handler(({ input }) => input)

test("orpc input accepts a tskm schema", async () => {
  expect(await call(createUser, validUser)).toEqual(validUser)
})

test("orpc input rejects an invalid payload", async () => {
  const error = await rejectionOf(call(createUser, invalidUser as unknown as typeof validUser))
  expect(error).toMatchObject({ code: "BAD_REQUEST" })
  const { data } = error as { data: { issues: IssueLike[] } }
  expect(issueFields(data.issues)).toEqual(["age", "email", "name"])
})
