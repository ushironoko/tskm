import {
  type GenericSchema,
  object,
  optional,
  pipe,
  recursive,
  string,
  transform,
} from "@tskm/core"

// S5: the self position sits under `optional` while a transform leaf sits beside it.
export const s5Schema = recursive(<S extends GenericSchema>(self: S) =>
  object({
    val: optional(self),
    len: pipe(
      string(),
      transform((s: string) => s.length),
    ),
  }),
)
