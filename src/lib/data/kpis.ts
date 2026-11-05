import "server-only"
import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import type { FileFormat } from "@/lib/files"
import { KPI_SCORER_DEPARTMENT_CODES, type KpiEntryStatus, type KpiRecurrence, type KpiReviewerRule } from "@/lib/kpis"

// -----------------------------------------------------------------------------
// Library
// -----------------------------------------------------------------------------

export type KpiSummary = {
  id: string
  name: string
  designation: string | null
  yearStartMonth: number
  isActive: boolean
  version: number
  areaCount: number
  totalWeightage: number
  activeAssignments: number
  updatedAt: string
}

export async function listKpis(): Promise<KpiSummary[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("kpis")
    .select("id, name, designation, year_start_month, is_active, version, updated_at, areas:kpi_areas(weightage), assignments:kpi_assignments(status)")
    .order("name")
  if (error) throw new Error(`Could not load KPIs: ${error.message}`)
  return ((data ?? []) as unknown as {
    id: string
    name: string
    designation: string | null
    year_start_month: number
    is_active: boolean
    version: number
    updated_at: string
    areas: { weightage: number }[]
    assignments: { status: string }[]
  }[]).map((k) => ({
    id: k.id,
    name: k.name,
    designation: k.designation,
    yearStartMonth: k.year_start_month,
    isActive: k.is_active,
    version: k.version,
    areaCount: k.areas.length,
    totalWeightage: k.areas.reduce((sum, a) => sum + Number(a.weightage), 0),
    activeAssignments: k.assignments.filter((a) => a.status === "active").length,
    updatedAt: k.updated_at,
  }))
}

export type KpiArea = {
  id: string
  name: string
  weightage: number
  description: string | null
  recurrence: KpiRecurrence
  sortOrder: number
}

export type Kpi = {
  id: string
  name: string
  designation: string | null
  description: string | null
  yearStartMonth: number
  reviewerRule: KpiReviewerRule
  reviewerUserId: string | null
  /** The scorer: the head of this department, or this person. Neither on KPIs not yet set up. */
  scorerDepartment: { id: string; name: string } | null
  scorerUserId: string | null
  dueDays: number
  isActive: boolean
  version: number
  updatedAt: string
  areas: KpiArea[]
}

