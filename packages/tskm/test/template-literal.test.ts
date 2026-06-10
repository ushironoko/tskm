// biome-ignore-all lint/suspicious/noTemplateCurlyInString: assertions compare against template-literal type text that contains literal "${...}"
import { describe, expect, it } from "bun:test"
import {
  bigint,
  boolean,
  brand,
  lazy,
  literal,
  minLength,
  minValue,
  never_,
  null_,
  nullable,
  nullish,
  number,
  optional,
  picklist,
  pipe,
  readonly,
  safeParse,
  string,
  type TemplatePart,
  templateLiteral,
  transform,
  undefined_,
  union,
} from "../src/index.ts"

/**
 * Runtime validation for the `templateLiteral` schema (issue #18). The input is matched
 * against the concatenation pattern: fixed segments verbatim, placeholders per their kind.
 */
describe("templateLiteral runtime (#18)", () => {
  it("matches a fixed prefix plus a string placeholder", () => {
    const t = templateLiteral(["user_", string()])
    expect(safeParse(t, "user_ada").success).toBe(true)
    expect(safeParse(t, "user_").success).toBe(true)
    expect(safeParse(t, "admin_ada").success).toBe(false)
  })

  it("constrains an enum-and-number shape", () => {
    const t = templateLiteral([picklist(["a", "b"]), "-", number()])
    expect(safeParse(t, "a-12").success).toBe(true)
    expect(safeParse(t, "b-3.5").success).toBe(true)
    expect(safeParse(t, "c-12").success).toBe(false)
    expect(safeParse(t, "a-x").success).toBe(false)
  })

  it("rejects a non-string input", () => {
    const t = templateLiteral(["v", number()])
    expect(safeParse(t, 12).success).toBe(false)
  })

  it("escapes regex metacharacters in fixed segments", () => {
    const t = templateLiteral(["a.b+", string()])
    expect(safeParse(t, "a.b+c").success).toBe(true)
    // The `.` and `+` are literal, not regex operators.
    expect(safeParse(t, "axbxc").success).toBe(false)
  })

  it("reports a descriptive expected on mismatch", () => {
    const t = templateLiteral(["id-", number()])
    const r = safeParse(t, "id-x")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.message).toContain("`id-${number}`")
    }
  })
})

describe("templateLiteral type/runtime soundness (#18 review)", () => {
  it("an empty picklist placeholder matches nothing (output type is never)", () => {
    expect(safeParse(templateLiteral([picklist([])]), "").success).toBe(false)
  })

  it("bigint placeholder rejects a leading + and leading zeros", () => {
    const t = templateLiteral([bigint()])
    expect(safeParse(t, "0").success).toBe(true)
    expect(safeParse(t, "-12").success).toBe(true)
    expect(safeParse(t, "+1").success).toBe(false)
    expect(safeParse(t, "01").success).toBe(false)
  })

  it("number placeholder accepts the hex/binary/octal forms that `${number}` includes", () => {
    // These radix integer strings are members of `${number}` (verified with tsgo), so the
    // runtime regex must accept them or it would reject strings the emitted type allows.
    const t = templateLiteral([number()])
    expect(safeParse(t, "0x10").success).toBe(true)
    expect(safeParse(t, "0b1011").success).toBe(true)
    expect(safeParse(t, "0o17").success).toBe(true)
    expect(safeParse(t, "0xAF").success).toBe(true)
    // decimal/exponent forms still match
    expect(safeParse(t, "-3.14").success).toBe(true)
    expect(safeParse(t, "1e3").success).toBe(true)
    // `Infinity`/`NaN` are NOT in `${number}`, so they stay rejected (sound subset)
    expect(safeParse(t, "Infinity").success).toBe(false)
    expect(safeParse(t, "NaN").success).toBe(false)
    expect(safeParse(t, "abc").success).toBe(false)
    // a negative radix is not a `${number}` member, so it is rejected
    expect(safeParse(t, "-0x10").success).toBe(false)
  })

  it("bigint placeholder accepts the hex/binary/octal forms that `${bigint}` includes", () => {
    const t = templateLiteral([bigint()])
    expect(safeParse(t, "0x10").success).toBe(true)
    expect(safeParse(t, "0b1011").success).toBe(true)
    expect(safeParse(t, "0o17").success).toBe(true)
  })

  it("null placeholder matches only its literal text", () => {
    expect(safeParse(templateLiteral([null_()]), "null").success).toBe(true)
    expect(safeParse(templateLiteral([null_()]), "x").success).toBe(false)
  })

  it("an unsupported placeholder kind is a construction error", () => {
    // `lazy` output is string (a valid placeholder type), but its kind cannot be bounded
    // by a regex fragment, so it fails closed at construction rather than any-matching.
    expect(() => templateLiteral([lazy(() => string())])).toThrow()
  })
})

