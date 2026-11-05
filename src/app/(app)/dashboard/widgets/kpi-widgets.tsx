import Link from "next/link"

export function MyKpiEvidence({ data }: { data: { assignments: number; open: number; overdue: number; dueSoon: number } }) {
  const tiles = [
    { label: "Overdue", value: data.overdue, tone: data.overdue ? "text-destructive" : "" },
    { label: "Due in 7 days", value: data.dueSoon, tone: data.dueSoon ? "text-primary" : "" },
    { label: "Open in total", value: data.open, tone: "" },
  ]
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border bg-muted/20 p-2">
            <dt className="text-[11px] text-muted-foreground">{t.label}</dt>
            <dd className={`text-xl font-semibold tabular-nums ${t.tone}`}>{t.value}</dd>
          </div>
        ))}
      </dl>
      <Link href="/my-kpis" className="text-sm text-primary hover:underline">
        {data.assignments} active KPI{data.assignments === 1 ? "" : "s"} →
      </Link>
    </div>
  )
}

export function KpisToScore({ toReview, toScore }: { toReview: number; toScore: number }) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2">
        {[
          { label: "To approve", value: toReview },
          { label: "To score", value: toScore },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border bg-muted/20 p-2">
            <dt className="text-[11px] text-muted-foreground">{t.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{t.value}</dd>
          </div>
        ))}
      </dl>
      <Link href="/tasks" className="text-sm text-primary hover:underline">
        Open My Tasks →
      </Link>
    </div>
  )
}

export function KpiCompliance({ rows }: { rows: { department: string; assignments: number; overdue: number }[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No active KPI assignments.</p>
  return (
    <div className="space-y-2">
      <ul className="grid gap-1.5 text-sm">
        {rows.slice(0, 6).map((r) => (
          <li key={r.department} className="flex items-center justify-between gap-2">
            <span className="truncate">{r.department}</span>
            <span className="shrink-0 text-xs tabular-nums">
              <span className="text-muted-foreground">{r.assignments} assigned</span>
              {" · "}
              <span className={r.overdue ? "font-medium text-destructive" : "text-muted-foreground"}>{r.overdue} overdue</span>
            </span>
          </li>
        ))}
      </ul>
      <Link href="/kpis/assignments?status=active" className="text-sm text-primary hover:underline">
        Open KPI assignments →
      </Link>
    </div>
  )
}
