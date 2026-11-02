/** Fixed procedure. Change these only by re-running and replacing RESULTS.md. */
export const warmupIterations = 20_000
export const measuredIterations = 100_000
export const measuredRuns = 5
export const memoryParses = 50_000
export const typeCopies = 100

export const libraries = ["tskm", "zod", "valibot", "arktype", "typebox", "effect"] as const

export type LibraryName = (typeof libraries)[number]
