/** Median of a list (0 for an empty list). */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const left = sorted[mid - 1] ?? 0
  const right = sorted[mid] ?? 0
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : (left + right) / 2
}

/** Smallest and largest value. */
export function bounds(values: readonly number[]): { readonly min: number; readonly max: number } {
  const sorted = [...values].sort((a, b) => a - b)
  return { min: sorted[0] ?? 0, max: sorted.at(-1) ?? 0 }
}
