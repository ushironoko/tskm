import { parseSync } from "oxc-parser"
import { matchesSchemaSource, RUNTIME_SCHEMA_SOURCE, vendorName } from "./config.ts"
import { deriveTypeName } from "./naming.ts"

/** The runtime package whose exports mark a value as a tskm schema. */
const RUNTIME_MODULE = RUNTIME_SCHEMA_SOURCE

/** Type-level aliases that mark `export type T = ...<typeof schema>` AOT targets. */
const INFER_ALIASES = new Set(["Infer", "InferOutput"])

/** Where a discovered schema comes from: tskm's own runtime, or an external Standard Schema library. */
export type SchemaSourceKind = "tskm" | "standard"

/**
 * Per-target capability metadata: the routing authority for everything downstream
 * of discovery. A plain `recursive` bit cannot encode source kind, resolver choice,
 * and feature support at once, so each downstream feature gates on its own field
 * (Tier-1 and the structural walker are tskm-only by principle — they read tskm's
 * internal object conventions).
 */
export interface SchemaCapability {
  readonly sourceKind: SchemaSourceKind
  /** Vendor guess derived from the import's module name (`"zod"`…); tskm is `undefined`. */
  readonly vendorHint: string | undefined
  /**
   * Syntactic certainty: tskm imports are `confirmed` schemas; external-source
   * candidates stay `candidate` until the checker's `~standard` probe passes.
   */
  readonly confidence: "confirmed" | "candidate"
  /**
   * Type-resolution route: `core-recursive` = tskm `recursive(...)` structural
   * worker; `standard-checker` = the generic `~standard` tsgo query.
   */
  readonly typeResolver: "core-recursive" | "standard-checker"
  /** Tier-1 sentinel-unroll applies (tskm `recursive(...)` only). */
  readonly tier1Supported: boolean
  /** Inplace marker rewriting applies (tskm only in this iteration). */
  readonly inplaceSupported: boolean
}

/** The capability block of a tskm-runtime schema (invariant: recursive ⟺ core-recursive). */
export function tskmCapability(recursive: boolean): SchemaCapability {
  return {
    sourceKind: "tskm",
    vendorHint: undefined,
    confidence: "confirmed",
    typeResolver: recursive ? "core-recursive" : "standard-checker",
    tier1Supported: recursive,
    inplaceSupported: true,
  }
}

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
   *
   * Kept in sync with `capability.typeResolver` (`true` ⟺ `core-recursive`).
   */
  readonly recursive: boolean
  /** Routing/feature metadata; see {@link SchemaCapability}. */
  readonly capability: SchemaCapability
  /**
   * The self-annotation type argument captured from the declarator
   * (`const cat: z.ZodType<CatT> = ...`): external recursive schemas render as a
   * bare reference to this name, so emit needs to know it and whether the file
   * exports it (a non-exported name cannot be imported by the sidecar).
   * `exportedAs` is present only when the importable name differs from `name`
   * (aliased re-export: `export { type CatT as PublicCat }`) — emit then
   * rebinds on import (`import type { PublicCat as CatT }`).
   */
  readonly recursiveAnnotation?: {
    readonly name: string
    readonly exported: boolean
    readonly exportedAs?: string
  }
}

// Single naming source, shared with the schema workers (see naming.ts).
export { deriveTypeName } from "./naming.ts"

interface OxcNode {
  readonly type: string
  readonly [key: string]: unknown
}

interface SourceImports {
  /** Named/default-import locals -> the schema source they came from. */
  readonly named: Map<string, string>
  /** Namespace-import locals (`import * as z`) -> the schema source. */
  readonly namespaces: Map<string, string>
  /** Local names bound specifically to @tskm/core's `recursive` export. */
  readonly recursiveLocals: Set<string>
}

/**
 * Collects every local binding imported from a configured schema source. A
 * subpath import (`zod/v4`) maps to its root source (`zod`), which doubles as
 * the vendor hint. Only @tskm/core's `recursive` participates in core-recursive
 * routing — an external export of the same name never does.
 */
function collectSourceImports(
  body: ReadonlyArray<OxcNode>,
  schemaSources: ReadonlyArray<string>,
): SourceImports {
  const named = new Map<string, string>()
  const namespaces = new Map<string, string>()
  const recursiveLocals = new Set<string>()
  for (const node of body) {
    if (node.type !== "ImportDeclaration") {
      continue
    }
    const module = (node.source as { value?: unknown } | undefined)?.value
    if (typeof module !== "string") {
      continue
    }
    const source = schemaSources.find((s) => matchesSchemaSource(module, s))
    if (!source) {
      continue
    }
    const specifiers = (node.specifiers ?? []) as ReadonlyArray<OxcNode>
    for (const spec of specifiers) {
      const local = (spec.local as { name?: string } | undefined)?.name
      if (!local) {
        continue
      }
      if (spec.type === "ImportSpecifier") {
        named.set(local, source)
        const imported = (spec.imported as { name?: string } | undefined)?.name
        if (source === RUNTIME_MODULE && imported === "recursive") {
          recursiveLocals.add(local)
        }
      } else if (spec.type === "ImportNamespaceSpecifier") {
        namespaces.set(local, source)
      } else if (spec.type === "ImportDefaultSpecifier") {
        named.set(local, source)
      }
    }
  }
  return { named, namespaces, recursiveLocals }
}

