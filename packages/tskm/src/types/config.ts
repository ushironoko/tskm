/** Internal run configuration. Distinct from the Standard Schema `Options` object. */
export interface Config {
  /** Stop a container (object/array/...) at its first issue. */
  readonly abortEarly?: boolean | undefined
  /** Stop a pipeline at its first issue. */
  readonly abortPipeEarly?: boolean | undefined
}

/** Frozen default config — there is no global mutable configuration in tskm. */
export const defaultConfig: Config = Object.freeze({})
