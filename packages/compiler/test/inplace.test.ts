import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { DiscoveredSchema } from "../src/discovery.ts"
import { collectInplaceTargets, emitInplace } from "../src/inplace.ts"
import type { ResolvedSchema } from "../src/resolve.ts"

const VERSION = "test-version@0"

let dir: string | undefined

function tmpFile(name: string, content: string): string {
  if (!dir) {
    dir = mkdtempSync(join(tmpdir(), "tskm-inplace-"))
  }
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

function expectedHash(
  typeString: string,
  schemaName: string,
  typeName: string,
  version = VERSION,
): string {
  const payload = `${typeString}\n${version}\n${schemaName}\n${typeName}`
  return createHash("sha256").update(payload).digest("hex").slice(0, 8)
}

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
    dir = undefined
  }
})

describe("emitInplace — first run (Infer marker conversion)", () => {
  it("converts a single-line Infer marker into a fenced sentinel block", () => {
    const source = `import { userSchema } from "./schema"\nexport type User = Infer<typeof userSchema>\n`
    const file = tmpFile("a.ts", source)
    const resolved: ReadonlyArray<ResolvedSchema> = [
      { typeName: "User", typeString: "{ name: string; age: number }" },
    ]

    const result = emitInplace(file, source, resolved, { version: VERSION })

    expect(result.changed).toBe(true)
    expect(result.typeNames).toEqual(["User"])
    const hash = expectedHash("{ name: string; age: number }", "userSchema", "User")
    expect(result.content).toContain(`// @tskm-gen User from userSchema #${hash}`)
    expect(result.content).toContain("export type User = {")
    expect(result.content).toContain("name: string")
    expect(result.content).toContain("age: number")
    expect(result.content).toContain("// @tskm-end User")
    // The original marker line is gone, replaced by the block.
    expect(result.content).not.toContain("Infer<typeof userSchema>")
    // The file on disk matches the returned content.
    expect(readFileSync(file, "utf8")).toBe(result.content)
  })

  it('accepts the import("tskm").InferOutput<...> marker form', () => {
    const source = `export type User = import("tskm").InferOutput<typeof userSchema>\n`
    const file = tmpFile("b.ts", source)
    const result = emitInplace(file, source, [{ typeName: "User", typeString: "{ id: string }" }], {
      version: VERSION,
    })
    expect(result.changed).toBe(true)
    expect(result.content).toContain("// @tskm-gen User from userSchema #")
  })
})

describe("emitInplace — idempotent re-run", () => {
  it("returns changed=false and identical content, and does not rewrite the file", () => {
    const source = `export type User = Infer<typeof userSchema>\n`
    const file = tmpFile("c.ts", source)
    const resolved: ReadonlyArray<ResolvedSchema> = [
      { typeName: "User", typeString: "{ name: string }" },
    ]

    const first = emitInplace(file, source, resolved, { version: VERSION })
    expect(first.changed).toBe(true)

    const mtimeBefore = statSync(file).mtimeMs

    const second = emitInplace(file, first.content, resolved, { version: VERSION })
    expect(second.changed).toBe(false)
    expect(second.content).toBe(first.content)
    expect(second.typeNames).toEqual(["User"])

    // The file must not have been rewritten on the no-op re-run.
    const mtimeAfter = statSync(file).mtimeMs
    expect(mtimeAfter).toBe(mtimeBefore)
    expect(readFileSync(file, "utf8")).toBe(first.content)
  })
})

describe("emitInplace — changed type", () => {
  it("updates the region and bumps the hash when typeString changes", () => {
    const source = `export type User = Infer<typeof userSchema>\n`
    const file = tmpFile("d.ts", source)

    const first = emitInplace(
      file,
      source,
      [{ typeName: "User", typeString: "{ name: string }" }],
      {
        version: VERSION,
      },
    )
    const firstHash = expectedHash("{ name: string }", "userSchema", "User")
    expect(first.content).toContain(`#${firstHash}`)

    const second = emitInplace(
      file,
      first.content,
      [{ typeName: "User", typeString: "{ name: string; age: number }" }],
      { version: VERSION },
    )
    expect(second.changed).toBe(true)
    const secondHash = expectedHash("{ name: string; age: number }", "userSchema", "User")
    expect(secondHash).not.toBe(firstHash)
    expect(second.content).toContain(`#${secondHash}`)
    expect(second.content).not.toContain(`#${firstHash}`)
    expect(second.content).toContain("age: number")
  })
})

describe("collectInplaceTargets", () => {
  it("recovers {name,typeName} from an existing sentinel and merges with a fresh alias", () => {
    const hash = expectedHash("{ id: string }", "userSchema", "User")
    const sentinel = [
      `// @tskm-gen User from userSchema #${hash}`,
      "export type User = {",
      "  id: string",
      "}",
      "// @tskm-end User",
    ].join("\n")
    const fresh: DiscoveredSchema = {
      name: "postSchema",
      typeName: "Post",
      origin: "alias",
    }

    const { targets, diagnostics } = collectInplaceTargets(sentinel, [fresh])

    expect(diagnostics).toEqual([])
    expect(targets).toEqual(
      expect.arrayContaining([
        { name: "postSchema", typeName: "Post", origin: "alias" },
        { name: "userSchema", typeName: "User", origin: "alias" },
      ]),
    )
    expect(targets.length).toBe(2)
  })

  it("dedupes by typeName when an alias already matches a sentinel", () => {
    const hash = expectedHash("{ id: string }", "userSchema", "User")
    const sentinel = [
      `// @tskm-gen User from userSchema #${hash}`,
      "export type User = { id: string }",
      "// @tskm-end User",
    ].join("\n")
    const fresh: DiscoveredSchema = { name: "userSchema", typeName: "User", origin: "alias" }

    const { targets } = collectInplaceTargets(sentinel, [fresh])
    expect(targets.length).toBe(1)
    expect(targets[0]?.typeName).toBe("User")
  })
})

