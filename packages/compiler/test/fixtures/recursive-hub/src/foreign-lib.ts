// Stands in for a hypothetical EXTERNAL Standard Schema library that also exposes a
// named `recursive` helper. Its runtime value even mimics tskm's `type: "recursive"`
// marker, but reports a different `~standard.vendor`. Discovery flags it core-recursive
// (the name is the only syntactic signal), so the structural worker is the safety net:
// it must reject this on the vendor gate and skip with a diagnostic — never walk a
// foreign graph, never emit an empty/invalid alias.
export function recursive(_build: (self: unknown) => unknown): {
  readonly type: "recursive"
  readonly "~standard": {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => { value: unknown }
  }
} {
  return {
    type: "recursive",
    "~standard": { version: 1, vendor: "foreign", validate: (value: unknown) => ({ value }) },
  }
}
