import { expect, test } from "bun:test"
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema"
import { invalidUser, userSchema, validUser } from "../src/user-schema.ts"

const resolver = standardSchemaResolver(userSchema)

const options = {
  fields: {},
  shouldUseNativeValidation: false,
  criteriaMode: "firstError",
} as Parameters<typeof resolver>[2]

test("standardSchemaResolver accepts a tskm schema", async () => {
  const result = await resolver(validUser, undefined, options)
  expect(result.errors).toEqual({})
  expect(result.values).toEqual(validUser)
})

test("standardSchemaResolver rejects an invalid value", async () => {
  const result = await resolver(invalidUser as unknown as typeof validUser, undefined, options)
  expect(result.values).toEqual({})
  expect(result.errors).not.toEqual({})
})
