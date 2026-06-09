/** Compact human-readable representation of a received value, for issue messages. */
export function _received(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  // A switch on typeof lets the engine branch off a single tag load instead of
  // a sequential === chain, and groups every non-null "object" into one arm so
  // the costly Array/Date probes only run once we know the value is an object.
  switch (typeof value) {
    case "string":
      return `"${value as string}"`
    case "number":
      return String(value)
    case "object":
      if (Array.isArray(value)) return "Array"
      if (value instanceof Date) return "Date"
      return "Object"
    case "boolean":
      return String(value)
    case "bigint":
      return `${value as bigint}n`
    case "symbol":
      return (value as symbol).toString()
    case "function":
      return "Function"
    default:
      return "Object"
  }
}
