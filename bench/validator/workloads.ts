/**
 * Representative validation workloads. Each entry pairs a schema with a fixed input and a
 * thunk that runs one `safeParse`. The spread is chosen to exercise the runtime's hot
 * paths: the primitive leaf checks, the object key walk, arrays, the two union strategies,
 * pipe action chains, and both the happy path (no issues) and the error path (issue
 * construction, `_received`, path prefixing) since they have very different cost profiles.
 *
 * The data is constructed once at module load so the benchmark measures validation, not
 * fixture allocation.
 */

// Import the SOURCE directly (not the @tskm/core package name) so the benchmark always
// measures packages/tskm/src, the code these optimizations target, never a stale dist build.
import {
  array,
  type BaseSchema,
  boolean,
  check,
  discriminatedUnion,
  email,
  literal,
  maxLength,
  minLength,
  minValue,
  nullish,
  number,
  object,
  optional,
  pipe,
  record,
  safeParse,
  string,
  tuple,
  union,
} from "../../packages/tskm/src/index.ts"

export interface Workload {
  readonly name: string
  readonly run: () => unknown
}

// --- Primitives -------------------------------------------------------------

const stringSchema = string()
const numberSchema = number()
const booleanSchema = boolean()

// --- Flat object (the bread-and-butter shape) -------------------------------

const flatObject = object({
  id: string(),
  age: number(),
  active: boolean(),
  score: number(),
  name: string(),
})
const flatObjectData = { id: "u_1", age: 30, active: true, score: 9.5, name: "ada" }

// --- Wide object (24 keys: stresses the key walk) ---------------------------

const wideEntries: Record<string, BaseSchema<unknown, unknown>> = {}
const wideData: Record<string, unknown> = {}
for (let i = 0; i < 24; i++) {
  wideEntries[`k${i}`] = i % 2 === 0 ? string() : number()
  wideData[`k${i}`] = i % 2 === 0 ? `v${i}` : i
}
const wideObject = object(wideEntries)

// --- Nested object (depth + arrays + optional) ------------------------------

const nestedObject = object({
  user: object({
    id: string(),
    profile: object({
      name: string(),
      bio: optional(string()),
      tags: array(string()),
    }),
  }),
  posts: array(
    object({
      title: string(),
      views: number(),
      published: boolean(),
    }),
  ),
  meta: nullish(object({ version: number() })),
})
const nestedData = {
  user: {
    id: "u_42",
    profile: { name: "grace", bio: "hopper", tags: ["a", "b", "c"] },
  },
  posts: [
    { title: "p1", views: 10, published: true },
    { title: "p2", views: 20, published: false },
    { title: "p3", views: 30, published: true },
  ],
  meta: { version: 2 },
}

// --- Array of primitives (100 elements) -------------------------------------

const numberArray = array(number())
const numberArrayData = Array.from({ length: 100 }, (_, i) => i)

// --- Array of objects (50 elements) -----------------------------------------

const objectArray = array(object({ x: number(), y: number(), label: string() }))
const objectArrayData = Array.from({ length: 50 }, (_, i) => ({
  x: i,
  y: i * 2,
  label: `pt${i}`,
}))

// --- Union (ordered try-each) -----------------------------------------------

const primitiveUnion = union([string(), number(), boolean()])

// --- Discriminated union (keyed dispatch) -----------------------------------

const discriminated = discriminatedUnion("kind", [
  object({ kind: literal("circle"), radius: number() }),
  object({ kind: literal("square"), side: number() }),
  object({ kind: literal("rect"), w: number(), h: number() }),
])
const discriminatedData = { kind: "rect", w: 4, h: 5 }

// --- Pipe with validation actions -------------------------------------------

const validatedString = pipe(string(), minLength(3), maxLength(64), email())
const validatedStringData = "grace.hopper@example.com"

const validatedNumber = pipe(
  number(),
  minValue(0),
  check((n: number) => Number.isFinite(n), "must be finite"),
)

// --- Record -----------------------------------------------------------------

const recordSchema = record(string(), number())
const recordData: Record<string, number> = {}
for (let i = 0; i < 20; i++) {
  recordData[`key${i}`] = i
}

// --- Tuple ------------------------------------------------------------------

const tupleSchema = tuple([string(), number(), boolean()])
const tupleData = ["x", 1, true]

// --- A larger composite, the closest to a realistic API payload -------------

const apiPayload = object({
  requestId: string(),
  timestamp: number(),
  user: object({
    id: string(),
    email: pipe(string(), email()),
    roles: array(string()),
  }),
  items: array(
    object({
      sku: string(),
      qty: number(),
      price: number(),
    }),
  ),
  shape: discriminated,
})
const apiPayloadData = {
  requestId: "req_abc",
  timestamp: 1_700_000_000,
  user: {
    id: "u_7",
    email: "a@b.co",
    roles: ["admin", "user"],
  },
  items: Array.from({ length: 8 }, (_, i) => ({ sku: `s${i}`, qty: i + 1, price: i * 1.5 })),
  shape: { kind: "circle", radius: 3 },
}

// --- Error-path workloads (issue construction dominates) ---------------------

const flatObjectBadData = { id: 1, age: "x", active: "no", score: null, name: 2 }
const nestedBadData = {
  user: { id: 5, profile: { name: 6, tags: [1, 2] } },
  posts: [{ title: 7, views: "x", published: "yes" }],
  meta: { version: "bad" },
}

export const workloads: ReadonlyArray<Workload> = [
  { name: "primitive/string", run: () => safeParse(stringSchema, "hello world") },
  { name: "primitive/number", run: () => safeParse(numberSchema, 42) },
  { name: "primitive/boolean", run: () => safeParse(booleanSchema, true) },
  { name: "object/flat", run: () => safeParse(flatObject, flatObjectData) },
  { name: "object/wide-24", run: () => safeParse(wideObject, wideData) },
  { name: "object/nested", run: () => safeParse(nestedObject, nestedData) },
  { name: "array/number-100", run: () => safeParse(numberArray, numberArrayData) },
  { name: "array/object-50", run: () => safeParse(objectArray, objectArrayData) },
  { name: "union/primitive", run: () => safeParse(primitiveUnion, 123) },
  { name: "union/discriminated", run: () => safeParse(discriminated, discriminatedData) },
  { name: "pipe/string-validated", run: () => safeParse(validatedString, validatedStringData) },
  { name: "pipe/number-validated", run: () => safeParse(validatedNumber, 42) },
  { name: "record/string-number", run: () => safeParse(recordSchema, recordData) },
  { name: "tuple/3", run: () => safeParse(tupleSchema, tupleData) },
  { name: "composite/api-payload", run: () => safeParse(apiPayload, apiPayloadData) },
  { name: "error/object-flat", run: () => safeParse(flatObject, flatObjectBadData) },
  { name: "error/object-nested", run: () => safeParse(nestedObject, nestedBadData) },
]

/** Selects a subset by substring (for focused profiling); empty filter returns all. */
export function selectWorkloads(filter: string): ReadonlyArray<Workload> {
  if (!filter) {
    return workloads
  }
  return workloads.filter((w) => w.name.includes(filter))
}
