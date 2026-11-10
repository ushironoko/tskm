import {
  array,
  boolean,
  email,
  integer,
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  object,
  picklist,
  pipe,
  safeParse,
  string,
} from "../../../../packages/tskm/dist/index.mjs"

const bounded = (min: number, max: number) => pipe(string(), minLength(min), maxLength(max))

export const schema = object({
  id: pipe(number(), integer(), minValue(1)),
  name: bounded(1, 100),
  email: pipe(string(), minLength(3), maxLength(100), email()),
  role: picklist(["admin", "member", "guest"]),
  tags: array(bounded(1, 30)),
  active: boolean(),
  score: pipe(number(), integer(), minValue(0), maxValue(100)),
  address: object({
    city: bounded(1, 50),
    zip: bounded(1, 12),
  }),
})

export function parse(input: unknown): boolean {
  const result = safeParse(schema, input)
  if (!result.success) return false
  return result.output.id >= 1
}
