/**
 * Quote-aware, whole-word token scanning over rendered TS type text. Shared by the
 * Tier-1 sentinel substitution (tier1.ts) and the dangling-alias prune (prune.ts) so
 * both treat string-literal spans as opaque the same way.
 */

/**
 * Whole-word boundary test. `isWordAt` reads the code unit at `idx` directly and
 * classifies it via char-code ranges (A-Za-z0-9_$), which is identical to the
 * `/[A-Za-z0-9_$]/` test it replaces but skips both the per-call closure and the
 * per-char regex dispatch on a scanner that runs once per code unit. An out-of-range
 * index yields NaN from charCodeAt, which matches none of the ranges, so the original
 * `ch === undefined` boundary (index -1 or past end) still reads as a non-word char.
 */
const isWordAt = (text: string, idx: number): boolean => {
  const c = text.charCodeAt(idx)
  return (
    (c >= 65 && c <= 90) || // A-Z
    (c >= 97 && c <= 122) || // a-z
    (c >= 48 && c <= 57) || // 0-9
    c === 95 || // _
    c === 36 // $
  )
}

/** Whole-word token replacement that skips string-literal spans. */
export function replaceTokenOutsideQuotes(
  text: string,
  token: string,
  replacement: string,
): { result: string; replaced: number } {
  let out = ""
  let replaced = 0
  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch
      out += ch
      i++
      while (i < text.length) {
        const c = text[i] as string
        out += c
        i++
        if (c === "\\" && i < text.length) {
          out += text[i]
          i++
          continue
        }
        if (c === quote) {
          break
        }
      }
      continue
    }
    if (text.startsWith(token, i) && !isWordAt(text, i - 1) && !isWordAt(text, i + token.length)) {
      out += replacement
      replaced++
      i += token.length
      continue
    }
    out += ch
    i++
  }
  return { result: out, replaced }
}

/** True when `token` appears as a whole word outside string literals. */
export function containsTokenOutsideQuotes(text: string, token: string): boolean {
  return replaceTokenOutsideQuotes(text, token, token).replaced > 0
}

/**
 * Whitespace test for the property-key lookahead. Shared module-scope literal so the
 * regex is not re-created on every char of a whitespace run; with no `g` flag `.test`
 * is stateless, so a single instance is identical to a fresh per-call one. Kept as a
 * regex (not a char-code check) because `\s` covers the full Unicode whitespace set and
 * the rendered text may contain non-ASCII spacing.
 */
const WHITESPACE = /\s/

/**
 * True when `token` appears as a whole-word TYPE REFERENCE outside string
 * literals. A match immediately followed by `:` or `?:` is an (unquoted) object
 * property KEY — `{ Broken: string }` declares a member named Broken, it does not
 * reference a type Broken — and must not count. Rendered bodies never place a
 * type reference directly before `:`, so the lookahead is a sound discriminator.
 */
export function referencesTypeOutsideQuotes(text: string, token: string): boolean {
  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch
      i++
      while (i < text.length) {
        const c = text[i] as string
        i++
        if (c === "\\" && i < text.length) {
          i++
          continue
        }
        if (c === quote) {
          break
        }
      }
      continue
    }
    if (text.startsWith(token, i) && !isWordAt(text, i - 1) && !isWordAt(text, i + token.length)) {
      let j = i + token.length
      while (j < text.length && WHITESPACE.test(text[j] as string)) {
        j++
      }
      if (text[j] === "?") {
        let k = j + 1
        while (k < text.length && WHITESPACE.test(text[k] as string)) {
          k++
        }
        if (text[k] === ":") {
          i += token.length
          continue
        }
      }
      if (text[j] === ":") {
        i += token.length
        continue
      }
      return true
    }
    i++
  }
  return false
}
