import { describe, expect, it } from "bun:test"
import { reservedSidecarNames } from "../src/emit.ts"
import { referenceNamedParts } from "../src/named-parts.ts"

// Pure rewrite of emitted alias bodies (no checker). Each case names the shape it guards:
// the text is what the checker prints, so the inputs are single-line TypeScript type text.

const rewrite = (
  entries: ReadonlyArray<readonly [string, string]>,
  reserved: ReadonlySet<string> = new Set(),
): string[] =>
  referenceNamedParts(
    entries.map(([typeName, body]) => ({ typeName, body })),
    reserved,
  ).map((entry) => entry.body)

const ADDRESS = "{ street: string; city: string }"
const SHAPE_OBJECTS = '{ kind: "circle"; radius: number } | { kind: "square"; side: number }'

describe("referenceNamedParts: object parts", () => {
  it("replaces an object part that equals another alias's body", () => {
    expect(
      rewrite([
        ["Address", ADDRESS],
        ["User", "{ name: string; address: { street: string; city: string } }"],
      ]),
    ).toEqual([ADDRESS, "{ name: string; address: Address }"])
  })

  it("names an optional, array, and tuple wrapped part at the part, not the wrapper", () => {
    expect(
      rewrite([
        ["Address", ADDRESS],
        ["Wrapped", `{ a: ${ADDRESS} | undefined; b: ${ADDRESS}[]; c: [${ADDRESS}, number] }`],
      ])[1],
    ).toBe("{ a: Address | undefined; b: Address[]; c: [Address, number] }")
  })

  it("names a part inside an index signature value", () => {
    expect(
      rewrite([
        ["Address", ADDRESS],
        ["Dict", `{ [key: string]: ${ADDRESS} }`],
      ])[1],
    ).toBe("{ [key: string]: Address }")
  })

  it("replaces the outermost matching part and does not descend into it", () => {
    const inner = "{ id: string }"
    const outer = "{ wrap: { id: string }; more: string }"
    // The host's copy of `outer` is replaced as one part (outermost), so the `{ id: string }`
    // inside it is not named in the host. `outer` itself is a body, so its own inner part is
    // named the usual way.
    expect(
      rewrite([
        ["Inner", inner],
        ["Outer", outer],
        ["Host", `{ item: ${outer} }`],
      ]),
    ).toEqual([inner, "{ wrap: Inner; more: string }", "{ item: Outer }"])
  })

  it("never replaces a whole body, so a duplicate keeps its own declaration", () => {
    expect(
      rewrite([
        ["A", ADDRESS],
        ["B", ADDRESS],
      ]),
    ).toEqual([ADDRESS, ADDRESS])
  })

  it("still names parts inside a whole body that duplicates another alias", () => {
    const part = "{ id: string }"
    expect(
      rewrite([
        ["Part", part],
        ["First", `{ p: ${part} }`],
        ["Second", `{ p: ${part} }`],
      ]),
    ).toEqual([part, "{ p: Part }", "{ p: Part }"])
  })

  it("names a shared body by its first declaration in discovery order", () => {
    expect(
      rewrite([
        ["Early", ADDRESS],
        ["Late", ADDRESS],
        ["Host", `{ a: ${ADDRESS} }`],
      ])[2],
    ).toBe("{ a: Early }")
  })

  it("names an inner part with its own alias, never the host's name", () => {
    expect(
      rewrite([
        ["Self", "{ a: { b: string } }"],
        ["Other", "{ b: string }"],
      ]),
    ).toEqual(["{ a: Other }", "{ b: string }"])
  })

  it("ignores braces inside string and template literal types", () => {
    const tricky = `{ "a}b": string; code: \`x\${"{"}\` }`
    expect(
      rewrite([
        ["Tricky", tricky],
        ["Host", `{ t: ${tricky} }`],
      ])[1],
    ).toBe("{ t: Tricky }")
    // A quoted brace in the host does not confuse the scan of a later real part.
    expect(
      rewrite([
        ["Address", ADDRESS],
        ["Host", `{ label: "{"; addr: ${ADDRESS} }`],
      ])[1],
    ).toBe('{ label: "{"; addr: Address }')
  })

  it("does not name primitives, literal unions, or brands", () => {
    const entries: Array<readonly [string, string]> = [
      ["Id", "string"],
      ["Status", '"open" | "closed"'],
      ["UserId", 'string & { readonly "~brand": "UserId" }'],
      ["Tags", "string[]"],
      ["Empty", "{}"],
    ]
    const host = `{ id: string; status: "open" | "closed"; tags: string[]; e: {} }`
    expect(rewrite([...entries, ["Host", host]]).at(-1)).toBe(host)
  })

  it("leaves a body unchanged when there is no candidate", () => {
    const body = "{ a: string; b: number }"
    expect(rewrite([["Host", body]])).toEqual([body])
  })

  it("never changes the number, order, or names of entries", () => {
    const entries = [
      { typeName: "A", body: ADDRESS },
      { typeName: "B", body: "string" },
      { typeName: "C", body: `{ a: ${ADDRESS} }` },
    ]
    const out = referenceNamedParts(entries)
    expect(out.map((entry) => entry.typeName)).toEqual(["A", "B", "C"])
    expect(out[1]?.body).toBe("string")
    expect(out[2]?.body).toBe("{ a: A }")
  })

  it("leaves unbalanced text untouched instead of guessing", () => {
    expect(
      rewrite([
        ["Address", ADDRESS],
        ["Broken", "{ a: { street: string; city: string }"],
      ])[1],
    ).toBe("{ a: { street: string; city: string }")
  })
})

