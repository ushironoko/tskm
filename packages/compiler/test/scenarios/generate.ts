import assert from "node:assert/strict"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { withTestTsgo } from "../tsgo-test-executable.ts"
import { type CompilerApi, contains, expectNoQueryWrites, fixture, type Suite } from "./support.ts"

/** Sidecar-mode `generate` on a fixture, run under the query-write guard. */
function generateSidecars(api: CompilerApi, root: string, include: string[]) {
  return expectNoQueryWrites(root, () =>
    api.generate({
      root,
      config: withTestTsgo({ mode: "sidecar", include, tsconfig: "tsconfig.json" }),
    }),
  )
}

export function basicSuite(api: CompilerApi): Suite {
  const root = fixture("basic")
  const sidecar = fixture("basic/src/account.schema.gen.ts")
  const query = fixture("basic/src/account.schema.tskm-query.ts")
  // The committed bytes that `generate` must reproduce on every runtime.
  const expected = fixture("basic/expected/account.schema.gen.txt")

  return {
    title: "compiler generate (real tsgo) — the gate",
    teardown: () => {
      for (const f of [sidecar, query]) {
        if (existsSync(f)) rmSync(f)
      }
    },
    scenarios: [
      {
        name: "materializes fully-expanded output types into a sidecar",
        timeout: 60_000,
        run: async () => {
          const result = await generateSidecars(api, root, ["src/*.schema.ts"])

          assert.equal(result.files.length, 1)
          const names = result.files[0]?.typeNames ?? []
          for (const name of ["Account", "Tag"]) {
            assert.ok(names.includes(name), `expected a ${name} type`)
          }

          const gen = readFileSync(sidecar, "utf8")
          // nested + array + optional + transform-derived output, all expanded concretely
          contains(gen, "export type Account = {")
          contains(gen, "id: string")
          contains(gen, "age: number")
          contains(gen, "roles: string[]")
          contains(gen, "nickname")
          // transform's output type (string -> number) is captured by the type system
          contains(gen, "nameLength: number")
          // a bare string schema materializes to `string`
          contains(gen, "export type Tag = string")
        },
      },
      {
        name: "leaves no query files behind",
        run: () => {
          assert.equal(existsSync(query), false)
        },
      },
      {
        name: "regenerating reproduces the committed expected bytes",
        timeout: 60_000,
        run: async () => {
          await generateSidecars(api, root, ["src/*.schema.ts"])
          // To update the expectation after an intended output change, copy the generated
          // sidecar over `expected/account.schema.gen.txt` and review the diff.
          assert.equal(readFileSync(sidecar, "utf8"), readFileSync(expected, "utf8"))
        },
      },
    ],
  }
}

/** The right-hand side of `export type <name> = …`, up to the next type or EOF. */
function typeBody(gen: string, name: string): string {
  const match = gen.match(new RegExp(`export type ${name} =([\\s\\S]*?)(?=\\nexport type |\\s*$)`))
  return match?.[1] ?? ""
}

/**
 * Top-level nullability: a bare `nullable` / `nullish` / union-with-null flows through the
 * `__P` query wrapper, which is where `null` or `undefined` could be dropped.
 */
export function nullishSuite(api: CompilerApi): Suite {
  const root = fixture("nullish")
  const sidecar = fixture("nullish/src/edge.schema.gen.ts")
  const query = fixture("nullish/src/edge.schema.tskm-query.ts")

  return {
    title: "top-level nullable/nullish/union-with-null survive __P (real tsgo)",
    teardown: () => {
      for (const f of [sidecar, query]) {
        if (existsSync(f)) rmSync(f)
      }
    },
    scenarios: [
      {
        name: "keeps null and undefined members in the emitted sidecar",
        timeout: 60_000,
        run: async () => {
          await generateSidecars(api, root, ["src/*.schema.ts"])
          const gen = readFileSync(sidecar, "utf8")

          // nullable(string()) → string | null
          const maybeName = typeBody(gen, "MaybeName")
          contains(maybeName, "string")
          contains(maybeName, "null")

          // nullish(number()) → number | null | undefined
          const maybeAge = typeBody(gen, "MaybeAge")
          contains(maybeAge, "number")
          contains(maybeAge, "null")
          contains(maybeAge, "undefined")

          // union([string(), number(), null_()]) → string | number | null
          contains(typeBody(gen, "IdOrCode"), "null")
        },
      },
    ],
  }
}