export const getKpi = cache(async (id: string): Promise<Kpi | null> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from("kpis")
    .select(
      "id, name, designation, description, year_start_month, reviewer_rule, reviewer_user_id, scorer_user_id, scorer_department:departments!kpis_scorer_department_id_fkey(id, name), due_days, is_active, version, updated_at, areas:kpi_areas(id, name, weightage, description, recurrence, sort_order)"
    )
    .eq("id", id)
    .maybeSingle()
  if (!data) return null
  const k = data as unknown as {
    id: string
    name: string
    designation: string | null
    description: string | null
    year_start_month: number
    reviewer_rule: KpiReviewerRule
    reviewer_user_id: string | null
    scorer_user_id: string | null
    scorer_department: { id: string; name: string } | null
    due_days: number
    is_active: boolean
    version: number
    updated_at: string
    areas: { id: string; name: string; weightage: number; description: string | null; recurrence: KpiRecurrence; sort_order: number }[]
  }
  return {
    id: k.id,
    name: k.name,
    designation: k.designation,
    description: k.description,
    yearStartMonth: k.year_start_month,
    reviewerRule: k.reviewer_rule,
    reviewerUserId: k.reviewer_user_id,
    scorerDepartment: k.scorer_department,
    scorerUserId: k.scorer_user_id,
    dueDays: k.due_days,
    isActive: k.is_active,
    version: k.version,
    updatedAt: k.updated_at,
    areas: k.areas
      .map((a) => ({
        id: a.id,
        name: a.name,
        weightage: Number(a.weightage),
        description: a.description,
        recurrence: a.recurrence,
        sortOrder: a.sort_order,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
  }
})

/** Departments whose head can be a KPI's scorer. */
export async function listKpiScorerDepartments(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("departments").select("id, name").in("code", KPI_SCORER_DEPARTMENT_CODES).eq("is_active", true).order("name")
  if (error) throw new Error(`Could not load departments: ${error.message}`)
  return (data ?? []) as { id: string; name: string }[]
}

export async function listDesignations(): Promise<{ designation: string; people: number }[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("designations_in_use")
  return ((data ?? []) as { designation: string; people: number }[]).map((d) => ({ designation: d.designation, people: Number(d.people) }))
}

export type AssignablePerson = {
  id: string
  fullName: string
  designation: string | null
  department: { id: string; code: string; name: string }
}

/** Active users (the page narrows them to the departments the user may assign in). */
export async function listAssignablePeople(): Promise<AssignablePerson[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, designation, department:departments!profiles_department_id_fkey(id, code, name)")
    .eq("is_active", true)
    .order("full_name")
    .limit(5000)
  if (error) throw new Error(`Could not load people: ${error.message}`)
  return ((data ?? []) as unknown as { id: string; full_name: string; designation: string | null; department: AssignablePerson["department"] }[]).map(
    (p) => ({ id: p.id, fullName: p.full_name, designation: p.designation, department: p.department })
  )
}

// -----------------------------------------------------------------------------
// Assignments and scores
// -----------------------------------------------------------------------------

export type AreaScore = { score: number | null; total: number; scored: number; overdue: number; submitted: number; approved: number; notApplicable: number }

/**
 * Scores come from RLS-protected tables, so before release the assigned person
 * gets nulls here whatever the UI does.
 */
export type AssignmentSummary = {
  total: number
  openPeriods: number
  overdue: number
  /** Waiting for the reviewer's approval. */
  submitted: number
  /** Approved or forwarded: waiting for the scorer. */
  approved: number
  scored: number
  notApplicable: number
  undecided: number
  projectedScore: number | null
  finalScore: number | null
  finalRating: string | null
  finalGeneratedAt: string | null
  areas: Record<string, AreaScore>
}

export type AssignmentRow = {
  id: string
  kpiId: string | null
  kpiName: string
  kpiVersion: number
  startDate: string
  endDate: string
  status: "active" | "ended"
  createdAt: string
  user: { id: string; fullName: string; designation: string | null }
  department: { id: string; code: string; name: string }
  assignedBy: string | null
  reviewer: { id: string; fullName: string } | null
  scorer: { id: string; fullName: string } | null
  scoresReleasedAt: string | null
  summary: AssignmentSummary
}

type AssignmentDb = {
  id: string
  kpi_id: string | null
  kpi_name: string
  kpi_version: number
  start_date: string
  end_date: string
  status: "active" | "ended"
  created_at: string
  scores_released_at: string | null
  user: { id: string; full_name: string; designation: string | null }
  department: { id: string; code: string; name: string }
  assigner: { full_name: string } | null
  reviewer: { id: string; full_name: string } | null
  scorer: { id: string; full_name: string } | null
}

const ASSIGNMENT_COLUMNS =
  "id, kpi_id, kpi_name, kpi_version, start_date, end_date, status, created_at, scores_released_at, user:profiles!kpi_assignments_user_id_fkey(id, full_name, designation), department:departments(id, code, name), assigner:profiles!kpi_assignments_assigned_by_fkey(full_name), reviewer:profiles!kpi_assignments_reviewer_id_fkey(id, full_name), scorer:profiles!kpi_assignments_scorer_id_fkey(id, full_name)"

const EMPTY_SUMMARY: AssignmentSummary = {
  total: 0,
  openPeriods: 0,
  overdue: 0,
  submitted: 0,
  approved: 0,
  scored: 0,
  notApplicable: 0,
  undecided: 0,
  projectedScore: null,
  finalScore: null,
  finalRating: null,
  finalGeneratedAt: null,
  areas: {},
}

const toNumber = (v: unknown) => (v === null || v === undefined ? null : Number(v))

type SummaryDb = {
  assignment_id: string
  total: number
  open_periods: number
  overdue: number
  submitted: number
  approved: number
  scored: number
  not_applicable: number
  undecided: number
  projected_score: number | null
  final_score: number | null
  final_rating: string | null
  final_generated_at: string | null
  areas: { id: string; score: number | null; total: number; scored: number; overdue: number; submitted: number; approved: number; not_applicable: number }[]
}

async function summaries(ids: string[]) {
  const out = new Map<string, AssignmentSummary>()
  if (ids.length === 0) return out
  const supabase = await createClient()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.rpc("kpi_assignment_results", { p_ids: ids.slice(i, i + 200) })
    if (error) throw new Error(`Could not load KPI scores: ${error.message}`)
    for (const r of (data ?? []) as SummaryDb[]) {
      out.set(r.assignment_id, {
        total: Number(r.total),
        openPeriods: Number(r.open_periods),
        overdue: Number(r.overdue),
        submitted: Number(r.submitted),
        approved: Number(r.approved),
        scored: Number(r.scored),
        notApplicable: Number(r.not_applicable),
        undecided: Number(r.undecided),
        projectedScore: toNumber(r.projected_score),
        finalScore: toNumber(r.final_score),
        finalRating: r.final_rating,
        finalGeneratedAt: r.final_generated_at,
        areas: Object.fromEntries(
          r.areas.map((a) => [
            a.id,
            {
              score: toNumber(a.score),
              total: Number(a.total),
              scored: Number(a.scored),
              overdue: Number(a.overdue),
              submitted: Number(a.submitted),
              approved: Number(a.approved),
              notApplicable: Number(a.not_applicable),
            },
          ])
        ),
      })
    }
  }
  return out
}

function toAssignment(a: AssignmentDb, summary: AssignmentSummary | undefined): AssignmentRow {
  return {
    id: a.id,
    kpiId: a.kpi_id,
    kpiName: a.kpi_name,
    kpiVersion: a.kpi_version,
    startDate: a.start_date,
    endDate: a.end_date,
    status: a.status,
    createdAt: a.created_at,
    user: { id: a.user.id, fullName: a.user.full_name, designation: a.user.designation },
    department: a.department,
    assignedBy: a.assigner?.full_name ?? null,
    reviewer: a.reviewer ? { id: a.reviewer.id, fullName: a.reviewer.full_name } : null,
    scorer: a.scorer ? { id: a.scorer.id, fullName: a.scorer.full_name } : null,
    scoresReleasedAt: a.scores_released_at,
    summary: summary ?? EMPTY_SUMMARY,
  }
}

export type AssignmentFilters = { kpiId?: string; departmentId?: string; status?: "active" | "ended"; q?: string; designation?: string }

/** Assignments the user may see (RLS decides), with their scores. */
export async function listAssignments(filters: AssignmentFilters = {}): Promise<AssignmentRow[]> {
  const supabase = await createClient()
  let q = supabase.from("kpi_assignments").select(ASSIGNMENT_COLUMNS)
  if (filters.kpiId) q = q.eq("kpi_id", filters.kpiId)
  if (filters.departmentId) q = q.eq("department_id", filters.departmentId)
  if (filters.status) q = q.eq("status", filters.status)
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1000)
  if (error) throw new Error(`Could not load KPI assignments: ${error.message}`)
  let rows = (data ?? []) as unknown as AssignmentDb[]
  const term = filters.q?.trim().toLowerCase()
  if (term) rows = rows.filter((r) => r.user.full_name.toLowerCase().includes(term) || r.kpi_name.toLowerCase().includes(term))
  if (filters.designation) rows = rows.filter((r) => (r.user.designation ?? "").trim() === filters.designation)
  const sums = await summaries(rows.map((r) => r.id))
  return rows.map((r) => toAssignment(r, sums.get(r.id)))
}