/** The base identifier of a callee chain: `z` in `z.object(...)` and `z.string().brand()`. */
function rootIdentifierName(node: OxcNode | undefined): string | undefined {
  if (!node) {
    return undefined
  }
  if (node.type === "Identifier") {
    return (node as { name?: string }).name
  }
  if (
    node.type === "MemberExpression" ||
    node.type === "StaticMemberExpression" ||
    node.type === "ComputedMemberExpression"
  ) {
    return rootIdentifierName(node.object as OxcNode | undefined)
  }
  if (node.type === "CallExpression") {
    return rootIdentifierName(node.callee as OxcNode | undefined)
  }
  return undefined
}

interface CalleeInfo {
  /** The schema source the call resolves to. */
  readonly source: string
  /** The local identifier the call is rooted at (recursive-flag lookups). */
  readonly callee: string
}

/**
 * Resolves a const initializer's call to its schema source. A DIRECT identifier
 * callee resolves through named/default imports (the historical tskm contract).
 * Member and chained callees (`z.object(...)`, `z.string().brand()`) resolve
 * through the root identifier for EXTERNAL sources only — a tskm namespace call
 * (`t.object(...)`) stays undiscovered, exactly as before.
 */
function calleeInfo(init: OxcNode | undefined, imports: SourceImports): CalleeInfo | undefined {
  if (init?.type !== "CallExpression") {
    return undefined
  }
  const callee = init.callee as OxcNode | undefined
  if (callee?.type === "Identifier") {
    const name = (callee as { name?: string }).name
    if (!name) {
      return undefined
    }
    const source = imports.named.get(name)
    return source ? { source, callee: name } : undefined
  }
  const root = rootIdentifierName(callee)
  if (!root) {
    return undefined
  }
  const source = imports.namespaces.get(root) ?? imports.named.get(root)
  if (!source || source === RUNTIME_MODULE) {
    return undefined
  }
  return { source, callee: root }
}

/**
 * The capability block for a const built from `source` (see {@link SchemaCapability}).
 * The hint is the source's VENDOR root, not the verbatim source string: an
 * explicit subpath source (a configured `zod/v4`) still identifies as vendor
 * `zod` for brand-import gating and diagnostics, while the matched source
 * string keeps driving runtime-vs-standard routing.
 */
function capabilityFor(source: string, recursive: boolean): SchemaCapability {
  if (source === RUNTIME_MODULE) {
    return tskmCapability(recursive)
  }
  return {
    sourceKind: "standard",
    vendorHint: vendorName(source),
    confidence: "candidate",
    typeResolver: "standard-checker",
    tier1Supported: false,
    inplaceSupported: false,
  }
}

/**
 * Reads the declarator's self-annotation type argument: `CatT` in
 * `const cat: z.ZodType<CatT> = ...` or `VNode` in `v.GenericSchema<VNode>`.
 * Only a PLAIN identifier reference counts — that is the name the rendered
 * type will carry verbatim, so emit must know whether it is importable.
 */
function readAnnotationName(declarator: OxcNode): string | undefined {
  const id = declarator.id as OxcNode | undefined
  const outer = (id as { typeAnnotation?: OxcNode } | undefined)?.typeAnnotation
  const annotation = (outer as { typeAnnotation?: OxcNode } | undefined)?.typeAnnotation
  if (annotation?.type !== "TSTypeReference") {
    return undefined
  }
  const params = (annotation.typeArguments as { params?: ReadonlyArray<OxcNode> } | undefined)
    ?.params
  const first = params?.[0]
  if (first?.type !== "TSTypeReference") {
    return undefined
  }
  const typeName = first.typeName as { type?: string; name?: string } | undefined
  return typeName?.type === "Identifier" ? typeName.name : undefined
}

/**
 * Maps every locally-declared type name to the name importers see: declared
 * exports (`export type T`, `export interface T`) map to themselves;
 * re-export specifiers (`export { T }`, `export { type T as U }`) map the
 * LOCAL name to the EXPORTED one — the identifier a sidecar `import type`
 * must use. An identity export of the same local wins over an alias, so emit
 * only rebinds when it must. A string-literal export name (`as "weird"`) is
 * not an identifier and is skipped (fail-closed: the annotation stays
 * non-importable).
 */
