import type { OutputDataset } from "../types/dataset.ts"
import type { BaseTransformation } from "../types/schema.ts"

/** Nominal-typing marker. Two values with different brands are not assignable. */
export type Brand<TName extends string | symbol> = {
  readonly "~brand": TName
}

export interface BrandAction<TInput, TName extends string | symbol>
  extends BaseTransformation<TInput, TInput & Brand<TName>> {
  readonly type: "brand"
  readonly reference: typeof brand
  readonly name: TName
}

// @__NO_SIDE_EFFECTS__
export function brand<TInput, TName extends string | symbol>(
  name: TName,
): BrandAction<TInput, TName> {
  return {
    kind: "transformation",
    type: "brand",
    reference: brand,
    async: false,
    name,
    "~run"(dataset) {
      // Branding is a compile-time-only refinement; the runtime value is unchanged.
      return dataset as unknown as OutputDataset<TInput & Brand<TName>>
    },
  }
}