describe("referenceNamedParts: unions of object literals", () => {
  const SHAPE = '{ kind: "circle"; radius: number } | { kind: "square"; side: number }'

  it("names a union body that appears as a property type", () => {
    expect(
      rewrite([
        ["Shape", SHAPE],
        ["Drawing", `{ shape: ${SHAPE}; id: string }`],
      ]),
    ).toEqual([SHAPE, "{ shape: Shape; id: string }"])
  })

  it("names a union that is an operand of an optional union", () => {
    expect(
      rewrite([
        ["Shape", SHAPE],
        ["Maybe", `{ s: ${SHAPE} | undefined }`],
      ])[1],
    ).toBe("{ s: Shape | undefined }")
  })

  it("names a union inside parentheses, as an array element", () => {
    expect(
      rewrite([
        ["Shape", SHAPE],
        ["Many", `{ s: (${SHAPE})[] }`],
      ])[1],
    ).toBe("{ s: (Shape)[] }")
  })

  it("does not name a union glued to an intersection, which is a different type", () => {
    // Printed text parenthesizes a union inside `&`. Without parentheses the match is a
    // different type, `A | (B & C)`, so the union must not be named.
    const glued = `{ x: ${SHAPE} & { extra: 1 } }`
    expect(
      rewrite([
        ["Shape", SHAPE],
        ["Host", glued],
      ])[1],
    ).toBe(glued)
  })

  it("does not name a union that a `[]` suffix binds to its last member", () => {
    const suffixed = `{ s: ${SHAPE}[] }`
    expect(
      rewrite([
        ["Shape", SHAPE],
        ["Host", suffixed],
      ])[1],
    ).toBe(suffixed)
  })

  it("names a union whose members are already named as the members", () => {
    // A discriminated union with exported members reads `Circle | Square`, with no union body.
    expect(
      rewrite([
        ["Circle", '{ kind: "circle"; radius: number }'],
        ["Square", '{ kind: "square"; side: number }'],
        ["Shape", SHAPE],
      ]),
    ).toEqual([
      '{ kind: "circle"; radius: number }',
      '{ kind: "square"; side: number }',
      "Circle | Square",
    ])
  })

  it("splits union members only at the top level", () => {
    // The `|` inside the first member's property type does not split it, and the `|` inside the
    // quoted key does not split the union either. The members are the two objects, nothing else.
    const nested = '{ a: string | number } | { b: "x|y" }'
    expect(
      rewrite([
        ["Pair", nested],
        ["Host", `{ p: ${nested} }`],
      ])[1],
    ).toBe("{ p: Pair }")
  })

  it("does not treat a union with a non-object member as a candidate", () => {
    const mixed = "{ a: string } | string"
    expect(
      rewrite([
        ["Mixed", mixed],
        ["Host", `{ m: ${mixed} }`],
      ])[1],
    ).toBe(`{ m: ${mixed} }`)
  })

  it("keeps a union body whole when it duplicates another alias", () => {
    expect(
      rewrite([
        ["A", SHAPE],
        ["B", SHAPE],
      ]),
    ).toEqual([SHAPE, SHAPE])
  })
})

