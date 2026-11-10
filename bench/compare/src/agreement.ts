import { type LibraryName, libraries } from "./config.ts"
import { emailPattern } from "./constraints.ts"
import { invalidPayload, validPayload } from "./payload.ts"

/**
 * Checks that the six adapters enforce the same constraints before anything is timed. The
 * expected verdicts come from the constraints in README.md, not from any library, so a library
 * that disagrees with the spec fails here rather than being timed.
 *
 * Run it alone with `bun src/agreement.ts` (prints the matrix). `run.ts` runs it first and stops
 * if any library disagrees.
 */

type Verdict = boolean | "throws"
type Parse = (input: unknown) => boolean

export interface AgreementCase {
  readonly label: string
  readonly input: unknown
  /** The verdict the README spec requires. */
  readonly accept: boolean
}

const withField = (patch: Record<string, unknown>): Record<string, unknown> => ({
  ...validPayload,
  ...patch,
})

const withAddress = (patch: Record<string, unknown>): Record<string, unknown> => ({
  ...validPayload,
  address: { ...validPayload.address, ...patch },
})

const without = (key: string): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...validPayload }
  delete copy[key]
  return copy
}

const chars = (count: number, char: string) => char.repeat(count)

/** Hand-picked cases at every boundary and every constraint group. */
export const cases: readonly AgreementCase[] = [
  { label: "valid payload", input: validPayload, accept: true },
  { label: "invalid payload (9 failing fields)", input: invalidPayload, accept: false },
  { label: "id = 1 (minimum)", input: withField({ id: 1 }), accept: true },
  { label: "id = 0", input: withField({ id: 0 }), accept: false },
  { label: "id = 1.5", input: withField({ id: 1.5 }), accept: false },
  { label: 'id = "7" (string)', input: withField({ id: "7" }), accept: false },
  { label: "id = NaN", input: withField({ id: Number.NaN }), accept: false },
  { label: "id = Infinity", input: withField({ id: Number.POSITIVE_INFINITY }), accept: false },
  { label: "id = 2^53 (unsafe integer)", input: withField({ id: 2 ** 53 }), accept: false },
  { label: "id = 2^53 - 1 (largest safe)", input: withField({ id: 2 ** 53 - 1 }), accept: true },
  { label: "id missing", input: without("id"), accept: false },
  { label: "name = 1 char", input: withField({ name: "a" }), accept: true },
  { label: 'name = ""', input: withField({ name: "" }), accept: false },
  { label: "name = 100 chars", input: withField({ name: chars(100, "a") }), accept: true },
  { label: "name = 101 chars", input: withField({ name: chars(101, "a") }), accept: false },
  { label: "email a@b.co", input: withField({ email: "a@b.co" }), accept: true },
  { label: "email a@b.c (1-char TLD)", input: withField({ email: "a@b.c" }), accept: false },
  { label: "email a@b (no TLD)", input: withField({ email: "a@b" }), accept: false },
  {
    label: "email a+b.c@ex-ample.co.uk",
    input: withField({ email: "a+b.c@ex-ample.co.uk" }),
    accept: true,
  },
  { label: "email with a space", input: withField({ email: "a b@c.com" }), accept: false },
  {
    label: "email with non-ASCII local part",
    input: withField({ email: "ü@example.com" }),
    accept: false,
  },
  {
    label: "email with apostrophe",
    input: withField({ email: "o'neil@example.com" }),
    accept: false,
  },
  { label: "email with leading dot", input: withField({ email: ".a@b.cd" }), accept: false },
  {
    label: "email with trailing dot in local part",
    input: withField({ email: "a.@b.cd" }),
    accept: false,
  },
  {
    label: "email with trailing dot in domain",
    input: withField({ email: "a@b.cd." }),
    accept: false,
  },
  {
    label: "email with doubled dot",
    input: withField({ email: "a..b@example.com" }),
    accept: false,
  },
  {
    label: "email with leading hyphen in domain",
    input: withField({ email: "a@-example.com" }),
    accept: false,
  },
  {
    label: "email with doubled dot in domain",
    input: withField({ email: "a@example..com" }),
    accept: false,
  },
  {
    label: "email = 100 chars",
    input: withField({ email: `${chars(88, "a")}@example.com` }),
    accept: true,
  },
  {
    label: "email = 102 chars",
    input: withField({ email: `${chars(90, "a")}@example.com` }),
    accept: false,
  },
  { label: "role member", input: withField({ role: "member" }), accept: true },
  { label: "role guest", input: withField({ role: "guest" }), accept: true },
  { label: 'role "Admin" (case)', input: withField({ role: "Admin" }), accept: false },
  { label: 'role "owner"', input: withField({ role: "owner" }), accept: false },
  { label: "tags empty array", input: withField({ tags: [] }), accept: true },
  { label: "tags = 30 chars", input: withField({ tags: [chars(30, "a")] }), accept: true },
  { label: "tags = 31 chars", input: withField({ tags: [chars(31, "a")] }), accept: false },
  { label: 'tags [""]', input: withField({ tags: [""] }), accept: false },
  { label: "tags [1] (number)", input: withField({ tags: [1] }), accept: false },
  { label: 'tags "math" (not array)', input: withField({ tags: "math" }), accept: false },
  { label: 'active "yes"', input: withField({ active: "yes" }), accept: false },
  { label: 'active "true" (string)', input: withField({ active: "true" }), accept: false },
  { label: "active 1", input: withField({ active: 1 }), accept: false },
  { label: "active false", input: withField({ active: false }), accept: true },
  { label: "score = 0", input: withField({ score: 0 }), accept: true },
  { label: "score = 100", input: withField({ score: 100 }), accept: true },
  { label: "score = 50.5", input: withField({ score: 50.5 }), accept: false },
  { label: "score = -1", input: withField({ score: -1 }), accept: false },
  { label: 'score "88" (string)', input: withField({ score: "88" }), accept: false },
  { label: "score = 101", input: withField({ score: 101 }), accept: false },
  { label: "city = 50 chars", input: withAddress({ city: chars(50, "a") }), accept: true },
  { label: "city = 51 chars", input: withAddress({ city: chars(51, "a") }), accept: false },
  { label: 'city = ""', input: withAddress({ city: "" }), accept: false },
  { label: "zip = 12 chars", input: withAddress({ zip: chars(12, "a") }), accept: true },
  { label: "zip = 13 chars", input: withAddress({ zip: chars(13, "a") }), accept: false },
  { label: "address null", input: withField({ address: null }), accept: false },
  { label: "address missing", input: without("address"), accept: false },
  { label: "extra top-level key (stripped)", input: withField({ extra: 1 }), accept: true },
  { label: "extra nested key (stripped)", input: withAddress({ extra: 1 }), accept: true },
  { label: "top-level null", input: null, accept: false },
  { label: "top-level array", input: [], accept: false },
  { label: "top-level string", input: "x", accept: false },
]

