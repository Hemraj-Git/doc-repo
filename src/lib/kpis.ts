// Client-safe KPI constants.
import type { ReviewerRule } from "@/lib/templates"

export type KpiRecurrence = "once" | "monthly" | "quarterly" | "half_yearly" | "academic_year"
export type KpiReviewerRule = Exclude<ReviewerRule, "slot_owner_manager">
export type KpiEntryStatus = "open" | "submitted" | "changes_requested" | "approved" | "scored" | "not_applicable"

/** Area intervals ("academic_year" follows the KPI's own year). */
export const KPI_RECURRENCE_LABELS: Record<KpiRecurrence, string> = {
  once: "Once",
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-yearly",
  academic_year: "Annually",
}

export const KPI_REVIEWER_LABELS: Record<KpiReviewerRule, string> = {
  uploader_manager: "Their reporting manager",
  department_head: "Head of their department",
  fixed: "A specific person",
}

/** Departments whose head can be chosen as a KPI's scorer: HR and Quality. */
export const KPI_SCORER_DEPARTMENT_CODES = ["HR", "QA"]
/** The scorer form value for "a specific person"; otherwise it holds a department id. */
export const KPI_SCORER_PERSON = "person"

export const YEAR_PRESETS = [
  { month: 4, label: "Financial year (April – March)" },
  { month: 7, label: "Academic year (July – June)" },
  { month: 1, label: "Calendar year (January – December)" },
]

export const MAX_ENTRY_FILES = 10
/** What the scorer gives each period. Area scores average these; the KPI result is out of 100. */
export const SCORE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

/** For display. kpi_score_rating() in the database decides the rating. */
export const KPI_RATING_BANDS = [
  { range: "85–100", label: "Outstanding", className: "border-emerald-600/30 bg-emerald-50 text-emerald-800" },
  { range: "75–84", label: "Very Good", className: "border-teal-600/30 bg-teal-50 text-teal-800" },
  { range: "65–74", label: "Satisfactory", className: "border-sky-600/30 bg-sky-50 text-sky-800" },
  { range: "50–64", label: "Improvement Required", className: "border-amber-600/30 bg-amber-50 text-amber-800" },
  { range: "Below 50", label: "Unsatisfactory", className: "border-rose-600/30 bg-rose-50 text-rose-800" },
] as const

export const ratingClass = (rating: string | null | undefined) => KPI_RATING_BANDS.find((b) => b.label === rating)?.className ?? ""

/** Shown wherever the Projected Score appears. */
export const PROJECTED_SCORE_HINT = "Based on periods scored so far. The Final Score is generated once the KPI year is over and every period is decided."

/** An Area score: the average of its periods, out of 10. */
export const formatScore = (score: number | null | undefined) => (score == null ? "—" : score.toFixed(2))

/** The Projected or Final Score: a whole number out of 100. */
export const formatKpiScore = (score: number | null | undefined) => (score == null ? "—" : String(Math.round(score)))

/** Example period name for an interval, for a year starting in the given month. */
export function kpiPeriodExample(recurrence: KpiRecurrence, startMonth: number) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const m = (offset: number) => months[(startMonth - 1 + offset) % 12]!
  const year = startMonth === 1 ? "2026" : "2026–27"
  switch (recurrence) {
    case "once":
      return "one entry for the whole KPI period"
    case "monthly":
      return `a new entry every month, e.g. ${months[startMonth - 1]} 2026`
    case "quarterly":
      return `a new entry every quarter, e.g. Q1 ${year} (${m(0)}–${m(2)})`
    case "half_yearly":
      return `a new entry every six months, e.g. H1 ${year} (${m(0)}–${m(5)})`
    case "academic_year":
      return `one entry per KPI year, e.g. ${year}`
  }
}

/** The KPI year containing a date: e.g. 1 Apr 2026 – 31 Mar 2027 for an April start. */
export function kpiYearOf(date: string, startMonth: number) {
  const pad = (n: number) => String(n).padStart(2, "0")
  const [y, m] = date.split("-").map(Number) as [number, number]
  const startYear = m < startMonth ? y - 1 : y
  const endMonth = startMonth === 1 ? 12 : startMonth - 1
  const endYear = startMonth === 1 ? startYear : startYear + 1
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate()
  return { start: `${startYear}-${pad(startMonth)}-01`, end: `${endYear}-${pad(endMonth)}-${pad(lastDay)}` }
}

/** What a period's status means to read: an open period past its due date is overdue. */
export function entryStatusLabel(status: KpiEntryStatus, dueDate: string, today: string) {
  switch (status) {
    case "open":
      return dueDate < today ? "Overdue" : "To fill in"
    case "submitted":
      return "Waiting for approval"
    case "changes_requested":
      return "Sent back"
    case "approved":
      return "Waiting for score"
    case "scored":
      return "Scored"
    case "not_applicable":
      return "Not applicable"
  }
}

export function entryStatusClass(status: KpiEntryStatus, dueDate: string, today: string) {
  if (status === "open" || status === "changes_requested") {
    if (dueDate < today) return "border-rose-600/30 bg-rose-50 text-rose-800"
    return status === "open" ? "border-amber-600/30 bg-amber-50 text-amber-800" : "border-rose-600/30 bg-rose-50 text-rose-800"
  }
  if (status === "submitted") return "border-sky-600/30 bg-sky-50 text-sky-800"
  if (status === "approved") return "border-indigo-600/30 bg-indigo-50 text-indigo-800"
  if (status === "scored") return "border-emerald-600/30 bg-emerald-50 text-emerald-800"
  return "text-muted-foreground"
}
