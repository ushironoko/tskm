import type { ReactNode } from "react"
import { cx } from "../lib/class-name.ts"

type StatusBadgeVariant = "success" | "error" | "warning" | "neutral"

interface StatusBadgeProps {
  readonly variant?: StatusBadgeVariant
  readonly children: ReactNode
}

export function StatusBadge({ variant = "neutral", children }: StatusBadgeProps) {
  return <span className={cx("status-badge", `status-badge--${variant}`)}>{children}</span>
}
