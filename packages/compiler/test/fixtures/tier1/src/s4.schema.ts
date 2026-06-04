import { type GenericSchema, number, pipe, recursive, string, transform, tuple } from "@tskm/core"

// S4: the transform sits at a tuple position inside the cycle; the unroll must keep
// a REAL tuple (`[string, boolean, S4]`), not collapse to a union array.
export const s4Schema = recursive(<S extends GenericSchema>(self: S) =>
  tuple([
    string(),
    pipe(
      number(),
      transform((n: number) => n > 0),
    ),
    self,
  ]),
)
