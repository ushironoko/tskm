/**
 * Named object parts: the post-resolution pass that writes a shared object type by the name
 * of the exported schema it came from, instead of expanding it again at every use site.
 *
 * The rule: a sub-expression of an emitted alias body is replaced by the name of another
 * emitted alias in the same output unit when the two texts are identical and the matched text
 * is an object literal `{ ... }` or a union of object literals `{ ... } | { ... }`. Bodies come
 * from the checker, or from the structural walker, which spells objects the same way. Equal text
 * in one sidecar therefore names one type.
 *
 * Identity. Equal text is one type only when the parts that TypeScript merges stay distinct. It
 * merges repeated operands of a union or intersection (`A | A` and `A & A` are `A`), the element
 * types of a tuple (`[A, A]`), and the arguments of an array or type reference (`A[] | A[]`). The
 * inline original holds distinct object types there. So a literal that repeats within one scope
 * stays inline, and so does a union that contains one (see {@link repeatedOperandStarts}). With
 * that rule the rewritten body is strictly identical to the original under `Equal`, not just
 * assignable in both directions. The semantic fuzz and the `Equal` probes in
 * named-parts.integration.test.ts check it.
 *
 * Scope and fallbacks, all deliberate:
 * - Candidates are object literals and unions of object literals. A primitive, literal union,
 *   brand, or array stays inline, so `string` can never be renamed by accident. Any body may
 *   still contain named parts: a discriminated union with exported members reads `Home | Work`.
 * - Same output unit only. A part that comes from another module stays inline. Naming it
 *   would need an import from a sidecar that may not exist or may be pruned, so cross-file
 *   references are a documented fallback, not an implementation gap.
 * - Replacement is outermost first and never covers a whole body. A body therefore only
 *   references strictly smaller texts, so the reference graph is acyclic and no cycle can
 *   form. Duplicate bodies name the first declaration in discovery order.
 * - Names in `reserved` are never referenced, so a reference cannot collide with an identifier
 *   the sidecar imports (vendor brand markers, annotation types). Those parts stay inline.
 */

/** One emitted alias: its declared name and its final single-line type text. */
export interface NamedPartsEntry {
  readonly typeName: string
  readonly body: string
}

/** A span `[start, end)` of a body that may be replaced by `name`. */
interface PartMatch {
  readonly start: number
  readonly end: number
  readonly name: string
}

/** A union of object literals: its alias name and the offset of each member inside its text. */
interface UnionCandidate {
  readonly name: string
  readonly memberOffsets: ReadonlyArray<number>
}

/** Index of the closing quote of the string or template literal opened at `open`, or -1. */
function closingQuote(text: string, open: number): number {
  const quote = text[open]
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i]
    if (c === "\\") {
      i++
      continue
    }
    if (c === quote) {
      return i
    }
  }
  return -1
}

/** Spans of every string and template literal in `text`, as `[start, end)` pairs. */
function literalSpans(text: string): ReadonlyArray<readonly [number, number]> {
  const spans: Array<readonly [number, number]> = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'" || c === "`") {
      const close = closingQuote(text, i)
      if (close === -1) {
        break
      }
      spans.push([i, close + 1])
      i = close
    }
  }
  return spans
}

/**
 * Every brace pair in `text` as a map from the index of `{` to the index just past its `}`, or
 * undefined when the braces or a literal are unbalanced. One stack pass, so a deeply nested body
 * costs the same as a flat one. Literal spans are skipped, so a `{` inside a quoted key or a
 * `${...}` placeholder never counts. A malformed body yields undefined and is left untouched.
 */
function scanBraces(text: string): Map<number, number> | undefined {
  const open: number[] = []
  const pairs = new Map<number, number>()
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'" || c === "`") {
      const close = closingQuote(text, i)
      if (close === -1) {
        return undefined
      }
      i = close
    } else if (c === "{") {
      open.push(i)
    } else if (c === "}") {
      const start = open.pop()
      if (start === undefined) {
        return undefined
      }
      pairs.set(start, i + 1)
    }
  }
  return open.length === 0 ? pairs : undefined
}

/**
 * True for text that is exactly one object literal with at least one member. `{}` is not a
 * candidate: it is the bare "non-nullish" type, and naming it adds nothing.
 */
function isObjectLiteral(text: string): boolean {
  // The brace map has an entry at 0 only when the text opens with a `{`, and that brace closes
  // at the end only when the whole text is one object literal.
  return text.length > 2 && scanBraces(text)?.get(0) === text.length
}

