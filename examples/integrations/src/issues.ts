/**
 * Test helpers for Standard Schema issues. A path segment is a bare key or `{ key }`,
 * and frameworks forward either form, so both are accepted.
 */

export interface IssueLike {
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined
}

/** The top-level field of each issue, sorted so assertions do not depend on issue order. */
export function issueFields(issues: readonly IssueLike[]): string[] {
  return issues
    .map((issue) => {
      const [segment] = issue.path ?? []
      return String(typeof segment === "object" ? segment.key : segment)
    })
    .sort()
}

/** Resolves to the reason a promise rejects with. Fails if it resolves. */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("expected the promise to reject")
}
