/** Parse mode: bail at the first error (fast acceptance gate) or collect every issue. */
export type ParseMode = "reject" | "report"

/** Internal run configuration. Distinct from the Standard Schema `Options` object. */
export interface Config {
  /** Stop a container (object/array/...) at its first issue. */
  readonly abortEarly?: boolean | undefined
  /** Stop a pipeline at its first issue. */
  readonly abortPipeEarly?: boolean | undefined
  /**
   * Parse mode. `reject` bails at the first error-severity issue (the fast acceptance
   * gate); `report` collects every issue across the whole value (the diagnostics path,
   * the default). `abortEarly: true` is the back-compat alias for `reject`.
   */
  readonly mode?: ParseMode | undefined
}

/** Frozen default config — there is no global mutable configuration in tskm. */
export const defaultConfig: Config = Object.freeze({})

/** True if the run should bail at the first error (reject mode, or the legacy abortEarly). */
export function isReject(config: Config): boolean {
  return config.mode === "reject" || config.abortEarly === true
}
