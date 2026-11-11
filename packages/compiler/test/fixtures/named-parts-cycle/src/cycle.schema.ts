import { array, number, object, recursive, string } from "@tskm/core"

export const pointSchema = object({ x: number(), y: number() })

// Recursive: the structural walker keeps its cycle guard, so the back-edge is `Node`, and the
// `at` part is named `Point` by identity.
export const nodeSchema = recursive((self) =>
  object({ label: string(), at: pointSchema, next: array(self) }),
)

// A non-recursive sibling that shares the same part as the recursive root.
export const routeSchema = object({ start: pointSchema, end: pointSchema, via: array(string()) })
