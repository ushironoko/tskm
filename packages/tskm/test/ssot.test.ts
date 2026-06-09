import { describe, expect, it } from "bun:test"
import { expectTypeOf } from "expect-type"
import {
  discriminatedUnion,
  type InferOutput,
  literal,
  number,
  object,
  optional,
  record,
  safeParse,
  string,
  templateLiteral,
} from "../src/index.ts"

/**
 * Single-source-of-truth integration (meta-issue #24): one schema that composes the new
 * primitives — a `discriminatedUnion` of an `exact` faithful-optional object with a
 * `templateLiteral` id, and a member holding a `record` keyed by a `templateLiteral` — and the
 * runtime output, `InferOutput`, and the tag->member mapping all agree at the composition seam.
 * The compiler-emitted-type view of the same composition is pinned by the compiler integration
 * suite (fixtures/ssot).
 */
const userSchema = object(
  {
    kind: literal("user"),
    id: templateLiteral(["user_", string()]),
    nickname: optional(string()),
  },
  { optionalKeys: true, rest: "exact" },
)

const eventSchema = object({
  kind: literal("event"),
  tags: record(templateLiteral(["tag_", string()]), number()),
})

const entitySchema = discriminatedUnion("kind", [userSchema, eventSchema])

type Entity = InferOutput<typeof entitySchema>

describe("SSoT composition: runtime output, InferOutput, and discrimination agree (#24)", () => {
  it("InferOutput is the faithful tag-narrowed union (optional key omittable, templated id)", () => {
    // `nickname` is omittable (faithful optional), `id` is the template-literal type, and the
    // event member carries a record keyed by a template literal. Asserted via assignability so
    // the check does not depend on how a mapped/partial record type renders.
    expectTypeOf<{ kind: "user"; id: `user_${string}` }>().toExtend<Entity>()
    expectTypeOf<{ kind: "user"; id: `user_${string}`; nickname: string }>().toExtend<Entity>()
    expectTypeOf<{ kind: "event"; tags: Record<`tag_${string}`, number> }>().toExtend<Entity>()
    // A non-template id is outside the type (the template-literal field is faithful).
    expectTypeOf<{ kind: "user"; id: "admin_x" }>().not.toExtend<Entity>()
    // The discriminant narrows: a user value's `id` is the templated type, not plain string.
    type UserId = Extract<Entity, { kind: "user" }>["id"]
    expectTypeOf<UserId>().toEqualTypeOf<`user_${string}`>()
  })

  it("runtime parses a user, omits the missing optional key (faithful mode)", () => {
    const r = safeParse(entitySchema, { kind: "user", id: "user_ada" })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toEqual({ kind: "user", id: "user_ada" })
      expect("nickname" in r.output).toBe(false)
      // The runtime output is assignable to InferOutput (the two views agree).
      const typed: Entity = r.output
      expect(typed.kind).toBe("user")
    }
  })

  it("rejects an unknown top-level key via the exact member, reached by tag dispatch", () => {
    const r = safeParse(entitySchema, { kind: "user", id: "user_ada", extra: 1 })
    expect(r.success).toBe(false)
  })

  it("rejects a malformed templateLiteral id under the selected member", () => {
    const r = safeParse(entitySchema, { kind: "user", id: "admin_ada" })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.path).toEqual([{ key: "id" }])
    }
  })

  it("validates a record key (templateLiteral) and reports the offending key on the path", () => {
    const ok = safeParse(entitySchema, { kind: "event", tags: { tag_a: 1, tag_b: 2 } })
    expect(ok.success).toBe(true)
    const bad = safeParse(entitySchema, { kind: "event", tags: { nope: 1 } })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.issues[0]?.path).toEqual([{ key: "tags" }, { key: "nope" }])
    }
  })

  it("derives a tag -> member registry from the schema (no re-declaration)", () => {
    expect(entitySchema.discriminant).toBe("kind")
    expect(entitySchema.mapping.get("user")).toBe(userSchema)
    expect(entitySchema.mapping.get("event")).toBe(eventSchema)
    // A consumer can build an exhaustive tag -> handler map straight off the schema.
    const handlers = new Map(
      [...entitySchema.mapping.keys()].map((tag) => [tag, () => tag] as const),
    )
    expect([...handlers.keys()].sort()).toEqual(["event", "user"])
  })
})
