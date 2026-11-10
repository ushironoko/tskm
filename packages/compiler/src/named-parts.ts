/**
 * Named object parts: the post-resolution pass that writes a shared object type by the name
 * of the exported schema it came from, instead of expanding it again at every use site.
 *
 * The rule: a sub-expression of an emitted alias body is replaced by the name of another
 * emitted alias in the same output unit when the two texts are identical and the matched text
 * is an object literal `{ ... }` or a union of object literals `{ ... } | { ... }`. Bodies come
 * from the checker, or from the structural walker, which spells objects the same way. Equal text
 * in one sidecar therefore names one type, so the replacement is type-identical by construction:
 * the bodies keep their meaning, and only their spelling changes. (The walker's `nameSharedSchemas`
 * mode names by identity instead, through a worker. This pass needs no worker and covers external
 * schemas too.)
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
 * The member texts of a union of two or more object literals, or undefined for any other text.
 * Members split at a `|` outside every brace, bracket and parenthesis, so a `|` inside a nested
 * object does not split the union. Angle brackets are not counted: `=>` would unbalance them,
 * and a split that goes wrong only makes the text fail the object-literal check below.
 */
function objectUnionMembers(text: string): ReadonlyArray<string> | undefined {
  const members: string[] = []
  let depth = 0
  let start = 0
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
      members.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  members.push(text.slice(start).trim())
  if (members.length < 2 || !members.every(isObjectLiteral)) {
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
 * The object-literal and union-of-object-literal spans of one body that name another alias.
 * `pairs` is the body's brace map (see {@link scanBraces}).
 */
function partMatches(
  entry: NamedPartsEntry,
  pairs: ReadonlyMap<number, number>,
  objects: ReadonlyMap<string, string>,
  unions: ReadonlyMap<string, string>,
  reserved: ReadonlySet<string>,
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
      admit(start, end, objects.get(body.slice(start, end)))
    }
  }
  if (unions.size > 0) {
    const literals = literalSpans(body)
    const insideLiteral = (position: number): boolean =>
      literals.some(([start, end]) => position >= start && position < end)
    for (const [text, name] of unions) {
      let at = body.indexOf(text)
      while (at !== -1) {
        const end = at + text.length
        if (!insideLiteral(at) && isUnionOperandAt(body, at, end)) {
          admit(at, end, name)
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
  const unions = new Map<string, string>()
  for (const entry of entries) {
    if (isObjectLiteral(entry.body)) {
      if (!objects.has(entry.body)) {
        objects.set(entry.body, entry.typeName)
      }
    } else if (objectUnionMembers(entry.body) !== undefined && !unions.has(entry.body)) {
      unions.set(entry.body, entry.typeName)
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
  unions: ReadonlyMap<string, string>,
  reserved: ReadonlySet<string>,
): string {
  const pairs = scanBraces(entry.body)
  if (pairs === undefined) {
    return entry.body
  }
  const matches = partMatches(entry, pairs, objects, unions, reserved)
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
