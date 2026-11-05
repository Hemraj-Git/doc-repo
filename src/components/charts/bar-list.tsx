"use client"

import { useState } from "react"
import Link from "next/link"

export type BarDatum = { key: string; label: string; value: number; detail?: string; href?: string }

const BAR = "var(--chart-1)"

/**
 * Horizontal single-series bar list: one hue, value at the bar tip, hover/focus
 * readout. Labels and values are plain text, so the list doubles as its own table.
 */
export function BarList({ data, valueLabel = "documents", empty }: { data: BarDatum[]; valueLabel?: string; empty: string }) {
  const [active, setActive] = useState<string | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))

  if (data.length === 0 || data.every((d) => d.value === 0)) return <p className="text-sm text-muted-foreground">{empty}</p>

  return (
    <ul className="grid gap-2.5">
      {data.map((d) => {
        const pct = (d.value / max) * 100
        const isActive = active === d.key
        const row = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{d.label}</span>
              {isActive && d.detail && <span className="shrink-0 text-xs text-muted-foreground">{d.detail}</span>}
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 min-w-0 flex-1">
                <div
                  className="h-full rounded-r-[4px] transition-opacity"
                  style={{
                    width: `${Math.max(pct, d.value > 0 ? 1.5 : 0)}%`,
                    background: BAR,
                    opacity: active && !isActive ? 0.45 : 1,
                  }}
                />
              </div>
              <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">{d.value}</span>
            </div>
          </>
        )
        const handlers = {
          onPointerEnter: () => setActive(d.key),
          onPointerLeave: () => setActive(null),
          onFocus: () => setActive(d.key),
          onBlur: () => setActive(null),
          "aria-label": `${d.label}: ${d.value} ${valueLabel}${d.detail ? `, ${d.detail}` : ""}`,
        }
        return (
          <li key={d.key}>
            {d.href ? (
              <Link href={d.href} className="-mx-1.5 block rounded-md px-1.5 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50" {...handlers}>
                {row}
              </Link>
            ) : (
              <div tabIndex={0} className="-mx-1.5 rounded-md px-1.5 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50" {...handlers}>
                {row}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
