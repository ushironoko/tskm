import { expect, test } from "bun:test"
import { initTRPC } from "@trpc/server"
import { type IssueLike, issueFields, rejectionOf } from "../src/issues.ts"
import { invalidUser, userSchema, validUser } from "../src/user-schema.ts"

const t = initTRPC.create()
const appRouter = t.router({
  createUser: t.procedure.input(userSchema).mutation(({ input }) => input),
})
const caller = appRouter.createCaller({})

test("trpc input accepts a tskm schema", async () => {
  expect(await caller.createUser(validUser)).toEqual(validUser)
})

test("trpc input rejects an invalid payload", async () => {
  const error = await rejectionOf(caller.createUser(invalidUser as unknown as typeof validUser))
  expect(error).toMatchObject({ code: "BAD_REQUEST" })
  // tRPC keeps the Standard Schema issues on the cause.
  const { cause } = error as { cause: { issues: IssueLike[] } }
  expect(issueFields(cause.issues)).toEqual(["age", "email", "name"])
})