/** Known differences: reported in the matrix, never asserted. Each one is documented in
 * README.md. zod and typebox count string length in code points; the other four count UTF-16
 * code units. The payload is ASCII, so the timed inputs are not affected. */
export const knownDifferences: readonly { readonly label: string; readonly input: unknown }[] = [
  {
    label: "name = 51 emoji (102 UTF-16 units, 51 code points)",
    input: withField({ name: "😀".repeat(51) }),
  },
]

/** Seeded generator, so the generated emails are identical on every run. */
function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

/** Generated emails. The expected verdict is the shared expression plus the length bounds. */
export function generatedEmailCases(count: number, seed = 20261110): AgreementCase[] {
  const random = generator(seed)
  const pick = (alphabet: string) => alphabet[Math.floor(random() * alphabet.length)] ?? ""
  const run = (alphabet: string, max: number) => {
    let out = ""
    const length = Math.floor(random() * (max + 1))
    for (let i = 0; i < length; i++) out += pick(alphabet)
    return out
  }
  const out: AgreementCase[] = []
  for (let i = 0; i < count; i++) {
    const local = run("abcXYZ019._%+-'", 14)
    const labels = Array.from({ length: 1 + Math.floor(random() * 3) }, () => run("abcXYZ019-", 8))
    const tld = run("abcXYZ", 4)
    const sep = random() < 0.9 ? "@" : pick("@ ,;")
    const noise = random() < 0.1 ? pick(" üé\n") : ""
    const email = `${local}${sep}${labels.join(".")}.${tld}${noise}`
    const accept = emailPattern.test(email) && email.length >= 3 && email.length <= 100
    out.push({ label: `generated email #${i}`, input: withField({ email }), accept })
  }
  return out
}

