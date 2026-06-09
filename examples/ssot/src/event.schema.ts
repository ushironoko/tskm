import {
  discriminatedUnion,
  exactObject,
  literal,
  number,
  pipe,
  string,
  templateLiteral,
  transform,
} from "@tskm/core"

// A tagged, CLOSED union. Each member is an `exactObject`, so an undeclared key is rejected with
// a path-precise issue instead of silently dropped, which is the natural precondition for a sound
// discriminated union. `discriminatedUnion` reads the `type` tag at construction time and
// dispatches in O(1); `.literals` and `.mapping` expose the tag set as data (see main.ts).
//
// The `renamed` member carries a deprecated `title`. Its `transform` reports through the SEVERITY
// channel with `ctx.issue(message, "warning")`: a `"warning"` is non-fatal, so the parse still
// succeeds and the diagnostic rides `result.warnings` rather than failing the parse. Ids are
// `templateLiteral`s, so the generated type keeps `evt_${string}` instead of a widened `string`.
export const eventSchema = discriminatedUnion("type", [
  exactObject({
    type: literal("created"),
    id: templateLiteral(["evt_", string()]),
    at: number(),
  }),
  exactObject({
    type: literal("renamed"),
    id: templateLiteral(["evt_", string()]),
    title: pipe(
      string(),
      // Annotate the input (`value: string`): a `transform` infers its input from an explicit
      // parameter annotation, so the generated type resolves `title` to `string`, not `unknown`.
      transform((value: string, ctx) => {
        ctx.issue("`title` is deprecated; use `name`", "warning")
        return value
      }),
    ),
  }),
])
