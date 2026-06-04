import { type Infer, object, optional, recursive, string } from "@tskm/core"

// Specifier-form export: the const is not exported inline, but `export { nodeSchema }`
// makes it importable as `mod.nodeSchema`, so the alias target resolves end-to-end.
// This locks the supported v1 surface beyond inline `export const`.
const nodeSchema = recursive((self) =>
  object({
    label: string(),
    next: optional(self),
  }),
)

export { nodeSchema }

export type SpecNode = Infer<typeof nodeSchema>
