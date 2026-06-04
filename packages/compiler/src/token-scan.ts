/**
 * Quote-aware, whole-word token scanning over rendered TS type text. Shared by the
 * Tier-1 sentinel substitution (tier1.ts) and the dangling-alias prune (prune.ts) so
 * both treat string-literal spans as opaque the same way.
 */

/** Whole-word token replacement that skips string-literal spans. */
export function replaceTokenOutsideQuotes(
  text: string,
  token: string,
  replacement: string,
): { result: string; replaced: number } {
  let out = ""
  let replaced = 0
  let i = 0
  const isWord = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9_$]/.test(ch)
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
    if (text.startsWith(token, i) && !isWord(text[i - 1]) && !isWord(text[i + token.length])) {
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
