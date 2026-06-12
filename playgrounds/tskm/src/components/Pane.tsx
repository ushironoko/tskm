import type { ReactNode } from "react"
import { cx } from "../lib/class-name.ts"

type PaneVariant = "source" | "input" | "result" | "sidebar"

interface PaneProps {
  readonly title: string
  readonly meta?: ReactNode
  readonly variant?: PaneVariant
  readonly children: ReactNode
}

export function Pane({ title, meta, variant = "source", children }: PaneProps) {
  return (
    <section className={cx("pane", `pane--${variant}`)}>
      <header className="pane__header">
        <h2>{title}</h2>
        {meta ? <div className="pane__meta">{meta}</div> : null}
      </header>
      <div className="pane__body">{children}</div>
    </section>
  )
}
