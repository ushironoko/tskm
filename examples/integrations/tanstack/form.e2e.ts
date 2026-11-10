import { expect, test } from "bun:test"
import { FormApi } from "@tanstack/form-core"
import { invalidUser, userSchema, validUser } from "../src/user-schema.ts"

function formWith(values: typeof validUser) {
  return new FormApi({
    defaultValues: values,
    validators: {
      onChange: userSchema,
    },
  })
}

test("tanstack form onChange accepts a tskm schema", () => {
  const result = formWith(validUser).validateSync("change")
  expect(result.hasErrored).toBe(false)
})

test("tanstack form onChange rejects an invalid value", () => {
  const result = formWith(invalidUser as unknown as typeof validUser).validateSync("change")
  expect(result.hasErrored).toBe(true)
  expect(Object.keys(result.fieldsErrorMap).sort()).toEqual(["age", "email", "name"])
})
