import type { BaseSchema, BaseSchemaAsync } from "./schema.ts"

type AnySchema = BaseSchema<unknown, unknown> | BaseSchemaAsync<unknown, unknown>

/** Infers the input type of a schema. */
export type InferInput<TSchema extends AnySchema> = TSchema["~standard"]["types"]["input"]

/** Infers the output type of a schema (the type the AOT compiler materializes). */
export type InferOutput<TSchema extends AnySchema> = TSchema["~standard"]["types"]["output"]

/** Alias for {@link InferOutput}, used as the AOT marker in user code. */
export type Infer<TSchema extends AnySchema> = InferOutput<TSchema>