export async function listMyAssignments(userId: string): Promise<AssignmentRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("kpi_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("user_id", userId)
    .order("status")
    .order("start_date", { ascending: false })
  if (error) throw new Error(`Could not load your KPIs: ${error.message}`)
  const rows = (data ?? []) as unknown as AssignmentDb[]
  const sums = await summaries(rows.map((r) => r.id))
  return rows.map((r) => toAssignment(r, sums.get(r.id)))
}

export type EntryFile = {
  id: string
  source: "upload" | "repository"
  fileName: string
  fileFormat: FileFormat
  sizeBytes: number
  documentId: string | null
}

export type KpiEntry = {
  id: string
  areaId: string
  periodLabel: string
  periodStart: string
  periodEnd: string
  dueDate: string
  status: KpiEntryStatus
  details: string | null
  submittedAt: string | null
  submittedLate: boolean
  returnedComment: string | null
  notApplicableReason: string | null
  /** The reviewer's decision that sent this period to the scorer. */
  approval: { by: string | null; at: string; comment: string | null } | null
  files: EntryFile[]
  /** Null while hidden from this viewer, or not yet scored. */
  score: { value: number; comment: string | null; by: string | null; at: string } | null
}

export type AssignmentArea = {
  id: string
  name: string
  weightage: number
  description: string | null
  recurrence: KpiRecurrence | null
  /** Average of the scored periods; null until scored or while hidden. */
  score: number | null
  entries: KpiEntry[]
}

export type AssignmentDetail = AssignmentRow & {
  yearStartMonth: number
  latestKpiVersion: number | null
  areas: AssignmentArea[]
}

type EntryDb = {
  id: string
  assignment_area_id: string
  period_label: string
  period_start: string
  period_end: string
  due_date: string
  status: KpiEntryStatus
  details: string | null
  submitted_at: string | null
  submitted_late: boolean
  returned_comment: string | null
  not_applicable_reason: string | null
  approved_at: string | null
  approval_comment: string | null
  approver: { full_name: string } | null
  files: { id: string; source: "upload" | "repository"; original_filename: string; file_format: FileFormat; size_bytes: number; document_id: string | null }[]
}

