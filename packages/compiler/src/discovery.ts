import { parseSync } from "oxc-parser"
import { deriveTypeName } from "./naming.ts"

/** The runtime package whose exports mark a value as a tskm schema. */
const RUNTIME_MODULE = "@tskm/core"

/** Type-level aliases that mark `export type T = ...<typeof schema>` AOT targets. */
const INFER_ALIASES = new Set(["Infer", "InferOutput"])

export interface DiscoveredSchema {
  /** The local identifier of the schema value (the `typeof` target in the query). */
  readonly name: string
  /** The emitted type alias name, derived from `name` or the explicit type alias. */
  readonly typeName: string
  /**
   * Where the schema was found: `const` = auto-discovered `export const` factory
   * call; `alias` = explicit `export type T = Infer<typeof X>` marker. Sidecar mode
   * emits both; inplace mode only rewrites `alias` markers.
   */
  readonly origin: "const" | "alias"
  /**
   * True when the const is built by the runtime's `recursive(...)` combinator
   * (tracked through import aliasing). Recursive schemas are routed to the
   * structural/eval path instead of the plain tsgo `InferOutput` query, which would
   * collapse their self positions. Aliases inherit the flag from the referenced
   * same-file const (resolved in a post-pass, so order does not matter). Namespace
   * calls (`t.recursive(...)`) are not detected.
   */
  readonly recursive: boolean
}

// Single naming source, shared with the schema workers (see naming.ts).
export { deriveTypeName } from "./naming.ts"

interface OxcNode {
  readonly type: string
  readonly [key: string]: unknown
}

function importsFromRuntime(node: OxcNode): boolean {
  const source = node.source as { value?: unknown } | undefined
  return source?.value === RUNTIME_MODULE
}

interface RuntimeImports {
  /** Local names bound to any runtime export (schema factories, actions, …). */
  readonly names: Set<string>
  /** Local names bound specifically to the runtime's `recursive` export. */
  readonly recursiveLocals: Set<string>
}

function collectRuntimeImports(body: ReadonlyArray<OxcNode>): RuntimeImports {
  const names = new Set<string>()
  const recursiveLocals = new Set<string>()
  for (const node of body) {
    if (node.type !== "ImportDeclaration" || !importsFromRuntime(node)) {
      continue
    }
    const specifiers = (node.specifiers ?? []) as ReadonlyArray<OxcNode>
    for (const spec of specifiers) {
      if (spec.type === "ImportSpecifier") {
        const local = spec.local as { name?: string } | undefined
        const imported = spec.imported as { name?: string } | undefined
        if (local?.name) {
          names.add(local.name)
          if (imported?.name === "recursive") {
            recursiveLocals.add(local.name)
          }
        }
      }
    }
  }
  return { names, recursiveLocals }
}

function calleeName(init: OxcNode | undefined): string | undefined {
  if (init?.type !== "CallExpression") {
    return undefined
  }
  const callee = init.callee as OxcNode | undefined
  if (callee?.type === "Identifier") {
    return (callee as { name?: string }).name
  }
  return undefined
}

/**
 * Reads an `export type T = Infer<typeof X>` (or `InferOutput<...>`, or
 * `import("@tskm/core").InferOutput<typeof X>`) alias and returns the referenced
 * schema name plus the declared alias name. The `recursive` flag is a placeholder
 * here; `discoverSchemas` resolves it from the referenced const in a post-pass.
 */
