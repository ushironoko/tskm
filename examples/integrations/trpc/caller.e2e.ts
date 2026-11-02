import { expect, test } from "bun:test"
import { initTRPC } from "@trpc/server"
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
  await expect(caller.createUser(invalidUser as unknown as typeof validUser)).rejects.toThrow()
})