export const getAssignment = cache(async (id: string): Promise<AssignmentDetail | null> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from("kpi_assignments")
    .select(`${ASSIGNMENT_COLUMNS}, year_start_month, kpi:kpis(version), areas:kpi_assignment_areas(id, name, weightage, description, recurrence, sort_order)`)
    .eq("id", id)
    .maybeSingle()
  if (!data) return null
  const a = data as unknown as AssignmentDb & {
    year_start_month: number
    kpi: { version: number } | null
    areas: { id: string; name: string; weightage: number; description: string | null; recurrence: KpiRecurrence | null; sort_order: number }[]
  }
  const [sums, entriesRes, scoresRes] = await Promise.all([
    summaries([id]),
    supabase
      .from("kpi_entries")
      .select(
        "id, assignment_area_id, period_label, period_start, period_end, due_date, status, details, submitted_at, submitted_late, returned_comment, not_applicable_reason, approved_at, approval_comment, approver:profiles!kpi_entries_approved_by_fkey(full_name), files:kpi_entry_files(id, source, original_filename, file_format, size_bytes, document_id)"
      )
      .eq("assignment_id", id)
      .order("period_start"),
    supabase
      .from("kpi_entry_scores")
      .select("entry_id, score, comment, scored_at, scorer:profiles!kpi_entry_scores_scored_by_fkey(full_name)")
      .eq("assignment_id", id),
  ])
  if (entriesRes.error) throw new Error(`Could not load KPI periods: ${entriesRes.error.message}`)
  if (scoresRes.error) throw new Error(`Could not load KPI scores: ${scoresRes.error.message}`)

  const summary = sums.get(id)
  const scoreByEntry = new Map(
    ((scoresRes.data ?? []) as unknown as { entry_id: string; score: number; comment: string | null; scored_at: string; scorer: { full_name: string } | null }[]).map(
      (s) => [s.entry_id, { value: s.score, comment: s.comment, by: s.scorer?.full_name ?? null, at: s.scored_at }]
    )
  )
  const entries: KpiEntry[] = ((entriesRes.data ?? []) as unknown as EntryDb[]).map((e) => ({
    id: e.id,
    areaId: e.assignment_area_id,
    periodLabel: e.period_label,
    periodStart: e.period_start,
    periodEnd: e.period_end,
    dueDate: e.due_date,
    status: e.status,
    details: e.details,
    submittedAt: e.submitted_at,
    submittedLate: e.submitted_late,
    returnedComment: e.returned_comment,
    notApplicableReason: e.not_applicable_reason,
    approval: e.approved_at ? { by: e.approver?.full_name ?? null, at: e.approved_at, comment: e.approval_comment } : null,
    files: e.files.map((f) => ({
      id: f.id,
      source: f.source,
      fileName: f.original_filename,
      fileFormat: f.file_format,
      sizeBytes: Number(f.size_bytes),
      documentId: f.document_id,
    })),
    score: scoreByEntry.get(e.id) ?? null,
  }))

  return {
    ...toAssignment(a, summary),
    yearStartMonth: a.year_start_month,
    latestKpiVersion: a.kpi?.version ?? null,
    areas: a.areas
      .sort((x, y) => x.sort_order - y.sort_order || x.name.localeCompare(y.name))
      .map((ar) => ({
        id: ar.id,
        name: ar.name,
        weightage: Number(ar.weightage),
        description: ar.description,
        recurrence: ar.recurrence,
        score: summary?.areas[ar.id]?.score ?? null,
        entries: entries.filter((e) => e.areaId === ar.id),
      })),
  }
})

export type EvidenceFile = {
  id: string
  assignmentId: string
  fileName: string
  sizeBytes: number
  fileFormat: FileFormat
  source: "upload" | "repository"
  areaName: string
  periodLabel: string
  kpiName: string
}

/** One attached file, for its preview page. RLS: only if the viewer can see the assignment. */
export async function getEvidenceFile(id: string): Promise<EvidenceFile | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("kpi_entry_files")
    .select(
      "id, assignment_id, original_filename, size_bytes, file_format, source, entry:kpi_entries(period_label, area:kpi_assignment_areas(name), assignment:kpi_assignments(kpi_name))"
    )
    .eq("id", id)
    .maybeSingle()
  if (!data) return null
  const f = data as unknown as {
    id: string
    assignment_id: string
    original_filename: string
    size_bytes: number
    file_format: FileFormat
    source: "upload" | "repository"
    entry: { period_label: string; area: { name: string }; assignment: { kpi_name: string } }
  }
  return {
    id: f.id,
    assignmentId: f.assignment_id,
    fileName: f.original_filename,
    sizeBytes: Number(f.size_bytes),
    fileFormat: f.file_format,
    source: f.source,
    areaName: f.entry.area.name,
    periodLabel: f.entry.period_label,
    kpiName: f.entry.assignment.kpi_name,
  }
}

