export function formatJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item) => {
      if (typeof item === "bigint") return `${item}n`
      if (item instanceof RegExp) return item.toString()
      if (typeof item === "function") return `[Function ${item.name || "anonymous"}]`
      return item
    },
    2,
  )
}
