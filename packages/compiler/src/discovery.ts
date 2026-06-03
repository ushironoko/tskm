import { parseSync } from "oxc-parser"

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
}

/**
 * Converts a schema const name to a PascalCase type name, stripping a trailing
 * "Schema" suffix: `userSchema` -> `User`, `address` -> `Address`.
 */
export function deriveTypeName(constName: string): string {
  const stripped = constName.endsWith("Schema") ? constName.slice(0, -"Schema".length) : constName
  if (stripped.length === 0) {
    return constName.charAt(0).toUpperCase() + constName.slice(1)
  }
  return stripped.charAt(0).toUpperCase() + stripped.slice(1)
}

interface OxcNode {
  readonly type: string
  readonly [key: string]: unknown
}

function importsFromRuntime(node: OxcNode): boolean {
  const source = node.source as { value?: unknown } | undefined
  return source?.value === RUNTIME_MODULE
}

function collectRuntimeNames(body: ReadonlyArray<OxcNode>): Set<string> {
  const names = new Set<string>()
  for (const node of body) {
    if (node.type !== "ImportDeclaration" || !importsFromRuntime(node)) {
      continue
    }
    const specifiers = (node.specifiers ?? []) as ReadonlyArray<OxcNode>
    for (const spec of specifiers) {
      if (spec.type === "ImportSpecifier") {
        const local = spec.local as { name?: string } | undefined
        if (local?.name) {
          names.add(local.name)
        }
      }
    }
  }
  return names
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
 * schema name plus the declared alias name.
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
  return { name: exprName.name, typeName: id.name, origin: "alias" }
}

export interface DiscoveryResult {
  readonly schemas: ReadonlyArray<DiscoveredSchema>
  readonly diagnostics: ReadonlyArray<string>
}

/**
 * Purely syntactic discovery: finds exported `const <name> = <tskmCallee>(...)`
 * schema declarations and explicit `export type T = Infer<typeof X>` aliases.
 * Returns identifier names only; tsgo offsets are computed later in resolve.
 */
export function discoverSchemas(fileName: string, sourceText: string): DiscoveryResult {
  const parsed = parseSync(fileName, sourceText)
  const diagnostics = (parsed.errors ?? []).map((e) =>
    typeof e === "string" ? e : ((e as { message?: string }).message ?? String(e)),
  )
  const body = (parsed.program?.body ?? []) as unknown as ReadonlyArray<OxcNode>
  const runtimeNames = collectRuntimeNames(body)

  const schemas: DiscoveredSchema[] = []
  const seenNames = new Set<string>()

  const pushConst = (declarator: OxcNode): void => {
    const id = declarator.id as { name?: string } | undefined
    const init = declarator.init as OxcNode | undefined
    if (!id?.name || seenNames.has(id.name)) {
      return
    }
    const callee = calleeName(init)
    if (callee && runtimeNames.has(callee)) {
      seenNames.add(id.name)
      schemas.push({ name: id.name, typeName: deriveTypeName(id.name), origin: "const" })
    }
  }

  for (const node of body) {
    if (node.type === "ExportNamedDeclaration") {
      const decl = node.declaration as OxcNode | undefined
      if (decl?.type === "VariableDeclaration") {
        const declarators = (decl.declarations ?? []) as ReadonlyArray<OxcNode>
        for (const d of declarators) {
          pushConst(d)
        }
      } else {
        const alias = readInferAlias(decl)
        if (alias && !seenNames.has(alias.typeName)) {
          seenNames.add(alias.typeName)
          schemas.push(alias)
        }
      }
    }
  }

  return { schemas, diagnostics }
}
