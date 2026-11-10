import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { emailPattern, maxId } from "../constraints.ts"

const bounded = (min: number, max: number) => Schema.String.check(Schema.isBetweenLength(min, max))

export const schema = Schema.Struct({
  id: Schema.Finite.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(maxId),
  ),
  name: bounded(1, 100),
  email: Schema.String.check(Schema.isBetweenLength(3, 100), Schema.isPattern(emailPattern)),
  role: Schema.Literals(["admin", "member", "guest"]),
  tags: Schema.Array(bounded(1, 30)),
  active: Schema.Boolean,
  score: Schema.Finite.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 100 })),
  address: Schema.Struct({
    city: bounded(1, 50),
    zip: bounded(1, 12),
  }),
})

// Effect's default is `errors: "first"`, which stops at the first failing field. The other
// adapters collect every issue on failure, so effect is set to `"all"` to match.
const decode = Schema.decodeUnknownResult(schema, { errors: "all" })

export function parse(input: unknown): boolean {
  const result = decode(input)
  if (!Result.isSuccess(result)) return false
  return result.success.id >= 1
}
