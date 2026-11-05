import "server-only"
import { createClient } from "@/lib/supabase/server"

export type SchedulerRun = {
  id: string
  trigger: "schedule" | "manual"
  runDate: string
  startedAt: string
  finishedAt: string | null
  seriesChecked: number
  createdCount: number
  errorCount: number
  errors: { series: string; instance: string; error: string }[]
  triggeredBy: string | null
}

type RunDb = {
  id: string
  trigger: SchedulerRun["trigger"]
  run_date: string
  started_at: string
  finished_at: string | null
  series_checked: number
  created_count: number
  error_count: number
  errors: SchedulerRun["errors"]
  by: { full_name: string } | null
}

/** Latest scheduler runs (visible to template managers only). */
export async function listSchedulerRuns(limit = 10): Promise<SchedulerRun[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("scheduler_runs")
    .select("id, trigger, run_date, started_at, finished_at, series_checked, created_count, error_count, errors, by:profiles(full_name)")
    .order("started_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Could not load scheduler runs: ${error.message}`)
  return ((data ?? []) as unknown as RunDb[]).map((r) => ({
    id: r.id,
    trigger: r.trigger,
    runDate: r.run_date,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    seriesChecked: r.series_checked,
    createdCount: r.created_count,
    errorCount: r.error_count,
    errors: r.errors ?? [],
    triggeredBy: r.by?.full_name ?? null,
  }))
}

/** The job runs at 00:15 every day; no scheduled run in ~26 hours means it missed one. */
export function schedulerIsStale(runs: SchedulerRun[]) {
  const lastScheduled = runs.find((r) => r.trigger === "schedule")
  return !lastScheduled || Date.now() - new Date(lastScheduled.startedAt).getTime() > 26 * 3_600_000
}
