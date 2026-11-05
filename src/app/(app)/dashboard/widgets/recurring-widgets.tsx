import Link from "next/link"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import type { Compliance } from "@/lib/data/insights"
import type { SchedulerRun } from "@/lib/data/scheduler"
import { formatDateTime } from "@/lib/format"

function Meter({ label, value }: { label: string; value: Compliance }) {
  const percent = value.total ? Math.round((value.done / value.total) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {value.total ? `${value.done}/${value.total} done${value.inReview ? ` · ${value.inReview} in review` : ""}` : "None due"}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

export function RecurringCompliance({ data }: { data: { week: Compliance; month: Compliance; overdue: number } }) {
  return (
    <div className="space-y-3">
      <Meter label="This week" value={data.week} />
      <Meter label="This month" value={data.month} />
      <Link href="/requirements" className={`block text-sm ${data.overdue ? "font-medium text-destructive" : "text-muted-foreground"} hover:underline`}>
        {data.overdue ? `${data.overdue} recurring file${data.overdue === 1 ? " is" : "s are"} overdue` : "Nothing overdue"}
      </Link>
    </div>
  )
}

export function SchedulerHealth({ run, stale }: { run: SchedulerRun | null; stale: boolean }) {
  const ok = run && !stale && run.errorCount === 0
  return (
    <div className="space-y-2 text-sm">
      <p className={`flex items-center gap-1.5 font-medium ${ok ? "text-emerald-700" : "text-amber-700"}`}>
        {ok ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
        {!run ? "Not run yet" : stale ? "Missed its daily run" : run.errorCount ? `${run.errorCount} series failed` : "Running normally"}
      </p>
      {run && (
        <p className="text-muted-foreground">
          Last run {formatDateTime(run.startedAt)} · {run.createdCount} created · {run.seriesChecked} series
        </p>
      )}
      <Link href="/admin/templates" className="text-primary hover:underline">
        Open templates
      </Link>
    </div>
  )
}
