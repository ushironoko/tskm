/**
 * Assigns `value` to `target[key]` as an own data property, safe against a `__proto__`
 * input key. A plain `target[key] = value` for `key === "__proto__"` would mutate the
 * object's prototype instead of creating an own property (silently dropping the key and
 * corrupting the prototype), so a fresh-output object copying attacker-shaped input keys
 * must route through here.
 */
export function _safeAssign(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    })
    return
  }
  target[key] = value
}
