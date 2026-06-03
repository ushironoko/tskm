/**
 * Converts a schema const name to a PascalCase type name, stripping a trailing
 * "Schema" suffix: `userSchema` -> `User`, `address` -> `Address`.
 *
 * This is the SINGLE naming source: discovery derives `DiscoveredSchema.typeName`
 * with it, and the schema workers derive definition names for exported runtime
 * objects with it, so a structurally-emitted back-edge always renders the exact
 * string the sidecar declares. It lives in its own module (not `discovery.ts`) so
 * the workers can import it without pulling the oxc parser into their bundles.
 */
export function deriveTypeName(constName: string): string {
  const stripped = constName.endsWith("Schema") ? constName.slice(0, -"Schema".length) : constName
  if (stripped.length === 0) {
    return constName.charAt(0).toUpperCase() + constName.slice(1)
  }
  return stripped.charAt(0).toUpperCase() + stripped.slice(1)
}
