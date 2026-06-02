/** Compact human-readable representation of a received value, for issue messages. */
export function _received(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  const type = typeof value
  if (type === "string") return `"${value as string}"`
  if (type === "number" || type === "boolean") return String(value)
  if (type === "bigint") return `${value as bigint}n`
  if (type === "symbol") return (value as symbol).toString()
  if (type === "function") return "Function"
  if (Array.isArray(value)) return "Array"
  if (value instanceof Date) return "Date"
  return "Object"
}
