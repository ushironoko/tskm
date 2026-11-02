import { expect, test } from "bun:test"
import { call, os } from "@orpc/server"
import { invalidUser, userSchema, validUser } from "../src/user-schema.ts"

const createUser = os.input(userSchema).handler(({ input }) => input)

test("orpc input accepts a tskm schema", async () => {
  expect(await call(createUser, validUser)).toEqual(validUser)
})

test("orpc input rejects an invalid payload", async () => {
  await expect(call(createUser, invalidUser as unknown as typeof validUser)).rejects.toThrow()
})
