import type { Issue } from "../types/issue.ts"

/** A thrown validation error. A real `Error` instance (for interop) carrying `issues`. */
export type TskmError = Error & { readonly issues: readonly Issue[] }

const captureStackTrace = (Error as { captureStackTrace?: (target: object, ctor: unknown) => void })
  .captureStackTrace

/**
 * Creates a validation error without defining a class (honors the no-class rule)
 * while remaining `instanceof Error` for ecosystem interop.
 */
export function tskmError(issues: readonly Issue[]): TskmError {
  const message = issues[0]?.message ?? "Validation failed"
  const error = new Error(message) as Error & { issues: readonly Issue[] }
  error.name = "TskmError"
  error.issues = issues
  captureStackTrace?.(error, tskmError)
  return error
}

/**
 * Duck-typed guard. Survives duplicate-package boundaries where `instanceof` on a
 * class would fail, because it checks shape rather than identity.
 */
export function isTskmError(value: unknown): value is TskmError {
  return (
    value instanceof Error &&
    value.name === "TskmError" &&
    Array.isArray((value as { issues?: unknown }).issues)
  )
}