describe("referenceNamedParts: literal spans and boundaries", () => {
  it("never names a union or an object that only appears inside a string literal", () => {
    const pair = "{ a: string } | { b: number }"
    const inside = `{ label: "${pair}" }`
    expect(
      rewrite([
        ["Pair", pair],
        ["Host", inside],
      ])[1],
    ).toBe(inside)
    const single = '{ label: "{ a: string }" }'
    expect(
      rewrite([
        ["Member", "{ a: string }"],
        ["Host", single],
      ])[1],
    ).toBe(single)
  })

  it("skips an escaped quote inside a literal, so a brace after it is not counted", () => {
    const escaped = '{ k: "x\\"}" }'
    expect(
      rewrite([
        ["Escaped", escaped],
        ["Host", `{ item: ${escaped} }`],
      ])[1],
    ).toBe("{ item: Escaped }")
  })

  it("leaves a body with an unterminated literal exactly as it is", () => {
    const broken = '{ a: { street: string; city: string }, q: "abc }'
    expect(
      rewrite([
        ["Address", ADDRESS],
        ["Host", broken],
      ])[1],
    ).toBe(broken)
  })

  it("does not name a union that follows an intersection, even with several spaces", () => {
    const glued = `{ x: string &  ${SHAPE_OBJECTS} }`
    expect(
      rewrite([
        ["Shape", SHAPE_OBJECTS],
        ["Host", glued],
      ])[1],
    ).toBe(glued)
  })

  it("names a union that follows a `|`: a union operand flattens into the outer union", () => {
    expect(
      rewrite([
        ["Shape", SHAPE_OBJECTS],
        ["Host", `{ x: string | ${SHAPE_OBJECTS} }`],
      ])[1],
    ).toBe("{ x: string | Shape }")
  })

  it("never names a part with the host's own name", () => {
    // Two entries share a typeName (the session prevents this, the pass must still be safe).
    expect(
      rewrite([
        ["Same", "{ a: { b: string } }"],
        ["Same", "{ b: string }"],
      ]),
    ).toEqual(["{ a: { b: string } }", "{ b: string }"])
  })

  it("prefers the longer union over its first member at the same position", () => {
    expect(
      rewrite([
        ["Member", "{ a: string }"],
        ["Pair", "{ a: string } | { b: number }"],
        ["Host", "{ s: { a: string } | { b: number } }"],
      ])[2],
    ).toBe("{ s: Pair }")
  })
})

describe("referenceNamedParts: reserved names", () => {
  it("never references a reserved name, so no import is made necessary", () => {
    // `Brand` is what a valibot brand leaks as. Naming the object part `Brand` here would
    // add a reference that clashes with the valibot import, so the part stays inline.
    expect(
      rewrite(
        [
          ["Brand", ADDRESS],
          ["Host", `{ a: ${ADDRESS} }`],
        ],
        new Set(["Brand"]),
      ),
    ).toEqual([ADDRESS, `{ a: ${ADDRESS} }`])
  })

  it("still references a non-reserved name next to a reserved one", () => {
    expect(
      rewrite(
        [
          ["Brand", ADDRESS],
          ["Other", "{ z: number }"],
          ["Host", `{ a: ${ADDRESS}; b: { z: number } }`],
        ],
        new Set(["Brand"]),
      )[2],
    ).toBe(`{ a: ${ADDRESS}; b: Other }`)
  })
})

