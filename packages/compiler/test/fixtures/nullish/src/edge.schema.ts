import { null_, nullable, nullish, number, string, union } from "@tskm/core"

// Top-level nullable / nullish / union-with-null. These are the shapes that the
// `__P<T> = { [K in keyof T]: T[K] } & {}` query wrapper could silently strip
// `null`/`undefined` from (no surrounding `object`, so the union is the whole type).
export const maybeName = nullable(string())
export const maybeAge = nullish(number())
export const idOrCode = union([string(), number(), null_()])
