import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { TskmConfig } from "../src/config.ts"
import { defineConfig, loadConfig, resolveConfig } from "../src/config.ts"

// Absolute file URL of the real source, used so a temp config can import
// `defineConfig` without depending on node_modules resolution from a tmp dir.
const CONFIG_SOURCE_URL = pathToFileURL(resolve(import.meta.dir, "../src/config.ts")).href

const tempDirs: string[] = []

const makeTempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "tskm-config-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe("defineConfig", () => {
  it("returns its input unchanged (identity)", () => {
    const input: TskmConfig = {
      mode: "inplace",
      include: ["lib/**/*.ts"],
      tsconfig: "tsconfig.build.json",
      executable: "/bin/tsgo",
      jsonSchema: { outDir: "out" },
      watch: { debounceMs: 200 },
    }
    expect(defineConfig(input)).toBe(input)
    expect(defineConfig(input)).toEqual(input)
  })

  it("round-trips an empty config", () => {
    const input: TskmConfig = {}
    expect(defineConfig(input)).toBe(input)
  })
})

describe("resolveConfig — defaults", () => {
  it("applies every default for an empty config", () => {
    const resolved = resolveConfig({}, "/proj")
    expect(resolved.mode).toBe("sidecar")
    expect(resolved.include).toEqual(["src/**/*.ts"])
    expect(resolved.tsconfig).toBe("/proj/tsconfig.json")
    expect(resolved.executable).toBeUndefined()
    expect(resolved.jsonSchema).toEqual({ outDir: undefined })
    expect(resolved.watch).toEqual({ debounceMs: 50 })
    expect(resolved.root).toBe("/proj")
  })

  it("resolves a relative root to an absolute path", () => {
    const resolved = resolveConfig({}, "proj/nested")
    expect(resolved.root).toBe(resolve("proj/nested"))
    expect(resolved.tsconfig).toBe(join(resolve("proj/nested"), "tsconfig.json"))
  })
})

describe("resolveConfig — overrides", () => {
  it("honors custom mode, include, executable, jsonSchema outDir and debounce", () => {
    const resolved = resolveConfig(
      {
        mode: "inplace",
        include: ["a/**/*.ts", "b/**/*.ts"],
        executable: "/usr/bin/tsgo",
        jsonSchema: { outDir: "schemas" },
        watch: { debounceMs: 250 },
      },
      "/proj",
    )
    expect(resolved.mode).toBe("inplace")
    expect(resolved.include).toEqual(["a/**/*.ts", "b/**/*.ts"])
    expect(resolved.executable).toBe("/usr/bin/tsgo")
    expect(resolved.jsonSchema).toEqual({ outDir: "schemas" })
    expect(resolved.watch).toEqual({ debounceMs: 250 })
  })

  it("joins a relative tsconfig against the resolved root", () => {
    const resolved = resolveConfig({ tsconfig: "config/tsconfig.app.json" }, "/proj")
    expect(resolved.tsconfig).toBe("/proj/config/tsconfig.app.json")
  })

  it("keeps an absolute tsconfig as-is", () => {
    const resolved = resolveConfig({ tsconfig: "/abs/tsconfig.json" }, "/proj")
    expect(resolved.tsconfig).toBe("/abs/tsconfig.json")
  })

  it("treats debounceMs of 0 as an explicit override, not the default", () => {
    const resolved = resolveConfig({ watch: { debounceMs: 0 } }, "/proj")
    expect(resolved.watch.debounceMs).toBe(0)
  })

  it("falls back to the default debounce when watch has no debounceMs", () => {
    const resolved = resolveConfig({ watch: {} }, "/proj")
    expect(resolved.watch.debounceMs).toBe(50)
  })

  it("leaves jsonSchema outDir undefined when jsonSchema is provided without outDir", () => {
    const resolved = resolveConfig({ jsonSchema: {} }, "/proj")
    expect(resolved.jsonSchema.outDir).toBeUndefined()
  })
})

describe("loadConfig — no config file", () => {
  it("returns resolved defaults when the directory has no config file", async () => {
    const dir = makeTempDir()
    const resolved = await loadConfig(dir)
    expect(resolved.mode).toBe("sidecar")
    expect(resolved.include).toEqual(["src/**/*.ts"])
    expect(resolved.tsconfig).toBe(join(resolve(dir), "tsconfig.json"))
    expect(resolved.root).toBe(resolve(dir))
    expect(resolved.watch).toEqual({ debounceMs: 50 })
  })
})

describe("loadConfig — tskm.config.ts via default export", () => {
  it("loads and merges a config that imports defineConfig", async () => {
    const dir = makeTempDir()
    writeFileSync(
      join(dir, "tskm.config.ts"),
      `import { defineConfig } from ${JSON.stringify(CONFIG_SOURCE_URL)}\n` +
        `export default defineConfig({\n` +
        `  mode: "inplace",\n` +
        `  include: ["app/**/*.ts"],\n` +
        `  tsconfig: "tsconfig.app.json",\n` +
        `  jsonSchema: { outDir: "gen" },\n` +
        `  watch: { debounceMs: 123 },\n` +
        `})\n`,
    )
    const resolved = await loadConfig(dir)
    expect(resolved.mode).toBe("inplace")
    expect(resolved.include).toEqual(["app/**/*.ts"])
    expect(resolved.tsconfig).toBe(join(resolve(dir), "tsconfig.app.json"))
    expect(resolved.jsonSchema).toEqual({ outDir: "gen" })
    expect(resolved.watch).toEqual({ debounceMs: 123 })
    expect(resolved.root).toBe(resolve(dir))
  })

  it("merges a plain object default export (no defineConfig wrapper)", async () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, "tskm.config.ts"), `export default { mode: "sidecar" }\n`)
    const resolved = await loadConfig(dir)
    expect(resolved.mode).toBe("sidecar")
    expect(resolved.include).toEqual(["src/**/*.ts"])
  })
})

describe("loadConfig — named `config` export fallback", () => {
  it("uses the `config` export when there is no default export", async () => {
    const dir = makeTempDir()
    writeFileSync(
      join(dir, "tskm.config.ts"),
      `export const config = { mode: "inplace", watch: { debounceMs: 77 } }\n`,
    )
    const resolved = await loadConfig(dir)
    expect(resolved.mode).toBe("inplace")
    expect(resolved.watch).toEqual({ debounceMs: 77 })
  })
})

describe("loadConfig — error path", () => {
  it("throws when the config file has neither default nor config export", async () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, "tskm.config.ts"), `export const other = { mode: "inplace" }\n`)
    await expect(loadConfig(dir)).rejects.toThrow(/no default export/)
  })
})