/**
 * The `[start, end)` spans of the members of a union of two or more object literals, or undefined
 * for any other text. Members split at a `|` outside every brace, bracket and parenthesis, so a `|`
 * inside a nested object does not split the union. Angle brackets are not counted: `=>` would
 * unbalance them, and a split that goes wrong only makes the text fail the object-literal check.
 */
function objectUnionMembers(text: string): ReadonlyArray<readonly [number, number]> | undefined {
  const members: Array<readonly [number, number]> = []
  let depth = 0
  let start = 0
  const pushMember = (from: number, to: number): void => {
    const raw = text.slice(from, to)
    const lead = raw.length - raw.trimStart().length
    members.push([from + lead, from + lead + raw.trim().length])
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'" || c === "`") {
      const close = closingQuote(text, i)
      if (close === -1) {
        return undefined
      }
      i = close
      continue
    }
    if (c === "{" || c === "[" || c === "(") {
      depth++
    } else if (c === "}" || c === "]" || c === ")") {
      depth--
    } else if (c === "|" && depth === 0) {
      pushMember(start, i)
      start = i + 1
    }
  }
  pushMember(start, text.length)
  if (members.length < 2 || !members.every(([s, e]) => isObjectLiteral(text.slice(s, e)))) {
    return undefined
  }
  return members
}

/** True when `text` at `start` may be a whole union operand: not glued to a `&` or `[`. */
function isUnionOperandAt(text: string, start: number, end: number): boolean {
  let before = start - 1
  while (before >= 0 && text[before] === " ") {
    before--
  }
  let after = end
  while (after < text.length && text[after] === " ") {
    after++
  }
  // The printer parenthesizes a union that sits inside an intersection or an array, so a bare
  // union never abuts `&` or `[` in printed text. A match that does is a different type.
  return text[before] !== "&" && text[after] !== "&" && text[after] !== "["
}

/**
 * The starts of the object literals that print exactly like another object literal in the same
 * scope. A scope is the text of one object member's type (from its `:` to its `;` or `,`), or the
 * whole body. Everything inside a scope is kept whole, including unions, intersections, tuples,
 * arrays, and type arguments: `(A | B) & A`, `[A, A]`, `A[] | A[]`, and `Box<A> | Box<A>` each stay
 * in one scope. TypeScript merges two such operands once both name one alias (`A & A` is `A`, and
 * `[A, A]` has one element type), while the inline original keeps two distinct types. So every
 * repeated literal in a scope stays written out. A property, a parameter, or a member starts a
 * scope of its own, so `{ p: A; q: A }` still names `A` in both properties.
 */
function repeatedOperandStarts(
  body: string,
  pairs: ReadonlyMap<number, number>,
): ReadonlySet<number> {
  // Open brackets, innermost last. Only an object body (`{`) starts new scopes inside it.
  const frames: Array<{ readonly opener: string; readonly outerScope: number }> = []
  const literalsByScope = new Map<string, number[]>()
  let scope = 0
  let nextScope = 1
  const insideObject = (): boolean => frames[frames.length - 1]?.opener === "{"
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string
    if (c === '"' || c === "'" || c === "`") {
      const close = closingQuote(body, i)
      if (close === -1) {
        break
      }
      i = close
    } else if (c === "{") {
      const end = pairs.get(i)
      if (end === undefined) {
        break
      }
      const key = `${scope}\u0000${body.slice(i, end)}`
      const starts = literalsByScope.get(key)
      if (starts) {
        starts.push(i)
      } else {
        literalsByScope.set(key, [i])
      }
      frames.push({ opener: "{", outerScope: scope })
      scope = nextScope++
    } else if (c === "}" && frames[frames.length - 1]?.opener === "{") {
      scope = (frames.pop() as { outerScope: number }).outerScope
    } else if (c === "(" || c === "[" || c === "<") {
      frames.push({ opener: c, outerScope: scope })
    } else if (c === ")" || c === "]" || (c === ">" && body[i - 1] !== "=")) {
      // A closer ends the innermost bracket only when it matches. `=>` is an arrow, not a closer.
      const opener = c === ")" ? "(" : c === "]" ? "[" : "<"
      if (frames[frames.length - 1]?.opener === opener) {
        frames.pop()
      }
    } else if ((c === ";" || c === "," || c === ":") && insideObject()) {
      scope = nextScope++
    }
  }
  const repeated = new Set<number>()
  for (const starts of literalsByScope.values()) {
    if (starts.length > 1) {
      for (const start of starts) {
        repeated.add(start)
      }
    }
  }
  return repeated
}

