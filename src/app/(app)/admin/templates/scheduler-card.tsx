"use client"

import { useState, useTransition } from "react"
import { AlertTriangle, CalendarClock, ChevronDown, Loader2, Play } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { SchedulerRun } from "@/lib/data/scheduler"
import { formatDateTime } from "@/lib/format"
import { runSchedulerNow } from "./actions"

/** Status of the daily job that creates each period's requirements, with "Run now". */
export function SchedulerCard({ runs, stale }: { runs: SchedulerRun[]; stale: boolean }) {
  const [pending, startTransition] = useTransition()
  const [showErrors, setShowErrors] = useState(false)
  const last = runs[0]

  const run = () =>
    startTransition(async () => {
      const result = await runSchedulerNow()
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const { created, errors } = result.data
      if (errors) toast.warning(`Created ${created} requirement${created === 1 ? "" : "s"}; ${errors} series failed.`)
      else toast.success(created ? `Created ${created} requirement${created === 1 ? "" : "s"}.` : "Everything is up to date.")
    })

  return (
    <section className="mb-6 rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CalendarClock className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 className="font-medium">Recurring requirements scheduler</h2>
          <p className="text-sm text-muted-foreground">
            Runs every day at 00:15 and creates each new week’s, month’s, semester’s or year’s requirements.
          </p>
          <p className="text-sm">
            {last ? (
              <>
                Last run {formatDateTime(last.startedAt)}
                {last.trigger === "manual" ? ` (Run now${last.triggeredBy ? ` by ${last.triggeredBy}` : ""})` : ""} ·{" "}
                <span className="tabular-nums">{last.createdCount}</span> created ·{" "}
                <span className="tabular-nums">{last.seriesChecked}</span> series checked
                {last.errorCount > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    {last.errorCount} failed
                  </Badge>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">Not run yet.</span>
            )}
          </p>
          {stale && runs.length > 0 && (
            <p className="flex items-center gap-1.5 text-sm text-warning-text">
              <AlertTriangle className="size-4" /> The daily run has not happened in the last day. Check the pg_cron job.
            </p>
          )}
        </div>
        <Button variant="outline" onClick={run} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Play />}
          Run now
        </Button>
      </div>

      {last && last.errors.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <button
            type="button"
            className="flex items-center gap-1 text-sm font-medium text-destructive"
            onClick={() => setShowErrors((v) => !v)}
          >
            <ChevronDown className={`size-4 transition-transform ${showErrors ? "" : "-rotate-90"}`} />
            What failed
          </button>
          {showErrors && (
            <ul className="mt-2 space-y-1 text-sm">
              {last.errors.map((e, i) => (
                <li key={i}>
                  <span className="font-medium">
                    {e.series} · {e.instance}
                  </span>
                  : <span className="text-muted-foreground">{e.error}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
