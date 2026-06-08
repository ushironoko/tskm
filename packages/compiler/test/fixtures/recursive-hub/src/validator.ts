// Anti-corruption layer: a project re-exports the tskm runtime through ONE module
// (`@validator`) and authors all schemas against it, never importing `@tskm/core`
// directly. The compiler must still route `recursive(...)` roots built through this
// hub to the structural walker — the runtime value is identical regardless of the
// import path, so detection cannot depend on a direct `@tskm/core` import.
export {
  array,
  boolean,
  null_,
  number,
  object,
  optional,
  record,
  recursive,
  string,
  union,
} from "@tskm/core"
