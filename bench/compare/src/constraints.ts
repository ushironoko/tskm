/**
 * Constraints that every library enforces with the same predicate.
 *
 * Email is one regular expression. It is written with explicit character classes and no
 * flags, so the same source works as a RegExp (zod, valibot, effect), as a JSON Schema
 * `pattern` (typebox), and inside an arktype `/.../` literal. tskm's `email()` uses the same
 * expression with the `i` flag (equivalent for these classes). The library-built-in email
 * validators disagree with this expression on ordinary inputs, so they are not used; see
 * README.md.
 */
export const emailSource = String.raw`^[\w+-]+(?:\.[\w+-]+)*@[\da-zA-Z]+(?:[.-][\da-zA-Z]+)*\.[a-zA-Z]{2,}$`

export const emailPattern = new RegExp(emailSource)

/** Upper bound for `id`. Without it, libraries that check `Number.isInteger` accept 2^53. */
export const maxId = Number.MAX_SAFE_INTEGER
