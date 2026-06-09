import {
  array,
  number,
  object,
  optional,
  record,
  recursive,
  string,
  templateLiteral,
} from "@tskm/core"

// A recursive node, modeled DATA-FIRST, composing the structural SSoT primitives in one schema.
// Each primitive closes a gap between what the validator accepts and what the generated type says:
//
//   - `id` is a `templateLiteral`: the generated type is `node_${string}`, not a widened `string`,
//     so the type carries the same shape the runtime enforces.
//   - `label` is `optional` under `{ optionalKeys: true }` (the faithful-optional mode): the
//     generated key is omittable (`label?: string`), mirroring what the validator accepts, instead
//     of the default `label: string | undefined` (a required key with an `undefined` value).
//   - `attrs` is a `record` keyed by a `templateLiteral`: the generated index signature is templated
//     (`{ [K in `attr_${string}`]?: number }`), not a bare `{ [key: string]: number }`.
//   - `children` recurses through `self`.
//
// No hand-written `type Node`: `tskm gen` walks the runtime schema graph and materializes the alias
// (see node.schema.gen.ts). One declaration is the type, the validator, and the JSON Schema source.
export const nodeSchema = recursive((self) =>
  object(
    {
      id: templateLiteral(["node_", string()]),
      label: optional(string()),
      attrs: record(templateLiteral(["attr_", string()]), number()),
      children: array(self),
    },
    { optionalKeys: true },
  ),
)
