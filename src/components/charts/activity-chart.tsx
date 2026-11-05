"use client"

import { useEffect, useMemo, useRef, useState } from "react"

export type ActivityPoint = { day: string; uploads: number; approvals: number }

// Validated categorical slots 1 and 2 (adjacent CVD ΔE 24.7, all checks pass on light).
const SERIES = [
  { key: "uploads", label: "Uploads", color: "#2a78d6" },
  { key: "approvals", label: "Approvals", color: "#eb6834" },
] as const

const INK = { grid: "#e1e0d9", axis: "#c3c2b7", muted: "#898781", surface: "#ffffff" }
const M = { top: 12, right: 92, bottom: 24, left: 30 }
const HEIGHT = 200

const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`))

function niceMax(v: number) {
  if (v <= 4) return 4
  const step = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / step) * step
}

/** Two-series daily line chart with a snapping crosshair, legend, end labels and a table view. */
export function ActivityChart({ data }: { data: ActivityPoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry!.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const max = niceMax(Math.max(...data.flatMap((d) => [d.uploads, d.approvals]), 0))
  const innerW = width - M.left - M.right
  const innerH = HEIGHT - M.top - M.bottom
  const x = (i: number) => M.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
  const y = (v: number) => M.top + innerH - (v / max) * innerH

  const paths = useMemo(
    () =>
      SERIES.map((s) => ({
        ...s,
        d: data.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join(""),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, width, max]
  )

  const total = (k: "uploads" | "approvals") => data.reduce((s, p) => s + p[k], 0)
  const last = data[data.length - 1]
  const endY = last ? SERIES.map((s) => y(last[s.key])) : []
  const endLabelsFit = endY.length === 2 && Math.abs(endY[0]! - endY[1]!) >= 14
  const xTicks = data.map((_, i) => i).filter((i) => i === 0 || i === data.length - 1 || (data.length - 1 - i) % 7 === 0)
  const yTicks = [0, max / 2, max]

  const pick = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || data.length === 0) return
    const rel = clientX - rect.left - M.left
    const i = Math.round((rel / innerW) * (data.length - 1))
    setHover(Math.min(data.length - 1, Math.max(0, i)))
  }

  const hp = hover != null ? data[hover] : null

  return (
    <div className="grid gap-2">
      {/* Legend: line keys mirror the marks */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
            {s.label} <span className="font-medium text-foreground tabular-nums">{total(s.key)}</span>
          </span>
        ))}
      </div>

      <div ref={wrapRef} className="relative">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Uploads and approvals per day over the last ${data.length} days: ${total("uploads")} uploads, ${total("approvals")} approvals.`}
          className="block max-w-full overflow-visible"
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? INK.axis : INK.grid} strokeWidth={1} />
              <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK.muted} className="tabular-nums">
                {Number.isInteger(t) ? t : t.toFixed(1)}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text key={i} x={x(i)} y={HEIGHT - 6} textAnchor="middle" fontSize={11} fill={INK.muted}>
              {fmtDay(data[i]!.day)}
            </text>
          ))}

          {paths.map((p) => (
            <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {/* End markers + direct labels (dropped when they would collide; the legend still names the series) */}
          {last &&
            SERIES.map((s, i) => (
              <g key={s.key}>
                <circle cx={x(data.length - 1)} cy={endY[i]} r={4} fill={s.color} stroke={INK.surface} strokeWidth={2} />
                {endLabelsFit && (
                  <text x={x(data.length - 1) + 10} y={endY[i]} dy="0.32em" fontSize={11} fill="currentColor" className="text-muted-foreground">
                    {s.label} {last[s.key]}
                  </text>
                )}
              </g>
            ))}

          {hp && hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + innerH} stroke={INK.axis} strokeWidth={1} />
              {SERIES.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(hp[s.key])} r={4} fill={s.color} stroke={INK.surface} strokeWidth={2} />
              ))}
            </g>
          )}

          {/* Hit layer: the crosshair snaps to the nearest day; arrow keys move it */}
          <rect
            x={M.left}
            y={M.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            tabIndex={0}
            aria-label="Chart. Use left and right arrow keys to read daily values."
            className="outline-none focus-visible:stroke-ring"
            onPointerMove={(e) => pick(e.clientX)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(data.length - 1)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? data.length - 1) - 1))
              if (e.key === "ArrowRight") setHover((h) => Math.min(data.length - 1, (h ?? 0) + 1))
            }}
          />
        </svg>

        {hp && hover != null && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: Math.min(Math.max(x(hover) + 10, 0), width - 130) }}
            role="status"
          >
            <div className="mb-1 text-muted-foreground">{fmtDay(hp.day)}</div>
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                <span className="font-semibold tabular-nums">{hp[s.key]}</span>
                <span className="text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">View data</summary>
        <div className="mt-2 max-h-48 overflow-y-auto">
          <table className="w-full tabular-nums">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">Day</th>
                <th className="py-1 text-right font-normal">Uploads</th>
                <th className="py-1 text-right font-normal">Approvals</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((p) => (
                <tr key={p.day} className="border-t">
                  <td className="py-1">{fmtDay(p.day)}</td>
                  <td className="py-1 text-right">{p.uploads}</td>
                  <td className="py-1 text-right">{p.approvals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
