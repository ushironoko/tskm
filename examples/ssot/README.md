# @tskm/example-ssot

One schema as the **single source of truth** for three artifacts at once: the generated
TypeScript **type**, the runtime **validator**, and the tag-based **discrimination** that routes
a value to its variant. The three views agree because they are all derived from one declaration.

This example composes the primitives that make that hold: a `templateLiteral` id, a faithful
optional key, a `record` keyed by a template literal, an `exactObject` closed shape, a
`discriminatedUnion` with O(1) tag dispatch, and the issue severity channel.

## 1. Structural fidelity — `templateLiteral`, faithful optional, keyed `record`

[`src/node.schema.ts`](src/node.schema.ts) is a recursive node, written data-first. Three
primitives each close a gap between what the validator accepts and what the generated type says:

```ts
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
```

`tskm gen` walks the runtime schema graph and materializes the alias
([`node.schema.gen.ts`](src/node.schema.gen.ts)):

```ts
export type Node = {
  id: `node_${string}`;
  label?: string;
  attrs: {
    [K in `attr_${string}`]?: number
  };
  children: Node[]
}
```

The id keeps its `node_${string}` shape instead of widening to `string`. `label` is omittable
(`label?:`) because the object opts into the faithful-optional mode with `{ optionalKeys: true }`,
rather than the default `label: string | undefined` (a required key with an `undefined` value).
The `attrs` key is templated (`attr_${string}`), not a bare `{ [key: string]: number }`. Every one
of these is also enforced at runtime, so a wrong id prefix or an out-of-pattern key is rejected by
`safeParse`.

## 2. Tag discrimination — `discriminatedUnion` and `exactObject`

[`src/event.schema.ts`](src/event.schema.ts) is a tagged, closed union. Each member is an
`exactObject`, so an undeclared key is rejected with a path-precise issue instead of silently
dropped, which is the natural precondition for a sound discriminated union:

```ts
export const eventSchema = discriminatedUnion("type", [
  exactObject({ type: literal("created"), id: templateLiteral(["evt_", string()]), at: number() }),
  exactObject({ type: literal("renamed"), id: templateLiteral(["evt_", string()]), title: /* … */ }),
])
```

`discriminatedUnion` reads the `type` tag at construction time and dispatches in O(1), one `Map`
lookup per parse, instead of trying each member linearly like a plain `union`. The tags are also
exposed as data, so an exhaustive handler is derived from the schema rather than re-declared:
`eventSchema.literals` lists the tags and `eventSchema.mapping` resolves a tag to its member
schema. The generated `Event` type is the union the members describe, narrowing on `type`
([`event.schema.gen.ts`](src/event.schema.gen.ts)).

## 3. Severity channel — non-fatal warnings

The `renamed` member carries a deprecated `title`. Its `transform` reports through the severity
channel with `ctx.issue(message, "warning")`. A `"warning"` is non-fatal, so the parse still
succeeds and the diagnostic rides `result.warnings` rather than failing the parse:

```ts
const result = safeParse(eventSchema, { type: "renamed", id: "evt_1", title: "Old name" })
// result.success === true
// result.warnings === [{ message: "`title` is deprecated; use `name`", … }]
```

[`src/main.ts`](src/main.ts) exercises all three: the faithful node type, the discriminated
dispatch and its metadata, the closed-shape rejection, and the warning channel.

## Generate

From the repository root (after `bun install` + `bun run build`):

```bash
bun packages/compiler/dist/cli.mjs gen --root examples/ssot
# in a published project this is simply:  bunx tskm gen
```

The recursive `nodeSchema` is resolved by an isolated worker that imports the schema module, so
the worker runtime must be able to import `.ts` (bun here, or `worker.execPath` in `tskm.config.ts`).

## Run

```bash
bun examples/ssot/src/main.ts
```

`tsconfig.json` maps `@tskm/core` to the workspace source via `paths` so the checker can resolve
the inferred output type. In a real project `@tskm/core` is a normal dependency and no `paths`
entry is needed.