describe("emitInplace — malformed sentinel", () => {
  it("emits a diagnostic and does not corrupt the file when @tskm-end is missing", () => {
    const hash = expectedHash("{ id: string }", "userSchema", "User")
    const source = [
      `// @tskm-gen User from userSchema #${hash}`,
      "export type User = {",
      "  id: string",
      "}",
      "",
    ].join("\n")
    const file = tmpFile("e.ts", source)

    const result = emitInplace(file, source, [{ typeName: "User", typeString: "{ id: string }" }], {
      version: VERSION,
    })

    expect(result.changed).toBe(false)
    expect(result.content).toBe(source)
    expect(result.diagnostics.some((d) => d.includes("no matching @tskm-end"))).toBe(true)
    // File untouched.
    expect(readFileSync(file, "utf8")).toBe(source)
  })
})

describe("emitInplace — two independent regions", () => {
  it("changing one region leaves the other's bytes identical", () => {
    const userHash = expectedHash("{ name: string }", "userSchema", "User")
    const postHash = expectedHash("{ title: string }", "postSchema", "Post")
    const source = [
      `// @tskm-gen User from userSchema #${userHash}`,
      "export type User = {",
      "  name: string",
      "}",
      "// @tskm-end User",
      "",
      "const x = 1",
      "",
      `// @tskm-gen Post from postSchema #${postHash}`,
      "export type Post = {",
      "  title: string",
      "}",
      "// @tskm-end Post",
      "",
    ].join("\n")
    const file = tmpFile("f.ts", source)

    const result = emitInplace(
      file,
      source,
      [
        { typeName: "User", typeString: "{ name: string; email: string }" },
        { typeName: "Post", typeString: "{ title: string }" },
      ],
      { version: VERSION },
    )

    expect(result.changed).toBe(true)
    // User region updated.
    expect(result.content).toContain("email: string")
    // Post region untouched — same bytes.
    const postBlock = [
      `// @tskm-gen Post from postSchema #${postHash}`,
      "export type Post = {",
      "  title: string",
      "}",
      "// @tskm-end Post",
    ].join("\n")
    expect(result.content).toContain(postBlock)
    // The interleaved user code is preserved verbatim.
    expect(result.content).toContain("const x = 1")
  })
})

describe("emitInplace — pretty: false", () => {
  it("emits the raw single-line typeString", () => {
    const source = `export type User = Infer<typeof userSchema>\n`
    const file = tmpFile("g.ts", source)
    const result = emitInplace(
      file,
      source,
      [{ typeName: "User", typeString: "{ name: string; age: number }" }],
      { version: VERSION, pretty: false },
    )
    expect(result.changed).toBe(true)
    expect(result.content).toContain("export type User = { name: string; age: number }")
  })
})

describe("emitInplace — CRLF round-trip", () => {
  it("locates and updates a sentinel region saved with CRLF line endings", () => {
    const seed = tmpFile("crlf-seed.ts", `export type User = Infer<typeof userSchema>\n`)
    const lf = emitInplace(
      seed,
      readFileSync(seed, "utf8"),
      [{ typeName: "User", typeString: "{ name: string }" }],
      { version: VERSION },
    ).content
    // Simulate an editor / git autocrlf normalizing the emitted file to CRLF.
    const crlf = lf.replaceAll("\n", "\r\n")
    const file = tmpFile("crlf.ts", crlf)

    const result = emitInplace(
      file,
      crlf,
      [{ typeName: "User", typeString: "{ name: string; age: number }" }],
      { version: VERSION },
    )

    expect(result.changed).toBe(true)
    const newHash = expectedHash("{ name: string; age: number }", "userSchema", "User")
    expect(result.content).toContain(`#${newHash}`)
    expect(result.content).toContain("age: number")
    // The rewritten block adopts the file's CRLF EOL rather than mixing in lone LFs.
    expect(result.content).toContain(`// @tskm-gen User from userSchema #${newHash}\r\n`)
    expect(result.content).toContain("// @tskm-end User\r\n")
  })

  it("idempotent re-run on a CRLF file does not rewrite", () => {
    const seed = tmpFile("crlf-seed2.ts", `export type User = Infer<typeof userSchema>\n`)
    const lf = emitInplace(
      seed,
      readFileSync(seed, "utf8"),
      [{ typeName: "User", typeString: "{ name: string }" }],
      { version: VERSION },
    ).content
    const crlf = lf.replaceAll("\n", "\r\n")
    const file = tmpFile("crlf2.ts", crlf)

    const result = emitInplace(file, crlf, [{ typeName: "User", typeString: "{ name: string }" }], {
      version: VERSION,
    })
    expect(result.changed).toBe(false)
    expect(result.content).toBe(crlf)
  })
})

describe("emitInplace — unlocatable target", () => {
  it("pushes a diagnostic and leaves the source intact when no region matches", () => {
    const source = `const unrelated = 1\n`
    const file = tmpFile("h.ts", source)
    const result = emitInplace(file, source, [{ typeName: "Ghost", typeString: "{ a: 1 }" }], {
      version: VERSION,
    })
    expect(result.changed).toBe(false)
    expect(result.content).toBe(source)
    expect(result.diagnostics.some((d) => d.includes("Ghost"))).toBe(true)
  })
})
