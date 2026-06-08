import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { BaseSchema } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import type { Literal } from "./literal.ts"
import type { ObjectEntries, ObjectSchema } from "./object.ts"

/**
 * Members of a discriminated union: object schemas sharing a literal-tagged key.
 *
 * The constraint that each member's discriminant entry is a `literal`/`picklist` is
 * enforced at CONSTRUCTION time (a throw), not at the type level: members are typed only
 * as object schemas. A full type-level guarantee (the entry at the discriminant key must
 * extend `LiteralSchema`/`PicklistSchema`) is deliberately left out for now to keep the
 * member type simple; the construction throw is the authoritative guard.
 */
export type DiscriminatedUnionMembers = readonly ObjectSchema<ObjectEntries, boolean>[]

export interface DiscriminatedUnionSchema<
  TKey extends string,
  TMembers extends DiscriminatedUnionMembers,
> extends BaseSchema<InferInput<TMembers[number]>, InferOutput<TMembers[number]>> {
  readonly type: "discriminated_union"
  readonly reference: typeof discriminatedUnion
  /** The discriminant key every member tags. */
  readonly discriminant: TKey
  /** Members, exposed as `options` so the compiler reuses the union emission path. */
  readonly options: TMembers
  /** The full set of tag literals, derived from the members' discriminant entries. */
  readonly literals: readonly Literal[]
  readonly message: string | undefined
}

/** Reads the tag literal(s) a member declares at the discriminant key. */
function discriminantTags(entry: unknown): Literal[] {
  const node = entry as { type?: unknown; literal?: unknown; options?: unknown }
  if (node.type === "literal") {
    return [node.literal as Literal]
  }
  if (node.type === "picklist" && Array.isArray(node.options)) {
    return node.options as Literal[]
  }
  return []
}

function formatTag(tag: Literal): string {
  return typeof tag === "string" ? `"${tag}"` : String(tag)
}

// @__NO_SIDE_EFFECTS__
export function discriminatedUnion<
  const TKey extends string,
  const TMembers extends DiscriminatedUnionMembers,
>(
  discriminant: TKey,
  members: TMembers,
  message?: string,
): DiscriminatedUnionSchema<TKey, TMembers> {
  // Build the tag -> member lookup once, at construction time. Misuse (a member missing
  // the discriminant, a non-literal discriminant, or a duplicate tag) is a construction
  // error, not a silent runtime surprise.
  const lookup = new Map<Literal, ObjectSchema<ObjectEntries, boolean>>()
  const literals: Literal[] = []
  for (const member of members) {
    const entry = member.entries[discriminant]
    if (entry === undefined) {
      throw new Error(
        `discriminatedUnion: a member is missing the discriminant key "${discriminant}"`,
      )
    }
    const tags = discriminantTags(entry)
    if (tags.length === 0) {
      throw new Error(
        `discriminatedUnion: the discriminant "${discriminant}" must be a literal or picklist on every member`,
      )
    }
    for (const tag of tags) {
      if (lookup.has(tag)) {
        throw new Error(`discriminatedUnion: duplicate discriminant value ${formatTag(tag)}`)
      }
      lookup.set(tag, member)
      literals.push(tag)
    }
  }

  const expected = `${discriminant} = ${literals.map(formatTag).join(" | ")}`

  return {
    kind: "schema",
    type: "discriminated_union",
    reference: discriminatedUnion,
    expects: members.map((member) => member.expects).join(" | "),
    async: false,
    discriminant,
    options: members,
    literals,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      const out = dataset as MutableDataset
      const input = out.value
      if (input === null || typeof input !== "object" || Array.isArray(input)) {
        _addIssue(
          dataset,
          { kind: "schema", type: "discriminated_union", expected: "Object", message },
          config,
        )
        return out as unknown as OutputDataset<InferOutput<TMembers[number]>>
      }
      const tag = (input as Record<string, unknown>)[discriminant] as Literal
      const member = lookup.get(tag)
      if (member === undefined) {
        // Authoritative discriminant: an unknown/absent tag is rejected here rather than
        // falling through to a permissive member.
        _addIssue(
          dataset,
          { kind: "schema", type: "discriminated_union", expected, message },
          config,
        )
        return out as unknown as OutputDataset<InferOutput<TMembers[number]>>
      }
      // O(1) dispatch: validate ONLY the selected member, and propagate its in-member
      // violations (a wrong non-discriminant field still fails, with the member's paths).
      const memberDataset = member["~run"]({ value: input }, config)
      out.typed = memberDataset.typed
      out.value = memberDataset.value
      if (memberDataset.issues) {
        out.issues = out.issues
          ? [...out.issues, ...memberDataset.issues]
          : [...memberDataset.issues]
      }
      return out as unknown as OutputDataset<InferOutput<TMembers[number]>>
    },
  }
}
