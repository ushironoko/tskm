/**
 * Standard Schema v1 and Standard JSON Schema v1, vendored verbatim from
 * `@standard-schema/spec@1.1.0`. Copied (the spec endorses copy-pasting) so the
 * published runtime carries no dependency. Conformance with the real package is
 * asserted in the type tests.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>
}

export declare namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
      options?: StandardSchemaV1.Options | undefined,
    ) => Result<Output> | Promise<Result<Output>>
    readonly types?: Types<Input, Output> | undefined
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult

  export interface SuccessResult<Output> {
    readonly value: Output
    readonly issues?: undefined
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>
  }

  export interface Options {
    readonly libraryOptions?: Record<string, unknown> | undefined
  }

  export interface Issue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined
  }

  export interface PathSegment {
    readonly key: PropertyKey
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input
    readonly output: Output
  }

  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["input"]

  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["output"]
}

/** Standard JSON Schema v1. Orthogonal to {@link StandardSchemaV1}: no `validate`. */
export interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardJSONSchemaV1.Props<Input, Output>
}

export declare namespace StandardJSONSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1
    readonly vendor: string
    readonly types?: Types<Input, Output> | undefined
    readonly jsonSchema: Converter
  }

  export interface Converter {
    readonly input: (options: Options) => Record<string, unknown>
    readonly output: (options: Options) => Record<string, unknown>
  }

  /**
   * Known targets plus `{} & string`, so a future target stays assignable
   * while editors still autocomplete the three drafts the spec names.
   */
  export type Target = "draft-2020-12" | "draft-07" | "openapi-3.0" | ({} & string)

  export interface Options {
    readonly target: Target
    readonly libraryOptions?: Record<string, unknown> | undefined
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input
    readonly output: Output
  }

  export type InferInput<Schema extends StandardJSONSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["input"]

  export type InferOutput<Schema extends StandardJSONSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["output"]
}