// -----------------------------------------------------------------------------
// Tasks
// -----------------------------------------------------------------------------

export type KpiTask = {
  assignmentId: string
  kpiName: string
  person: string
  periods: number
  overdue: number
  /** Reviewer and scorer tasks: periods with nothing submitted. */
  missed: number
  nextDue: string | null
}

type TaskEntryDb = {
  status: KpiEntryStatus
  due_date: string
  submitted_at: string | null
  assignment: { id: string; kpi_name: string; status: string; user: { full_name: string } }
}

function groupTasks(rows: TaskEntryDb[], today: string): KpiTask[] {
  const by = new Map<string, KpiTask>()
  for (const r of rows) {
    const t = by.get(r.assignment.id) ?? {
      assignmentId: r.assignment.id,
      kpiName: r.assignment.kpi_name,
      person: r.assignment.user.full_name,
      periods: 0,
      overdue: 0,
      missed: 0,
      nextDue: null,
    }
    t.periods++
    if ((r.status === "open" || r.status === "changes_requested") && r.due_date < today) t.overdue++
    if ((r.status === "open" && (r.due_date < today || r.assignment.status === "ended")) || (r.status === "approved" && !r.submitted_at)) t.missed++
    if (!t.nextDue || r.due_date < t.nextDue) t.nextDue = r.due_date
    by.set(r.assignment.id, t)
  }
  return [...by.values()].sort((a, b) => b.overdue - a.overdue || (a.nextDue ?? "").localeCompare(b.nextDue ?? ""))
}

const TASK_COLUMNS =
  "status, due_date, submitted_at, assignment:kpi_assignments!inner(id, kpi_name, status, user_id, reviewer_id, scorer_id, user:profiles!kpi_assignments_user_id_fkey(full_name))"

/** My KPIs with periods still to fill in. */
export async function listKpiFillTasks(userId: string, today: string): Promise<KpiTask[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("kpi_entries")
    .select(TASK_COLUMNS)
    .eq("assignment.user_id", userId)
    .eq("assignment.status", "active")
    .in("status", ["open", "changes_requested"])
    .limit(2000)
  if (error) throw new Error(`Could not load your KPIs: ${error.message}`)
  return groupTasks((data ?? []) as unknown as TaskEntryDb[], today)
}

/** KPIs waiting for my approval as reviewer: submitted periods, and missed ones that can now be decided. */
export async function listKpiReviewTasks(userId: string, today: string): Promise<KpiTask[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("kpi_entries")
    .select(TASK_COLUMNS)
    .eq("assignment.reviewer_id", userId)
    .in("status", ["submitted", "open", "changes_requested"])
    .limit(5000)
  if (error) throw new Error(`Could not load KPIs to review: ${error.message}`)
  const rows = ((data ?? []) as unknown as TaskEntryDb[]).filter(
    (r) => r.status === "submitted" || r.due_date < today || r.assignment.status === "ended"
  )
  return groupTasks(rows, today)
}

/** KPIs waiting for my score: periods the reviewer has approved or forwarded. */
export async function listKpiScoreTasks(userId: string, today: string): Promise<KpiTask[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("kpi_entries").select(TASK_COLUMNS).eq("assignment.scorer_id", userId).eq("status", "approved").limit(5000)
  if (error) throw new Error(`Could not load KPIs to score: ${error.message}`)
  return groupTasks((data ?? []) as unknown as TaskEntryDb[], today)
}

/** Dashboard: my periods overdue, due within a week, and open in total. */
export async function myKpiEntryCounts(userId: string, today: string, weekAhead: string) {
  const supabase = await createClient()
  const base = () =>
    supabase
      .from("kpi_entries")
      .select("id, assignment:kpi_assignments!inner(user_id, status)", { count: "exact", head: true })
      .eq("assignment.user_id", userId)
      .eq("assignment.status", "active")
      .in("status", ["open", "changes_requested"])
  const [open, overdue, dueSoon] = await Promise.all([base(), base().lt("due_date", today), base().gte("due_date", today).lte("due_date", weekAhead)])
  return { open: open.count ?? 0, overdue: overdue.count ?? 0, dueSoon: dueSoon.count ?? 0 }
}
