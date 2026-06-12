export interface PlaygroundExample {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly schema: string
  readonly input: string
}

export const examples: readonly PlaygroundExample[] = [
  {
    id: "user-profile",
    label: "User profile",
    description: "object, pipe, validation action, optional key",
    schema: `object(
  {
    name: pipe(string(), minLength(2)),
    email: pipe(string(), email()),
    age: optional(pipe(number(), integer(), minValue(18))),
    roles: array(picklist(["owner", "admin", "viewer"])),
  },
  { rest: "exact", optionalKeys: true },
)`,
    input: `{
  "name": "A",
  "email": "not-an-email",
  "age": 17,
  "roles": ["owner", "guest"],
  "unexpected": true
}`,
  },
  {
    id: "discriminated-union",
    label: "Discriminated union",
    description: "literal dispatch with member-local diagnostics",
    schema: `discriminatedUnion("kind", [
  object({
    kind: literal("circle"),
    radius: pipe(number(), minValue(1)),
  }),
  object({
    kind: literal("square"),
    side: pipe(number(), minValue(1)),
  }),
])`,
    input: `{
  "kind": "circle",
  "radius": 0
}`,
  },
  {
    id: "transform-warning",
    label: "Transform warning",
    description: "successful parse with non-fatal warning issue",
    schema: `pipe(
  string(),
  nonEmpty(),
  transform((value, ctx) => {
    if (value !== value.trim()) {
      ctx.issue("trimmed surrounding whitespace", "warning")
    }
    return value.trim()
  }),
)`,
    input: `"  tskm@example.com  "`,
  },
]
