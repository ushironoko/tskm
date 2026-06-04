import {
  brand,
  type GenericSchema,
  number,
  object,
  pipe,
  recursive,
  string,
  transform,
  union,
} from "@tskm/core"

// S7: a UNION root whose transform branch is brand-absorbed. dataKeys is empty
// (non-object root) so the data-key cross-check is vacuous, and the brand
// absorption makes the fixpoint oracle vacuous — the dedicated non-object brand
// gate must reject the Tier-1 candidate and keep the structural skeleton, whose
// honest `unknown & Brand` is strictly more correct than a silently body-dropped
// `{ "~brand": "Leaf" }` branch.
export const s7Schema = recursive(<S extends GenericSchema>(self: S) =>
  union([
    object({ label: string(), next: self }),
    pipe(
      object({ leaf: number() }),
      transform((x: { leaf: number }) => ({ doubled: x.leaf * 2 })),
      brand("Leaf"),
    ),
  ]),
)
