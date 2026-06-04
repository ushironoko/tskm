import { type GenericSchema, number, object, pipe, recursive, transform, union } from "@tskm/core"

// S3: the transform sits in a union option inside the cycle.
export const s3Schema = recursive(<S extends GenericSchema>(self: S) =>
  union([
    pipe(
      number(),
      transform((n: number) => String(n)),
    ),
    object({ next: self }),
  ]),
)
