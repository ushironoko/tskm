import { safeParse } from "@tskm/core"
import type { Event } from "./event.schema.gen.ts"
import { eventSchema } from "./event.schema.ts"
import type { Node } from "./node.schema.gen.ts"
import { nodeSchema } from "./node.schema.ts"

// One schema is the single source of truth for three artifacts at once: the generated TYPE
// (imported below, concrete, no `Infer<…>`), the runtime VALIDATOR (`safeParse`), and the tag
// DISCRIMINATION (`discriminatedUnion`). The generated types and the validators agree because
// they come from the same declaration.

// 1. Structural fidelity: the generated `Node` mirrors exactly what `nodeSchema` accepts.
//    `id` is templated (`node_${string}`), `label` is omittable (`label?:`), and `attrs` is a
//    templated index signature. Each assignment below would fail `tsgo --noEmit` if codegen ever
//    widened the id to `string`, made `label` required, or dropped the templated key.
const leaf: Node = { id: "node_leaf", attrs: { attr_w: 1 }, children: [] }
const root: Node = {
  id: "node_root",
  label: "root", // optional: present here, omitted on `leaf`
  attrs: { attr_x: 10, attr_y: 20 },
  children: [leaf],
}
const nodeResult = safeParse(nodeSchema, root)
console.log("node valid:", nodeResult.success)

// A malformed id (wrong prefix) is rejected at runtime by the templateLiteral.
const badId = safeParse(nodeSchema, { id: "x_root", attrs: {}, children: [] })
console.log("bad id rejected:", !badId.success)

// 2. Tag discrimination: `discriminatedUnion` dispatches on `type` in O(1), and exposes the
//    tags as data so an exhaustive handler is DERIVED from the schema, not re-declared.
const events: Event[] = [
  { type: "created", id: "evt_1", at: 1 },
  { type: "renamed", id: "evt_2", title: "Title" },
]
for (const event of events) {
  switch (event.type) {
    case "created":
      console.log("created at:", event.at)
      break
    case "renamed":
      console.log("renamed to:", event.title)
      break
  }
}
console.log("event tags:", eventSchema.literals.join(", ")) // created, renamed
console.log("member for 'renamed' resolved from tag:", eventSchema.mapping.has("renamed"))

// 3. Closed shape: each member is an `exactObject`, so an undeclared key fails the parse with a
//    path-precise issue instead of being silently dropped.
const withUnknownKey = safeParse(eventSchema, { type: "created", id: "evt_3", at: 2, extra: true })
console.log("unknown key rejected:", !withUnknownKey.success)

// 4. Severity channel: `renamed.title` is deprecated. Its transform reports a `"warning"`, which
//    is non-fatal: the parse SUCCEEDS and the diagnostic rides `result.warnings`.
const deprecated = safeParse(eventSchema, { type: "renamed", id: "evt_4", title: "Old name" })
if (deprecated.success) {
  console.log(
    "renamed parsed with warnings:",
    deprecated.warnings.map((w) => w.message),
  )
}