/**
 * The object-literal and union-of-object-literal spans of one body that name another alias.
 * `pairs` is the body's brace map (see {@link scanBraces}); `repeated` is its operand check (see
 * {@link repeatedOperandStarts}).
 */
function partMatches(
  entry: NamedPartsEntry,
  pairs: ReadonlyMap<number, number>,
  objects: ReadonlyMap<string, string>,
  unions: ReadonlyMap<string, UnionCandidate>,
  reserved: ReadonlySet<string>,
  repeated: ReadonlySet<number>,
): PartMatch[] {
  const { body, typeName } = entry
  const matches: PartMatch[] = []
  const admit = (start: number, end: number, name: string | undefined): void => {
    // The whole body is never replaced: a duplicate body keeps its own declaration.
    if (name === undefined || name === typeName || reserved.has(name)) {
      return
    }
    if (start === 0 && end === body.length) {
      return
    }
    matches.push({ start, end, name })
  }
  if (objects.size > 0) {
    for (const [start, end] of pairs) {
      if (!repeated.has(start)) {
        admit(start, end, objects.get(body.slice(start, end)))
      }
    }
  }
  if (unions.size > 0) {
    const literals = literalSpans(body)
    const insideLiteral = (position: number): boolean =>
      literals.some(([start, end]) => position >= start && position < end)
    for (const [text, union] of unions) {
      let at = body.indexOf(text)
      while (at !== -1) {
        const end = at + text.length
        // A union with a repeated member stays written out, with that member, so each copy keeps
        // its own identity (see repeatedOperandStarts).
        const repeatedMember = union.memberOffsets.some((offset) => repeated.has(at + offset))
        if (!insideLiteral(at) && isUnionOperandAt(body, at, end) && !repeatedMember) {
          admit(at, end, union.name)
        }
        at = body.indexOf(text, at + 1)
      }
    }
  }
  return matches
}

/**
 * Returns the entries with shared object parts replaced by the names of their exported aliases.
 * Same typeNames, same order; a body with no match comes back unchanged. `reserved` lists names
 * that must never be referenced.
 */
export function referenceNamedParts(
  entries: ReadonlyArray<NamedPartsEntry>,
  reserved: ReadonlySet<string> = new Set(),
): NamedPartsEntry[] {
  // Candidates by exact text. The first declaration in discovery order wins a shared body.
  const objects = new Map<string, string>()
  const unions = new Map<string, UnionCandidate>()
  for (const entry of entries) {
    if (isObjectLiteral(entry.body)) {
      if (!objects.has(entry.body)) {
        objects.set(entry.body, entry.typeName)
      }
    } else if (!unions.has(entry.body)) {
      const members = objectUnionMembers(entry.body)
      if (members !== undefined) {
        unions.set(entry.body, {
          name: entry.typeName,
          memberOffsets: members.map(([start]) => start),
        })
      }
    }
  }
  if (objects.size === 0 && unions.size === 0) {
    return [...entries]
  }
  return entries.map((entry) => ({
    typeName: entry.typeName,
    body: rewriteBody(entry, objects, unions, reserved),
  }))
}

/** One entry's body with its matches replaced. A malformed body is returned exactly as given. */
function rewriteBody(
  entry: NamedPartsEntry,
  objects: ReadonlyMap<string, string>,
  unions: ReadonlyMap<string, UnionCandidate>,
  reserved: ReadonlySet<string>,
): string {
  const pairs = scanBraces(entry.body)
  if (pairs === undefined) {
    return entry.body
  }
  const repeated = repeatedOperandStarts(entry.body, pairs)
  const matches = partMatches(entry, pairs, objects, unions, reserved, repeated)
  if (matches.length === 0) {
    return entry.body
  }
  // Outermost first: sorting by start, then longest, makes a nested match lose to the match that
  // contains it. Matches never partly overlap, because each one is a balanced span.
  matches.sort((a, b) => a.start - b.start || b.end - a.end)
  const pieces: string[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start < cursor) {
      continue
    }
    pieces.push(entry.body.slice(cursor, match.start), match.name)
    cursor = match.end
  }
  pieces.push(entry.body.slice(cursor))
  return pieces.join("")
}
