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

// A recursive ADT with NO hand-written type. `tskm gen` materializes
//   type Category = { name: string; depth: number; children: Category[] }
// The generic arrow lets the compiler resolve the transform output (number) through
// the one-level unroll; a plain `(self) => …` arrow works too, with transform
// positions degrading to an honest `unknown`.
export const categorySchema = recursive(<S extends GenericSchema>(self: S) =>
  object({
    name: string(),
    depth: pipe(
      number(),
      transform((n: number) => Math.trunc(n)),
    ),
    children: array(self),
  }),
)