export interface AgreementReport {
  readonly libraries: readonly LibraryName[]
  readonly checked: number
  readonly generatedAccepted: number
  readonly mismatches: readonly {
    readonly library: LibraryName
    readonly label: string
    readonly expected: boolean
    readonly actual: Verdict
  }[]
  readonly known: readonly {
    readonly label: string
    readonly verdicts: Readonly<Record<LibraryName, Verdict>>
  }[]
}

async function loadParsers(): Promise<Record<LibraryName, Parse>> {
  const parsers = {} as Record<LibraryName, Parse>
  for (const name of libraries) {
    parsers[name] = ((await import(`./libs/${name}.ts`)) as { parse: Parse }).parse
  }
  return parsers
}

function verdict(parse: Parse, input: unknown): Verdict {
  try {
    return parse(input)
  } catch {
    return "throws"
  }
}

export async function runAgreement(): Promise<AgreementReport> {
  const parsers = await loadParsers()
  const generated = generatedEmailCases(2000)
  const all = [...cases, ...generated]
  const mismatches: AgreementReport["mismatches"][number][] = []
  let generatedAccepted = 0
  for (const testCase of all) {
    if (testCase.label.startsWith("generated") && testCase.accept) generatedAccepted++
    for (const name of libraries) {
      const actual = verdict(parsers[name], testCase.input)
      if (actual !== testCase.accept) {
        mismatches.push({ library: name, label: testCase.label, expected: testCase.accept, actual })
      }
    }
  }
  const known = knownDifferences.map((entry) => {
    const verdicts = {} as Record<LibraryName, Verdict>
    for (const name of libraries) verdicts[name] = verdict(parsers[name], entry.input)
    return { label: entry.label, verdicts }
  })
  return {
    libraries,
    checked: all.length,
    generatedAccepted,
    mismatches,
    known,
  }
}

/** Throws if any library disagrees with the spec. */
export async function checkAgreement(): Promise<AgreementReport> {
  const report = await runAgreement()
  if (report.mismatches.length > 0) {
    const lines = report.mismatches
      .slice(0, 20)
      .map((m) => `  ${m.library}: ${m.label}: expected ${m.expected}, got ${m.actual}`)
    throw new Error(
      `${report.mismatches.length} verdict mismatches (first 20 shown)\n${lines.join("\n")}`,
    )
  }
  return report
}

if (import.meta.main) {
  const report = await runAgreement()
  console.log(
    `checked ${report.checked} inputs (${cases.length} cases + 2000 generated emails, ${report.generatedAccepted} of them valid) for ${report.libraries.length} libraries`,
  )
  console.log(`mismatches: ${report.mismatches.length}`)
  for (const m of report.mismatches.slice(0, 40)) {
    console.log(`  ${m.library}: ${m.label}: expected ${m.expected}, got ${m.actual}`)
  }
  for (const entry of report.known) {
    const verdicts = report.libraries.map((name) => `${name}=${entry.verdicts[name]}`).join(" ")
    console.log(`known difference (not asserted): ${entry.label}: ${verdicts}`)
  }
  process.exit(report.mismatches.length === 0 ? 0 : 1)
}