describe("templateLiteral rejects transforming placeholders (#18 review, fail-closed)", () => {
  it("a direct transforming pipe placeholder is a construction error", () => {
    // The pipe spreads its base, so its surface `type` is "string" while its OUTPUT type is
    // `number`. A regex built from the base would accept e.g. "vabc" though the inferred type
    // is `` `v${number}` ``, so construction fails closed rather than diverging.
    const transformed = pipe(
      string(),
      transform((value: string) => Number(value)),
    )
    expect(() => templateLiteral(["v", transformed])).toThrow()
  })

  it("a transform nested in a pipe's base schema is still caught", () => {
    // The OUTER pipe's own actions are validation-only (`minValue`), but its base — `pipe[0]`
    // — is itself a transforming pipe. The guard walks `pipe[0]`, so the nested transform is
    // not missed even though the outer action list carries no transformation.
    const nested = pipe(
      pipe(
        string(),
        transform((value: string) => Number(value)),
      ),
      minValue(0),
    )
    expect(() => templateLiteral(["v", nested])).toThrow()
  })

  it("a validation-only pipe placeholder is allowed (output type equals the base)", () => {
    // `minLength` does not change the output type, so the base `string` fragment stays sound
    // and the placeholder is accepted. (The validation itself is not re-run by the regex.)
    const validated = pipe(string(), minLength(1))
    const t = templateLiteral(["v", validated])
    expect(safeParse(t, "vabc").success).toBe(true)
    expect(safeParse(t, "v").success).toBe(true)
  })

  it("a runtime-identity transformation (readonly/brand) is also rejected (deliberate fail-closed)", () => {
    // `readonly`/`brand` keep the runtime value, so they could be allowed — but the guard
    // rejects the whole transformation kind rather than maintain a per-action allowlist a
    // future value-transform could slip through. These placeholders carry no runtime meaning
    // inside a regex, so the lost cases are contrived (note the redundant explicit type args
    // they need to typecheck as a placeholder at all).
    expect(() => templateLiteral(["v", pipe(string(), readonly<string>())])).toThrow()
    expect(() => templateLiteral(["v", pipe(string(), brand<string, "X">("X"))])).toThrow()
  })
})

describe("templateLiteral rejects non-finite numeric placeholders (#18 review, fail-closed)", () => {
  it("a finite numeric literal still matches its exact text", () => {
    // Guard regression check: finite numbers are unaffected — `literal(404)` infers
    // `` `s-404` `` and matches only "s-404".
    const t = templateLiteral(["s-", literal(404)])
    expect(safeParse(t, "s-404").success).toBe(true)
    expect(safeParse(t, "s-405").success).toBe(false)
  })

  it("a non-finite numeric literal is a construction error", () => {
    // `literal(Infinity)`/`literal(NaN)` widen their output type to `number`, but "Infinity"
    // and "NaN" are not members of `${number}`, so no fragment is sound — fail closed.
    expect(() => templateLiteral([literal(Number.POSITIVE_INFINITY)])).toThrow()
    expect(() => templateLiteral([literal(Number.NaN)])).toThrow()
  })

  it("a non-finite numeric picklist option is a construction error", () => {
    expect(() => templateLiteral([picklist([1, Number.NaN])])).toThrow()
  })
})