describe("referenceNamedParts: repeated operands", () => {
  // A and B are emitted object aliases; U is their union. Each case is what the checker or the
  // walker can print: a repeated operand collapses in TypeScript once both operands name one alias.
  const A = "{ a: string; }"
  const B = "{ b: number; }"
  const U = `${A} | ${B}`
  const withParts = (host: string): ReadonlyArray<readonly [string, string]> => [
    ["A", A],
    ["B", B],
    ["U", U],
    ["Host", host],
  ]

  it("keeps both members of `X | X` inline: naming them would collapse the union", () => {
    expect(
      rewrite([
        ["A", A],
        ["Host", `{ p: ${A} | ${A} }`],
      ])[1],
    ).toBe(`{ p: ${A} | ${A} }`)
  })

  it("keeps both operands of `X & X` inline: naming them would collapse the intersection", () => {
    expect(
      rewrite([
        ["A", A],
        ["Host", `{ p: ${A} & ${A} }`],
      ])[1],
    ).toBe(`{ p: ${A} & ${A} }`)
  })

  it("keeps the repeated operand of `(U) & X` inline, and still names the other member of U", () => {
    // Distributed, `(A | B) & A` is `(A & A) | (B & A)`, which collapses. The union itself is
    // not named (its member repeats), but its `{ b }` member is not repeated, so it is named.
    expect(rewrite(withParts(`{ p: (${U}) & ${A} }`))[3]).toBe(`{ p: (${A} | B) & ${A} }`)
  })

  it("keeps `X | U` inline when X is a member of U, and names the member that is not repeated", () => {
    // Printed flat, `X | U` reads `{ a } | { a } | { b }`, with the union `{ a } | { b }` at its tail.
    expect(rewrite(withParts(`{ f: ${A} | ${U} }`))[3]).toBe(`{ f: ${A} | ${A} | B }`)
  })

  it("keeps two unions that share a member inline, so the shared member is not one identity twice", () => {
    const V = `${A} | { c: boolean; }`
    expect(
      rewrite([
        ["A", A],
        ["B", B],
        ["U", U],
        ["V", V],
        ["Host", `{ c: (${U}) & (${V}) }`],
      ])[4],
    ).toBe(`{ c: (${A} | B) & (${A} | { c: boolean; }) }`)
  })

  it("keeps a repeated member of a union of intersections inline", () => {
    const pair = `(${A} & ${B}) | (${B} & ${A})`
    expect(
      rewrite([
        ["A", A],
        ["B", B],
        ["Host", `{ p: ${pair} }`],
      ])[2],
    ).toBe(`{ p: ${pair} }`)
  })

  it("keeps a flat repeat inside one union inline, because the union would keep one member", () => {
    expect(
      rewrite([
        ["A", A],
        ["B", B],
        ["Host", `{ p: ${A} | ${B} | ${A} }`],
      ])[2],
    ).toBe(`{ p: ${A} | B | ${A} }`)
  })

  it("does not treat a repeat in separate properties as a repeated operand", () => {
    expect(
      rewrite([
        ["A", A],
        ["Host", `{ x: ${A} | undefined; y: ${A} | undefined }`],
      ])[1],
    ).toBe("{ x: A | undefined; y: A | undefined }")
  })

  it("keeps a repeated tuple element inline, because TypeScript merges the element types", () => {
    // `[A, A]` has one element type, `A`; the inline `[{ a }, { a }]` keeps two distinct types.
    expect(
      rewrite([
        ["A", A],
        ["B", B],
        ["Host", `{ t: [${A}, ${A}] }`],
      ])[2],
    ).toBe(`{ t: [${A}, ${A}] }`)
  })

  it("keeps a repeated array or type argument inline, and names each distinct part", () => {
    // Each repeat is the same type once named: `A[] | A[]` and `Box<A> | Box<A>` collapse.
    expect(
      rewrite([
        ["A", A],
        ["Host", `{ p: ${A}[] | ${A}[]; q: Box<${A}> | Box<${A}> }`],
      ])[1],
    ).toBe(`{ p: ${A}[] | ${A}[]; q: Box<${A}> | Box<${A}> }`)
  })

  it("names distinct tuple elements and a parameter in another member, since they do not repeat", () => {
    // Each member is its own scope: the parameter `A` in `f` is not a repeat of the tuple's `A`.
    expect(
      rewrite([
        ["A", A],
        ["B", B],
        ["Host", `{ t: [${A}, ${B}]; f: (x: ${A}) => ${B} }`],
      ])[2],
    ).toBe("{ t: [A, B]; f: (x: A) => B }")
  })
})

describe("reservedSidecarNames", () => {
  it("reserves the vendor brand markers and every exported self-annotation name", () => {
    const reserved = reservedSidecarNames([
      { vendorHint: "zod" },
      { vendorHint: "valibot" },
      { recursiveAnnotation: { name: "CategoryT" } },
    ])
    expect([...reserved].sort()).toEqual(["$brand", "Brand", "CategoryT"])
  })

  it("reserves a vendor's brand marker only when the file has a target from that vendor", () => {
    expect([...reservedSidecarNames([{}, { vendorHint: undefined }])]).toEqual([])
    expect([...reservedSidecarNames([{ vendorHint: "zod" }])]).toEqual(["$brand"])
    expect([...reservedSidecarNames([{ vendorHint: "valibot" }])]).toEqual(["Brand"])
  })

  it("lets a tskm-only file share an alias named `Brand`, because nothing imports that name", () => {
    // `brandSchema` is exported as `Brand`, and `inner` is the same object elsewhere in the file.
    const entries = [
      { typeName: "Brand", body: "{ a: string; }" },
      { typeName: "Holder", body: "{ inner: { a: string; }; n: number; }" },
    ]
    expect(referenceNamedParts(entries, reservedSidecarNames([{}]))[1]?.body).toBe(
      "{ inner: Brand; n: number; }",
    )
  })

  it("keeps `Brand` inline in a file with a valibot target, which may import the marker", () => {
    const entries = [
      { typeName: "Brand", body: "{ a: string; }" },
      { typeName: "Holder", body: "{ inner: { a: string; }; n: number; }" },
    ]
    expect(
      referenceNamedParts(entries, reservedSidecarNames([{ vendorHint: "valibot" }]))[1]?.body,
    ).toBe("{ inner: { a: string; }; n: number; }")
  })
})

