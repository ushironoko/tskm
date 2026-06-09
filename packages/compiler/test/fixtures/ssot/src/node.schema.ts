import {
  array,
  type Infer,
  number,
  object,
  optional,
  record,
  recursive,
  string,
  templateLiteral,
} from "@tskm/core"

// A recursive schema whose node composes the SSoT primitives: a `templateLiteral` id (#18),
// a faithful-optional `label` (#17), a `record` keyed by a `templateLiteral` (#19), and a
// recursive `children`. Being recursive forces the STRUCTURAL walker, so the emitter renders
// these cases from a REAL schema graph through the full generate()+tsgo pipeline (not the
// synthetic SchemaLike objects the unit tests use). The emitted type must mirror InferOutput.
type Node = {
  id: `node_${string}`
  label?: string
  attrs: { [k in `attr_${string}`]?: number }
  children: Node[]
}

export const nodeSchema = recursive<Node>((self) =>
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

export type NodeType = Infer<typeof nodeSchema>