function collectTypeExports(body: ReadonlyArray<OxcNode>): Map<string, string> {
  const exports = new Map<string, string>()
  const record = (local: string, exported: string): void => {
    const existing = exports.get(local)
    if (existing === local) {
      return
    }
    if (existing === undefined || exported === local) {
      exports.set(local, exported)
    }
  }
  for (const node of body) {
    if (node.type !== "ExportNamedDeclaration") {
      continue
    }
    const decl = node.declaration as OxcNode | undefined
    if (decl?.type === "TSTypeAliasDeclaration" || decl?.type === "TSInterfaceDeclaration") {
      const id = decl.id as { name?: string } | undefined
      if (id?.name) {
        record(id.name, id.name)
      }
    }
    const specifiers = (node.specifiers ?? []) as ReadonlyArray<OxcNode>
    for (const spec of specifiers) {
      const local = (spec.local as { name?: string } | undefined)?.name
      const exported = (spec.exported as { name?: string } | undefined)?.name
      if (local && exported) {
        record(local, exported)
      }
    }
  }
  return exports
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
  return {
    name: exprName.name,
    typeName: id.name,
    origin: "alias",
    recursive: false,
    capability: tskmCapability(false),
  }
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
export interface DiscoverOptions {
  /**
   * Schema source modules to track (see config's `schemaSources`). Defaults to
   * @tskm/core only, so a bare call keeps the historical tskm-only behavior.
   */
  readonly schemaSources?: ReadonlyArray<string>
}

export function discoverSchemas(
  fileName: string,
  sourceText: string,
  options: DiscoverOptions = {},
): DiscoveryResult {
  const schemaSources = options.schemaSources ?? [RUNTIME_MODULE]
  const parsed = parseSync(fileName, sourceText)
  const diagnostics = (parsed.errors ?? []).map((e) =>
    typeof e === "string" ? e : ((e as { message?: string }).message ?? String(e)),
  )
  const body = (parsed.program?.body ?? []) as unknown as ReadonlyArray<OxcNode>
  const imports = collectSourceImports(body, schemaSources)
  const typeExports = collectTypeExports(body)

  const schemas: DiscoveredSchema[] = []
  const seenNames = new Set<string>()
  /** Const name -> inheritable metadata, for alias inheritance (post-pass). */
  const constCapability = new Map<
    string,
    {
      readonly capability: SchemaCapability
      readonly recursiveAnnotation: DiscoveredSchema["recursiveAnnotation"]
    }
  >()

  const constMeta = (
    declarator: OxcNode,
  ):
    | {
        readonly name: string
        readonly capability: SchemaCapability
        readonly recursive: boolean
        readonly recursiveAnnotation: DiscoveredSchema["recursiveAnnotation"]
      }
    | undefined => {
    const id = declarator.id as { name?: string } | undefined
    const info = calleeInfo(declarator.init as OxcNode | undefined, imports)
    if (!id?.name || !info) {
      return undefined
    }
    const recursive = info.source === RUNTIME_MODULE && imports.recursiveLocals.has(info.callee)
    const annotationName = readAnnotationName(declarator)
    const exportedAs = annotationName ? typeExports.get(annotationName) : undefined
    return {
      name: id.name,
      capability: capabilityFor(info.source, recursive),
      recursive,
      recursiveAnnotation: annotationName
        ? {
            name: annotationName,
            exported: exportedAs !== undefined,
            // Only an aliased re-export needs the rebinding name.
            ...(exportedAs !== undefined && exportedAs !== annotationName ? { exportedAs } : {}),
          }
        : undefined,
    }
  }

  const recordConst = (declarator: OxcNode): void => {
    const meta = constMeta(declarator)
    if (meta) {
      constCapability.set(meta.name, {
        capability: meta.capability,
        recursiveAnnotation: meta.recursiveAnnotation,
      })
    }
  }

  const pushConst = (declarator: OxcNode): void => {
    const meta = constMeta(declarator)
    if (!meta || seenNames.has(meta.name)) {
      return
    }
    seenNames.add(meta.name)
    schemas.push({
      name: meta.name,
      typeName: deriveTypeName(meta.name),
      origin: "const",
      recursive: meta.recursive,
      capability: meta.capability,
      ...(meta.recursiveAnnotation ? { recursiveAnnotation: meta.recursiveAnnotation } : {}),
    })
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

  const resolved = schemas.map((s) => {
    if (s.origin !== "alias") {
      return s
    }
    const inherited = constCapability.get(s.name)
    if (!inherited) {
      return s
    }
    // The alias inherits the referenced const's full capability (and annotation);
    // `recursive` is re-derived from it so the two can never drift apart.
    return {
      ...s,
      recursive: inherited.capability.typeResolver === "core-recursive",
      capability: inherited.capability,
      ...(inherited.recursiveAnnotation
        ? { recursiveAnnotation: inherited.recursiveAnnotation }
        : {}),
    }
  })

  return { schemas: resolved, diagnostics }
}