describe("referenceNamedParts: acyclic by construction", () => {
  it("terminates and never names a body back into a cycle across a chain of parts", () => {
    // Each body contains the next one, so the names form a chain, never a loop.
    const chain: Array<readonly [string, string]> = []
    let body = "{ leaf: string }"
    for (let i = 0; i < 6; i++) {
      chain.push([`Level${i}`, body])
      body = `{ next: ${body}; tag${i}: string }`
    }
    const out = rewrite(chain)
    // Every emitted body references only names declared with strictly smaller text.
    for (const [index, text] of out.entries()) {
      for (const match of text.matchAll(/Level(\d+)/g)) {
        expect(Number(match[1])).toBeLessThan(index)
      }
    }
  })
})

// Seeded fuzz: random printed-style bodies with shared sub-objects, unions, arrays, and optional
// wrappers. The invariant is exact: expanding every name the pass introduced back into its
// original body reproduces the original text, byte for byte. A wrong boundary (a union glued to
// an intersection, a brace inside a literal) breaks that equality, so the test catches it.
describe("referenceNamedParts: round-trip fuzz", () => {
  function prng(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 4294967296
    }
  }

  function generate(seed: number): Array<readonly [string, string]> {
    const random = prng(seed)
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T
    const LEAVES = ["string", "number", "boolean", '"open"', '"closed"', "null", "undefined"]
    const entries: Array<readonly [string, string]> = []
    const objectBodies: string[] = []
    const objectOf = (depth: number): string => {
      if (objectBodies.length > 0 && random() < 0.45) {
        return pick(objectBodies)
      }
      const keys = 1 + Math.floor(random() * 3)
      const members: string[] = []
      for (let k = 0; k < keys; k++) {
        members.push(`k${k}${random() < 0.3 ? "?" : ""}: ${valueAt(depth + 1)}`)
      }
      return `{ ${members.join("; ")} }`
    }
    const valueAt = (depth: number): string => {
      const roll = random()
      if (depth >= 3 || roll < 0.3) {
        return pick(LEAVES)
      }
      if (roll < 0.55) {
        return objectOf(depth)
      }
      if (roll < 0.65) {
        return `${objectOf(depth)} | undefined`
      }
      if (roll < 0.75) {
        return `(${objectOf(depth)} | ${objectOf(depth)})[]`
      }
      if (roll < 0.85) {
        return `${objectOf(depth)} | ${objectOf(depth)}`
      }
      return `[${objectOf(depth)}, ${pick(LEAVES)}]`
    }
    for (let i = 0; i < 10; i++) {
      const body = random() < 0.2 ? `${objectOf(1)} | ${objectOf(1)}` : objectOf(0)
      if (isObjectText(body)) {
        objectBodies.push(body)
      }
      entries.push([`T${i}`, body])
    }
    return entries
  }

  // Object-literal texts this generator produces; unions and wrappers are not reused as parts.
  function isObjectText(text: string): boolean {
    return text.startsWith("{") && text.endsWith("}") && !text.includes("} | ")
  }

  /** Replaces each `T<n>` token (outside literals) with the original body of that entry. */
  function expand(text: string, originals: ReadonlyMap<string, string>, depth = 0): string {
    if (depth > 20) {
      throw new Error("expansion did not terminate: a reference cycle")
    }
    return text.replace(/(["'`])(?:(?!\1).)*\1|\bT\d+\b/g, (match) => {
      if (match.startsWith('"') || match.startsWith("'") || match.startsWith("`")) {
        return match
      }
      const original = originals.get(match)
      if (original === undefined) {
        throw new Error(`unknown alias ${match}`)
      }
      return expand(original, originals, depth + 1)
    })
  }

  it("expanding every introduced name reproduces the original body exactly", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const entries = generate(seed)
      const originals = new Map(entries.map(([name, body]) => [name, body]))
      const rewritten = rewrite(entries)
      for (const [index, [name, body]] of entries.entries()) {
        const out = rewritten[index] as string
        expect(expand(out, originals)).toBe(body)
        // A body never names itself. Termination of `expand` (depth-limited above) is the
        // acyclicity check: a reference cycle would make it throw.
        expect(new RegExp(`\\b${name}\\b`).test(out)).toBe(false)
      }
    }
  })
})
