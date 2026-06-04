import type { InferInput, InferOutput } from "../types/infer.ts"
import type { BaseSchema, GenericSchema } from "../types/schema.ts"
import { _getStandardProps } from "../utils/_getStandardProps.ts"

/**
 * The builder shape `recursive` accepts: given `self`, returns the body schema.
 * `self` is `GenericSchema<any>` (not `unknown`) so an explicitly-typed builder
 * (`(self: GenericSchema<Category>) => …`) still satisfies the constraint despite
 * parameter contravariance.
 */
export type RecursiveBuild = (self: GenericSchema<any>) => BaseSchema<any, any>

export interface RecursiveSchema<TBuild extends RecursiveBuild>
  extends BaseSchema<InferInput<ReturnType<TBuild>>, InferOutput<ReturnType<TBuild>>> {
  readonly type: "recursive"
  readonly reference: typeof recursive
  /**
   * The user's builder, exposed as a public own-property so the AOT compiler can
   * materialize the recursive output type via a one-level unroll:
   * `InferOutput<ReturnType<typeof schema.build<BaseSchema<Sentinel, Sentinel>>>>`.
   * For that query to see the body's STRUCTURE, the builder must be authored as a
   * generic arrow (`recursive(<S extends GenericSchema>(self: S) => ...)`); a plain
   * arrow still validates and still gets a structural recursive type, but transforms
   * inside the cycle then degrade to `unknown`.
   */
  readonly build: TBuild
  /** Resolves (and memoizes) the body. Identity-stable: one body object per schema. */
  readonly getter: () => ReturnType<TBuild>
}

/**
 * The canonical recursive primitive. Unlike `lazy`, the self-reference is passed INTO
 * the builder instead of being read from the surrounding scope, so the declaring
 * `const` never appears in its own initializer — TypeScript's implicit-any rule for
 * self-referential initializers (TS7022) never fires and no hand-written type
 * annotation is needed. The schema object itself IS `self`: the builder receives the
 * exact object `recursive` returns, which gives the AOT walker a stable identity
 * anchor for cycle detection. `build` runs lazily on first `~run`/walk and the body is
 * memoized in a closure, mirroring `lazy`.
 *
 * An explicit output type is optional: `recursive<Category>((self) => ...)` pins
 * `~types` to `Category` for Standard Schema consumers at the call site.
 */
// @__NO_SIDE_EFFECTS__
export function recursive<TBuild extends RecursiveBuild>(build: TBuild): RecursiveSchema<TBuild>
export function recursive<TOutput>(
  build: (self: GenericSchema<TOutput>) => GenericSchema<TOutput>,
): RecursiveSchema<(self: GenericSchema<TOutput>) => GenericSchema<TOutput>>
export function recursive(build: RecursiveBuild): RecursiveSchema<RecursiveBuild> {
  let resolved: BaseSchema<any, any> | undefined
  const getter = (): BaseSchema<any, any> => {
    if (resolved === undefined) {
      resolved = build(self)
    }
    return resolved
  }
  const self: RecursiveSchema<RecursiveBuild> = {
    kind: "schema",
    type: "recursive",
    reference: recursive,
    expects: "unknown",
    async: false,
    build,
    getter,
    get "~standard"() {
      return _getStandardProps(this)
    },
    "~run"(dataset, config) {
      return getter()["~run"](dataset, config)
    },
  }
  return self
}