export function preprocessSuite(api: CompilerApi): Suite {
  const root = fixture("preprocess")
  const sidecar = fixture("preprocess/src/port.schema.gen.ts")
  const query = fixture("preprocess/src/port.schema.tskm-query.ts")

  return {
    title: "preprocess codegen (real tsgo)",
    teardown: () => {
      for (const f of [sidecar, query]) {
        if (existsSync(f)) rmSync(f)
      }
    },
    scenarios: [
      {
        name: "emits the inner output type for preprocess",
        timeout: 60_000,
        run: async () => {
          const result = await generateSidecars(api, root, ["src/port.schema.ts"])
          assert.deepEqual(result.diagnostics, [])
          assert.equal(result.files.length, 1)

          const gen = readFileSync(sidecar, "utf8")
          contains(gen, "export type Port = number")
          contains(gen, "export type Server = {")
          contains(gen, "port: number")
          contains(gen, "verbose: boolean")
        },
      },
    ],
  }
}

// A throwaway schema written INTO the fixture's `src/` (so it sits under the tsconfig include)
// carrying a first-run `Infer` marker for inplace to convert.
const INPLACE_SOURCE = `import { object, string, number, type Infer } from "@tskm/core"

export const widgetSchema = object({
  id: string(),
  size: number(),
})

export type Widget = Infer<typeof widgetSchema>
`

export function inplaceSuite(api: CompilerApi): Suite {
  const root = fixture("basic")
  const source = fixture("basic/src/widget.schema.ts")
  const query = fixture("basic/src/widget.schema.tskm-query.ts")

  const inplace = (include: string[]) =>
    expectNoQueryWrites(root, () =>
      api.generate({
        root,
        mode: "inplace",
        config: withTestTsgo({ include, tsconfig: "tsconfig.json" }),
      }),
    )

  return {
    title: "compiler generate — inplace mode (real tsgo)",
    teardown: () => {
      for (const f of [source, query]) {
        if (existsSync(f)) rmSync(f)
      }
    },
    scenarios: [
      {
        name: "converts an Infer marker into a fenced sentinel block carrying the concrete type",
        timeout: 60_000,
        run: async () => {
          writeFileSync(source, INPLACE_SOURCE)
          const result = await inplace(["src/widget.schema.ts"])

          assert.equal(result.files.length, 1)
          assert.equal(result.files[0]?.mode, "inplace")
          assert.equal(result.files[0]?.changed, true)

          const written = readFileSync(source, "utf8")
          assert.match(written, /\/\/ @tskm-gen Widget from widgetSchema #[0-9a-f]{8}/)
          contains(written, "export type Widget = {")
          contains(written, "id: string")
          contains(written, "size: number")
          contains(written, "// @tskm-end Widget")
          // The schema declaration itself is preserved verbatim.
          contains(written, "export const widgetSchema = object({")
        },
      },
      {
        name: "is idempotent: a second run reports no change and leaves the file untouched",
        timeout: 60_000,
        run: async () => {
          const before = readFileSync(source, "utf8")
          const result = await inplace(["src/widget.schema.ts"])
          assert.equal(result.files[0]?.changed, false)
          assert.equal(readFileSync(source, "utf8"), before)
        },
      },
      {
        name: "leaves no query files behind",
        run: () => {
          assert.equal(existsSync(query), false)
        },
      },
    ],
  }
}
