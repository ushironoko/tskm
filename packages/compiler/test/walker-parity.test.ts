import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Walker switch-table parity (issue #23).
 *
 * Two duck-typed walkers render the same runtime schema graph: the structural
 * TypeScript walker (`structural-ts.ts`) and the JSON Schema walker (`jsonschema.ts`).
 * Each dispatches on `schema.type` in its own `walkSchema` switch. A primitive that
 * introduces a NEW `schema.type` (discriminated union, template literal) must add its
 * case to BOTH walkers in the same change. If only one walker learns the case, the
 * other falls through to its default branch and silently emits `{}` / `unknown` /
 * `additionalProperties: false`.
 *
 * Scope: this test compares the set of top-level `schema.type` cases in each
 * `walkSchema`. It guards new schema-type cases only. A primitive that folds into an
 * existing case instead of adding one (an object unknown-key mode, a `record` key
 * argument) does not change the case set, so it is NOT covered here and must add its
 * own walker-branch test in both walkers.
 *
 * This test fails when the two walkers disagree on the set of `schema.type` cases they
 * handle, so a one-sided new-case edit cannot land green.
 */

const SRC = join(import.meta.dir, "..", "src")

/**
 * The set of `case "..."` labels inside a file's `walkSchema` function. The body is
 * isolated lexically: the start is the line that declares `function walkSchema(`, and
 * the end is the next top-level declaration (any `function`/`const`/`export` at column
 * zero), so the action-folding switch elsewhere in the file (min_length, max_value, ...)
 * is excluded. Comments are stripped before scanning so a `case "..."` mentioned in a
 * comment is not miscounted. This relies on `walkSchema` being a top-level `function`
 * declaration; keep it that way or update this extractor.
 */
function schemaTypeCases(file: string): string[] {
  const lines = readFileSync(join(SRC, file), "utf8").split("\n")
  const start = lines.findIndex((line) => /^function walkSchema\s*\(/.test(line))
  if (start < 0) {
    throw new Error(`${file}: could not find the top-level walkSchema function declaration`)
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (/^(export\s+)?(async\s+)?function\s/.test(line) || /^(export\s+)?const\s/.test(line)) {
      end = i
      break
    }
  }
  const body = lines
    .slice(start, end)
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
  const labels = new Set<string>()
  for (const match of body.matchAll(/case\s+"([^"]+)"/g)) {
    const label = match[1]
    if (label !== undefined) {
      labels.add(label)
    }
  }
  return [...labels].sort()
}

// This test inspects source TEXT, so it cannot run against Stryker's in-place
// instrumented sources (every `case "..."` label is wrapped in mutant-switching
// ternaries, breaking the lexical extractor). It also cannot kill mutants — all
// mutants coexist in the text regardless of which one is active — so skipping
// under instrumentation loses nothing.
const instrumented = readFileSync(join(SRC, "structural-ts.ts"), "utf8").includes("__stryker")

describe("walker switch-table parity (#23)", () => {
  it.skipIf(instrumented)(
    "structural-ts.ts and jsonschema.ts handle the same schema-type set",
    () => {
      const structural = schemaTypeCases("structural-ts.ts")
      const json = schemaTypeCases("jsonschema.ts")

      // Sanity: each walker actually handles a non-trivial set, so an empty extraction
      // (e.g. a renamed function) cannot make this pass vacuously.
      expect(structural.length).toBeGreaterThan(5)
      expect(json.length).toBeGreaterThan(5)

      expect(structural).toEqual(json)
    },
  )
})
