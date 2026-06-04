/**
 * Shared cycle-detection driver for walkers over runtime schema object graphs.
 *
 * Both emitters that walk runtime schemas — JSON Schema (`jsonschema.ts`) and
 * structural TS types (`structural-ts.ts`) — must terminate containment cycles
 * (`lazy`/`recursive` back-edges or hand-built loops) by hoisting a re-encountered
 * node into a named definition and emitting a reference to it. The detection logic
 * is identical and soundness-critical, so it lives here ONCE; only the rendering of
 * references/definitions (`emitRef`/`storeDef`) and the per-node body production
 * (`walkBody`) differ per output format.
 *
 * A node is hoisted only if it is actually revisited, so acyclic schemas stay fully
 * inlined.
 */

/** Mutable identity-keyed state threaded through one whole-schema walk. */
export interface CycleGuardState {
  /** Objects currently on the recursion stack; re-entry means a cycle. */
  readonly visiting: Set<object>
  /** Schema object -> its definition name; an entry means the object was hoisted. */
  readonly names: Map<object, string>
}

export function createCycleGuard(): CycleGuardState {
  return { visiting: new Set(), names: new Map() }
}

export interface CycleWalkHooks<TOut> {
  /** Renders a reference to a hoisted definition (JSON: `{$ref}`, TS: the bare name). */
  readonly emitRef: (name: string) => TOut
  /** Stores a finished definition body under its assigned name. */
  readonly storeDef: (name: string, body: TOut) => void
  /** True when a candidate definition name is already taken (collision avoidance). */
  readonly hasDef: (name: string) => boolean
  /** Preferred base name for a node about to be hoisted (export-derived or kind). */
  readonly baseName: (schema: object) => string
  /** The per-node body producer — the only output-format-specific part. */
  readonly walkBody: (schema: object) => TOut
}

/**
 * Walks one node, terminating any containment cycle. A back-edge to an ancestor
 * still being built is assigned a name immediately and rendered as a reference; the
 * in-progress walk deposits the body into the definitions on the way out (via
 * `storeDef`) and itself returns a reference instead of inlining a duplicate.
 */
export function walkWithCycleGuard<TOut>(
  schema: object,
  state: CycleGuardState,
  hooks: CycleWalkHooks<TOut>,
): TOut {
  const hoisted = state.names.get(schema)
  if (hoisted !== undefined) {
    return hooks.emitRef(hoisted)
  }
  if (state.visiting.has(schema)) {
    const name = assignDefName(schema, state, hooks)
    state.names.set(schema, name)
    return hooks.emitRef(name)
  }

  state.visiting.add(schema)
  const body = hooks.walkBody(schema)
  state.visiting.delete(schema)

  const assigned = state.names.get(schema)
  if (assigned !== undefined) {
    hooks.storeDef(assigned, body)
    return hooks.emitRef(assigned)
  }
  return body
}

function hasName(state: CycleGuardState, name: string): boolean {
  for (const value of state.names.values()) {
    if (value === name) {
      return true
    }
  }
  return false
}

function assignDefName<TOut>(
  schema: object,
  state: CycleGuardState,
  hooks: CycleWalkHooks<TOut>,
): string {
  const base = hooks.baseName(schema)
  let candidate = base
  let n = 1
  while (hooks.hasDef(candidate) || hasName(state, candidate)) {
    n += 1
    candidate = `${base}_${n}`
  }
  return candidate
}
