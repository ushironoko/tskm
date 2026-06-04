import {
  array,
  type GenericSchema,
  number,
  object,
  pipe,
  recursive,
  string,
  transform,
} from "@tskm/core"

// S2: a transform INSIDE the recursive cycle, authored with the GENERIC arrow so the
// sentinel unroll can see through `build` and materialize the real output (number).
export const s2Schema = recursive(<S extends GenericSchema>(self: S) =>
  object({
    name: string(),
    age: pipe(
      number(),
      transform((n: number) => Math.floor(n)),
    ),
    children: array(self),
  }),
)
