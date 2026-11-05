"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { OptionSelect } from "@/components/option-select"
import type { SeriesPeriod, SeriesRow, TrackerView } from "@/lib/data/instances"
import { isClosed, isOverdue, STATUS_LABELS, type DocumentStatus } from "@/lib/documents"
import { semesterOfPeriod, shortPeriodLabel, type Semester } from "@/lib/periods"
import { RECURRENCE_LABELS } from "@/lib/templates"
import { cn } from "@/lib/utils"

type Props = {
  series: SeriesRow[]
  view: TrackerView
  startMonth: number
  today: string
  /** "H" for KPIs (H1 / H2 of the KPI year), "Semester" for templates. */
  periodWord?: "Semester" | "H"
  /** Column headings per interval (defaults to the template labels). */
  kindLabels?: Partial<Record<string, string>>
}

const KIND_ORDER = ["weekly", "monthly", "quarterly", "semester", "half_yearly", "academic_year"] as const

const CELL: Record<DocumentStatus | "overdue", { className: string; mark: string; label: string }> = {
  approved: { className: "bg-success text-white", mark: "✓", label: STATUS_LABELS.approved },
  in_review: { className: "bg-info text-white", mark: "…", label: STATUS_LABELS.in_review },
  pending_upload: { className: "bg-warning-soft text-warning-text ring-1 ring-warning-line ring-inset", mark: "", label: STATUS_LABELS.pending_upload },
  changes_requested: { className: "bg-danger-soft text-danger-text ring-1 ring-danger-line ring-inset", mark: "↺", label: STATUS_LABELS.changes_requested },
  not_applicable: { className: "bg-muted text-muted-foreground", mark: "–", label: STATUS_LABELS.not_applicable },
  overdue: { className: "bg-danger text-white", mark: "!", label: "Overdue" },
}

/** Grid of every recurring file × period, coloured by status. `view` decides how it is divided. */
export function ProgramTracker({ series, view, startMonth, today, periodWord = "Semester", kindLabels }: Props) {
  const placed = useMemo(
    () =>
      series.map((s) => ({
        series: s,
        periods: s.periods.map((p) => ({ ...p, semester: semesterOfPeriod(s.recurrence, p.start, startMonth, periodWord) })),
      })),
    [series, startMonth, periodWord]
  )

  const semesters = useMemo(() => {
    const all = new Map<string, Semester>()
    for (const s of placed) for (const p of s.periods) all.set(p.semester.key, p.semester)
    return [...all.values()].sort((a, b) => a.key.localeCompare(b.key))
  }, [placed])

  const sections = view.kind === "sections" ? view.sections : []
  const options = view.kind === "all" ? [] : view.kind === "sections" ? sections.map((s) => ({ value: s.key, label: s.label })) : semesters.map((s) => ({ value: s.key, label: s.label }))

  // What opens first: the section or half-year containing today, else the latest.
  const current = semesterOfPeriod("monthly", today, startMonth, periodWord).key
  const defaultKey =
    view.kind === "sections"
      ? (sections.find((s) => s.start && s.start <= today && (!s.end || today <= s.end)) ?? sections.findLast((s) => s.start) ?? sections[0])?.key
      : semesters.some((s) => s.key === current)
        ? current
        : semesters.at(-1)?.key
  const [picked, setPicked] = useState<string | null>(null)
  const selected = options.some((o) => o.value === picked) ? picked : (defaultKey ?? null)

  const sem = semesters.find((s) => s.key === selected)
  const section = sections.find((s) => s.key === selected)

  if (!placed.some((s) => s.periods.length > 0)) {
    return <p className="text-sm text-muted-foreground">No recurring requirements have been created yet.</p>
  }

  // Yearly items belong to both semesters of their academic year.
  const inSemester = (recurrence: string, p: (typeof placed)[number]["periods"][number]) =>
    recurrence === "academic_year" ? p.semester.academicYear === sem?.academicYear : p.semester.key === sem?.key
  const inView = (recurrence: string, p: (typeof placed)[number]["periods"][number]) => view.kind !== "calendar" || inSemester(recurrence, p)
  const seriesShown = (s: SeriesRow) => view.kind !== "sections" || (s.instanceId !== null && Boolean(section?.instanceIds.includes(s.instanceId)))

  const groups = KIND_ORDER.map((kind) => {
    const rows = placed
      .filter((s) => s.series.recurrence === kind && seriesShown(s.series))
      .map((s) => ({ series: s.series, periods: s.periods.filter((p) => inView(kind, p)) }))
    const columns = new Map<string, { key: string; start: string; label: string }>()
    for (const r of rows) for (const p of r.periods) columns.set(p.key, { key: p.key, start: p.start, label: p.label })
    return { kind, rows, columns: [...columns.values()].sort((a, b) => a.start.localeCompare(b.start)) }
  }).filter((g) => g.columns.length > 0)

  const cells = groups.flatMap((g) => g.rows.flatMap((r) => r.periods))
  const done = cells.filter((c) => isClosed(c.status)).length
  const overdue = cells.filter((c) => isOverdue(c.status, c.dueDate, today)).length
  const percent = cells.length ? Math.round((done / cells.length) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {options.length > 0 && <OptionSelect aria-label="Show" value={selected} onChange={setPicked} options={options} className="w-56" />}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            <span className="font-semibold tabular-nums">{percent}%</span> complete
          </span>
          <span className="text-muted-foreground tabular-nums">
            {done} of {cells.length} done
          </span>
          {overdue > 0 && <Badge variant="destructive">{overdue} overdue</Badge>}
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-success" style={{ width: `${percent}%` }} />
      </div>

      {groups.map((g) => (
        <div key={g.kind} className="space-y-1.5">
          <h3 className="section-label">{kindLabels?.[g.kind] ?? RECURRENCE_LABELS[g.kind]}</h3>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="sticky left-0 z-10 min-w-48 bg-muted/30 px-3 py-2 text-left font-medium backdrop-blur">File</th>
                  {g.columns.map((c) => (
                    <th key={c.key} className="px-1 py-2 text-center text-xs font-medium whitespace-nowrap text-muted-foreground" title={c.label}>
                      {shortPeriodLabel(g.kind, c.key, c.start)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => {
                  const byKey = new Map(r.periods.map((p) => [p.key, p]))
                  return (
                    <tr key={r.series.id} className="border-b last:border-0">
                      <td className="sticky left-0 z-10 bg-card px-3 py-1.5">
                        <div className="font-medium">{r.series.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.series.folder.name} · {r.series.uploader.fullName}
                        </div>
                      </td>
                      {g.columns.map((c) => (
                        <td key={c.key} className="px-1 py-1.5 text-center">
                          <Cell period={byKey.get(c.key)} today={today} />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(["approved", "in_review", "pending_upload", "changes_requested", "overdue", "not_applicable"] as const).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className={cn("flex size-4 items-center justify-center rounded text-[10px] font-semibold", CELL[k].className)}>{CELL[k].mark}</span>
            {CELL[k].label}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Cell({ period, today }: { period: SeriesPeriod | undefined; today: string }) {
  if (!period) return <span className="mx-auto block size-6 rounded border border-dashed" title="Not created" />
  const style = CELL[isOverdue(period.status, period.dueDate, today) ? "overdue" : period.status]
  return (
    <Link
      href={`/documents/${period.documentId}`}
      title={`${period.label} · ${style.label}`}
      className={cn(
        "mx-auto flex size-6 items-center justify-center rounded text-xs font-semibold transition-transform hover:scale-110",
        style.className
      )}
    >
      {style.mark}
    </Link>
  )
}
