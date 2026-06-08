import type { MutableDataset, OutputDataset } from "../types/dataset.ts"
import type { InferInput, InferOutput } from "../types/infer.ts"
import type { BaseSchemaAsync } from "../types/schema.ts"
import { _addIssue } from "../utils/_addIssue.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"
import type { Literal } from "./literal.ts"
import type { ObjectEntries, ObjectSchema } from "./object.ts"
import type { ObjectEntriesAsync, ObjectSchemaAsync } from "./objectAsync.ts"

/** A member of an async discriminated union: a sync or async object schema. */
type AsyncMember =
  | ObjectSchema<ObjectEntries, boolean>
  | ObjectSchemaAsync<ObjectEntriesAsync, boolean>

/** Members of an async discriminated union: object schemas sharing a literal-tagged key. */
export type DiscriminatedUnionMembersAsync = readonly AsyncMember[]

export interface DiscriminatedUnionSchemaAsync<
  TKey extends string,
  TMembers extends DiscriminatedUnionMembersAsync,
> extends BaseSchemaAsync<InferInput<TMembers[number]>, InferOutput<TMembers[number]>> {
  readonly type: "discriminated_union"
  readonly reference: typeof discriminatedUnionAsync
  readonly discriminant: TKey
  readonly options: TMembers
  readonly literals: readonly Literal[]
  readonly message: string | undefined
}

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

/**
 * Async counterpart of `discriminatedUnion`. Accepts sync or async object members and
 * awaits the single member selected by the discriminant tag. Always `async: true`.
 */
// @__NO_SIDE_EFFECTS__
export function discriminatedUnionAsync<
  const TKey extends string,
  const TMembers extends DiscriminatedUnionMembersAsync,
>(
  discriminant: TKey,
  members: TMembers,
  message?: string,
): DiscriminatedUnionSchemaAsync<TKey, TMembers> {
  const lookup = new Map<Literal, AsyncMember>()
  const literals: Literal[] = []
  for (const member of members) {
    const entry = (member.entries as ObjectEntries)[discriminant]
    if (entry === undefined) {
      throw new Error(
        `discriminatedUnionAsync: a member is missing the discriminant key "${discriminant}"`,
      )
    }
    const tags = discriminantTags(entry)
    if (tags.length === 0) {
      throw new Error(
        `discriminatedUnionAsync: the discriminant "${discriminant}" must be a literal or picklist on every member`,
      )
    }
    for (const tag of tags) {
      if (lookup.has(tag)) {
        throw new Error(`discriminatedUnionAsync: duplicate discriminant value ${formatTag(tag)}`)
      }
      lookup.set(tag, member)
      literals.push(tag)
    }
  }

  const expected = `${discriminant} = ${literals.map(formatTag).join(" | ")}`

  return {
    kind: "schema",
    type: "discriminated_union",
    reference: discriminatedUnionAsync,
    expects: members.map((member) => member.expects).join(" | "),
    async: true,
    discriminant,
    options: members,
    literals,
    message,
    get "~standard"() {
      return _getStandardProps(this)
    },
    async "~run"(dataset, config) {
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
        _addIssue(
          dataset,
          { kind: "schema", type: "discriminated_union", expected, message },
          config,
        )
        return out as unknown as OutputDataset<InferOutput<TMembers[number]>>
      }
      const memberDataset = await member["~run"]({ value: input }, config)
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
