import {
  brand,
  type GenericSchema,
  number,
  object,
  optional,
  pipe,
  recursive,
  string,
  transform,
} from "@tskm/core"

// S6: brand + transform inside the cycle. The unroll triggers the known brand
// intersection absorption (`unknown & Brand = Brand` drops the body) — the
// data-property cross-check must reject the candidate and keep the structural
// skeleton (which renders the brand correctly and the transform as `unknown`).
export const s6Schema = recursive(<S extends GenericSchema>(self: S) =>
  pipe(
    object({
      id: string(),
      score: pipe(
        number(),
        transform((n: number) => n * 2),
      ),
      parent: optional(self),
    }),
    brand("Node"),
  ),
)