describe("templateLiteral rejects forged/foreign placeholders (#18 review, structural trust)", () => {
  it("a schema that lies about its `type` is rejected by the reference check", () => {
    // Take a real `number()` (output `number`, `reference` = the number factory) but lie that
    // its `type` is "string". The duck-typed switch trusted `type` and would have emitted the
    // permissive string fragment, accepting values outside the inferred `${number}` type. The
    // reference check (a schema's `reference` must be tskm's factory for its claimed `type`)
    // rejects it. The cast models a hand-forged schema the type system cannot vet.
    const forged = { ...number(), type: "string" } as unknown as ReturnType<typeof string>
    expect(() => templateLiteral(["v", forged])).toThrow()
  })

  it("a genuine tskm placeholder of the same type still passes the reference check", () => {
    // Guard regression check: the real `string()` (correct `reference`) is unaffected.
    const t = templateLiteral(["v", string()])
    expect(safeParse(t, "vanything").success).toBe(true)
  })

  // A foreign factory distinct from every tskm factory. It returns a real schema, so the
  // forged object below stays structurally a schema and only the identity check can
  // tell it apart from the genuine article.
  const foreignReference = () => string()

  const forgedPlaceholders: [string, TemplatePart][] = [
    ["string", { ...string(), reference: foreignReference }],
    ["number", { ...number(), reference: foreignReference }],
    ["bigint", { ...bigint(), reference: foreignReference }],
    ["boolean", { ...boolean(), reference: foreignReference }],
    ["null", { ...null_(), reference: foreignReference }],
    ["undefined", { ...undefined_(), reference: foreignReference }],
    ["never", { ...never_(), reference: foreignReference }],
    ["literal", { ...literal("a"), reference: foreignReference }],
    ["picklist", { ...picklist(["a"]), reference: foreignReference }],
    ["union", { ...union([literal("a")]), reference: foreignReference }],
    ["optional", { ...optional(literal("a")), reference: foreignReference }],
    ["nullable", { ...nullable(literal("a")), reference: foreignReference }],
    ["nullish", { ...nullish(literal("a")), reference: foreignReference }],
  ]

  it.each(
    forgedPlaceholders,
  )("a forged %s placeholder with a foreign reference is a construction error", (_type, forged) => {
    expect(() => templateLiteral([forged])).toThrow(/not tskm's own schema/)
  })
})

describe("templateLiteral placeholder fragments match exactly their output type's strings", () => {
  const cases: [string, string, boolean, TemplatePart][] = [
    ["boolean", "true", true, boolean()],
    ["boolean", "false", true, boolean()],
    ["boolean", "yes", false, boolean()],
    ["boolean", "", false, boolean()],
    ["undefined", "undefined", true, undefined_()],
    ["undefined", "undef", false, undefined_()],
    ["undefined", "", false, undefined_()],
    ["never", "", false, never_()],
    ["never", "x", false, never_()],
    ["optional", "a", true, optional(literal("a"))],
    ["optional", "undefined", true, optional(literal("a"))],
    ["optional", "null", false, optional(literal("a"))],
    ["optional", "", false, optional(literal("a"))],
    ["nullable", "a", true, nullable(literal("a"))],
    ["nullable", "null", true, nullable(literal("a"))],
    ["nullable", "undefined", false, nullable(literal("a"))],
    ["nullable", "", false, nullable(literal("a"))],
    ["nullish", "a", true, nullish(literal("a"))],
    ["nullish", "null", true, nullish(literal("a"))],
    ["nullish", "undefined", true, nullish(literal("a"))],
    ["nullish", "x", false, nullish(literal("a"))],
    ["union", "a", true, union([literal("a"), number()])],
    ["union", "42", true, union([literal("a"), number()])],
    ["union", "b", false, union([literal("a"), number()])],
    ["union", "undefined", false, union([literal("a"), number()])],
    ["empty union", "", false, union([])],
    ["empty union", "a", false, union([])],
  ]

  it.each(cases)("%s placeholder: %j -> %s", (_kind, input, expected, schema) => {
    expect(safeParse(templateLiteral([schema]), input).success).toBe(expected)
  })
})

describe("templateLiteral construction errors name their cause", () => {
  it("a transforming placeholder error points at the transform", () => {
    const transformed = pipe(
      string(),
      transform((value: string) => Number(value)),
    )
    expect(() => templateLiteral(["v", transformed])).toThrow(/transforming placeholder/)
  })

  it("a non-finite numeric literal error points at the non-finite value", () => {
    expect(() => templateLiteral([literal(Number.NaN)])).toThrow(/non-finite numeric placeholder/)
  })

  it("a nested templateLiteral placeholder is rejected as unsupported, naming its type", () => {
    expect(() => templateLiteral([templateLiteral(["x"])])).toThrow(
      /unsupported placeholder schema "templateLiteral"/,
    )
  })
})

describe("templateLiteral public contract", () => {
  it("exposes the schema discriminants", () => {
    const t = templateLiteral(["v", string()])
    expect(t.kind).toBe("schema")
    expect(t.type).toBe("templateLiteral")
    expect(t.async).toBe(false)
  })

  it("a mismatch issue is a schema-kind templateLiteral issue", () => {
    const r = safeParse(templateLiteral(["id-", number()]), "id-x")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues[0]?.kind).toBe("schema")
      expect(r.issues[0]?.type).toBe("templateLiteral")
    }
  })

  it("rejects a non-string input even when its string form would match the pattern", () => {
    // Only string INPUTS are template-literal members: the number 12 must fail although
    // String(12) is "12", which the pattern would match.
    expect(safeParse(templateLiteral([number()]), 12).success).toBe(false)
  })

  it("a matching parse is typed, so a piped transform runs on the value", () => {
    // `pipe` runs transformations only on a typed dataset, so the transformed output
    // observes that a successful match marks the dataset typed.
    const t = pipe(
      templateLiteral(["user_", string()]),
      transform((value: string) => value.toUpperCase()),
    )
    const r = safeParse(t, "user_ada")
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.output).toBe("USER_ADA")
    }
  })
})