function readInferAlias(decl: OxcNode | undefined): DiscoveredSchema | undefined {
  if (decl?.type !== "TSTypeAliasDeclaration") {
    return undefined
  }
  const id = decl.id as { name?: string } | undefined
  const annotation = decl.typeAnnotation as OxcNode | undefined
  if (!id?.name || !annotation) {
    return undefined
  }

  let isInfer = false
  if (annotation.type === "TSTypeReference") {
    const typeName = annotation.typeName as { name?: string } | undefined
    isInfer = typeName?.name !== undefined && INFER_ALIASES.has(typeName.name)
  } else if (annotation.type === "TSImportType") {
    const src = annotation.source as { value?: unknown } | undefined
    const qualifier = annotation.qualifier as { name?: string } | undefined
    isInfer =
      src?.value === RUNTIME_MODULE &&
      qualifier?.name !== undefined &&
      INFER_ALIASES.has(qualifier.name)
  }
  if (!isInfer) {
    return undefined
  }

  const params = (annotation.typeArguments as { params?: ReadonlyArray<OxcNode> } | undefined)
    ?.params
  const first = params?.[0]
  if (first?.type !== "TSTypeQuery") {
    return undefined
  }
  const exprName = first.exprName as { name?: string } | undefined
  if (!exprName?.name) {
    return undefined
  }
  return { name: exprName.name, typeName: id.name, origin: "alias", recursive: false }
}

export interface DiscoveryResult {
  readonly schemas: ReadonlyArray<DiscoveredSchema>
  readonly diagnostics: ReadonlyArray<string>
}

/**
 * Purely syntactic discovery: finds exported `const <name> = <tskmCallee>(...)`
 * schema declarations and explicit `export type T = Infer<typeof X>` aliases.
 * Returns identifier names only; tsgo offsets are computed later in resolve.
 *
 * Recursiveness is recorded for EVERY top-level const initialized by a runtime
 * call — exported or not — so an alias can inherit the flag from a non-exported
 * const. Aliases are patched in a post-pass (not a second AST walk) to keep the
 * emitted order identical to the single-pass discovery.
 */
export function discoverSchemas(fileName: string, sourceText: string): DiscoveryResult {
  const parsed = parseSync(fileName, sourceText)
  const diagnostics = (parsed.errors ?? []).map((e) =>
    typeof e === "string" ? e : ((e as { message?: string }).message ?? String(e)),
  )
  const body = (parsed.program?.body ?? []) as unknown as ReadonlyArray<OxcNode>
  const { names: runtimeNames, recursiveLocals } = collectRuntimeImports(body)

  const schemas: DiscoveredSchema[] = []
  const seenNames = new Set<string>()
  /** Const name -> built by `recursive(...)`, for alias inheritance (post-pass). */
  const constRecursive = new Map<string, boolean>()

  const recordConst = (declarator: OxcNode): void => {
    const id = declarator.id as { name?: string } | undefined
    const callee = calleeName(declarator.init as OxcNode | undefined)
    if (id?.name && callee && runtimeNames.has(callee)) {
      constRecursive.set(id.name, recursiveLocals.has(callee))
    }
  }

  const pushConst = (declarator: OxcNode): void => {
    const id = declarator.id as { name?: string } | undefined
    const init = declarator.init as OxcNode | undefined
    if (!id?.name || seenNames.has(id.name)) {
      return
    }
    const callee = calleeName(init)
    if (callee && runtimeNames.has(callee)) {
      seenNames.add(id.name)
      schemas.push({
        name: id.name,
        typeName: deriveTypeName(id.name),
        origin: "const",
        recursive: recursiveLocals.has(callee),
      })
    }
  }

  for (const node of body) {
    if (node.type === "ExportNamedDeclaration") {
      const decl = node.declaration as OxcNode | undefined
      if (decl?.type === "VariableDeclaration") {
        const declarators = (decl.declarations ?? []) as ReadonlyArray<OxcNode>
        for (const d of declarators) {
          recordConst(d)
          pushConst(d)
        }
      } else {
        const alias = readInferAlias(decl)
        if (alias && !seenNames.has(alias.typeName)) {
          seenNames.add(alias.typeName)
          schemas.push(alias)
        }
      }
    } else if (node.type === "VariableDeclaration") {
      // Non-exported consts are not schemas themselves, but an alias may point at one.
      const declarators = (node.declarations ?? []) as ReadonlyArray<OxcNode>
      for (const d of declarators) {
        recordConst(d)
      }
    }
  }

  const resolved = schemas.map((s) =>
    s.origin === "alias" ? { ...s, recursive: constRecursive.get(s.name) ?? false } : s,
  )

  return { schemas: resolved, diagnostics }
}
