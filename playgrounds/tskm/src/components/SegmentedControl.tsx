import type { ReactNode } from "react"
import { cx } from "../lib/class-name.ts"

interface SegmentedControlOption<TValue extends string> {
  readonly value: TValue
  readonly label: ReactNode
}

interface SegmentedControlProps<TValue extends string> {
  readonly ariaLabel: string
  readonly value: TValue
  readonly options: readonly SegmentedControlOption<TValue>[]
  readonly onChange: (value: TValue) => void
}

export function SegmentedControl<TValue extends string>({
  ariaLabel,
  value,
  options,
  onChange,
}: SegmentedControlProps<TValue>) {
  return (
    <fieldset className="segmented-control" aria-label={ariaLabel}>
      <div className="segmented-control__items">
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            className={cx(
              "segmented-control__item",
              option.value === value && "segmented-control__item--active",
            )}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
