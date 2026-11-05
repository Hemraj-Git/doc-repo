import { NextResponse, type NextRequest } from "next/server"
import { seesKpiAdmin } from "@/lib/auth/permissions"
import { getAppContext } from "@/lib/auth/session"
import { listAssignments } from "@/lib/data/kpis"
import { formatDate, formatDateTime, todayIso } from "@/lib/format"
import { entryStatusLabel, type KpiEntryStatus } from "@/lib/kpis"
import { createClient } from "@/lib/supabase/server"
import { parseAssignmentFilters } from "../filters"

const PAGE = 1000
const MAX_ROWS = 50_000

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

type EntryDb = {
  id: string
  assignment_id: string
  assignment_area_id: string
  period_label: string
  due_date: string
  status: KpiEntryStatus
  details: string | null
  submitted_at: string | null
  submitted_late: boolean
  approved_at: string | null
  approver: { full_name: string } | null
  files: { original_filename: string }[]
  area: { name: string; weightage: number }
}

/** One row per period of the filtered assignments. RLS still applies, including hidden scores. */
export async function GET(request: NextRequest) {
  const ctx = await getAppContext()
  if (!ctx || !ctx.user.isActive) return new NextResponse("Not signed in", { status: 401 })
  if (!seesKpiAdmin(ctx)) return new NextResponse("Forbidden", { status: 403 })

  const filters = parseAssignmentFilters((k) => request.nextUrl.searchParams.get(k) ?? undefined)
  const assignments = await listAssignments(filters)
  const byId = new Map(assignments.map((a) => [a.id, a]))
  const supabase = await createClient()
  const today = todayIso()

  const entries: EntryDb[] = []
  const scores = new Map<string, { score: number; comment: string | null; by: string | null }>()
  const ids = assignments.map((a) => a.id)
  for (let i = 0; i < ids.length && entries.length < MAX_ROWS; i += 100) {
    const chunk = ids.slice(i, i + 100)
    for (let from = 0; entries.length < MAX_ROWS; from += PAGE) {
      const { data, error } = await supabase
        .from("kpi_entries")
        .select(
          "id, assignment_id, assignment_area_id, period_label, due_date, status, details, submitted_at, submitted_late, approved_at, approver:profiles!kpi_entries_approved_by_fkey(full_name), files:kpi_entry_files(original_filename), area:kpi_assignment_areas(name, weightage)"
        )
        .in("assignment_id", chunk)
        .order("assignment_id")
        .order("period_start")
        .range(from, from + PAGE - 1)
      if (error) return new NextResponse(`Could not export: ${error.message}`, { status: 500 })
      const page = (data ?? []) as unknown as EntryDb[]
      entries.push(...page)
      if (page.length < PAGE) break
    }
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("kpi_entry_scores")
        .select("entry_id, score, comment, scorer:profiles!kpi_entry_scores_scored_by_fkey(full_name)")
        .in("assignment_id", chunk)
        .range(from, from + PAGE - 1)
      if (error) return new NextResponse(`Could not export: ${error.message}`, { status: 500 })
      const page = (data ?? []) as unknown as { entry_id: string; score: number; comment: string | null; scorer: { full_name: string } | null }[]
      for (const r of page) scores.set(r.entry_id, { score: r.score, comment: r.comment, by: r.scorer?.full_name ?? null })
      if (page.length < PAGE) break
    }
  }

  const header = [
    "Person",
    "Designation",
    "Department",
    "KPI",
    "KPI period",
    "Reviewer",
    "Scorer",
    "Area",
    "Area weightage %",
    "Period",
    "Status",
    "Due",
    "Submitted",
    "Late",
    "Details",
    "Files",
    "Approved by",
    "Approved on",
    "Score (1-10)",
    "Comment",
    "Scored by",
    "Area score (out of 10)",
    "Score type",
    "KPI score (out of 100)",
    "Final rating",
    "Scores released",
  ]
  const lines = [header.join(",")]
  for (const e of entries) {
    const a = byId.get(e.assignment_id)
    if (!a) continue
    const score = scores.get(e.id)
    const final = a.summary.finalScore !== null
    lines.push(
      [
        a.user.fullName,
        a.user.designation,
        a.department.name,
        a.kpiName,
        `${formatDate(a.startDate)} – ${formatDate(a.endDate)}`,
        a.reviewer?.fullName,
        a.scorer?.fullName,
        e.area.name,
        e.area.weightage,
        e.period_label,
        entryStatusLabel(e.status, e.due_date, today),
        formatDate(e.due_date),
        e.submitted_at ? formatDateTime(e.submitted_at) : "",
        e.submitted_late ? "Yes" : "",
        e.details,
        e.files.map((f) => f.original_filename).join("; "),
        e.approver?.full_name,
        e.approved_at ? formatDateTime(e.approved_at) : "",
        score?.score,
        score?.comment,
        score?.by,
        a.summary.areas[e.assignment_area_id]?.score,
        final ? "Final" : "Projected",
        final ? a.summary.finalScore : a.summary.projectedScore,
        a.summary.finalRating,
        a.scoresReleasedAt ? "Yes" : "No",
      ]
        .map(csvCell)
        .join(",")
    )
  }

  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(`﻿${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kpi-scores-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  })
}
