import type { AssignmentFilters } from "@/lib/data/kpis"

/** Filters from the URL, shared by the overview and its CSV export. */
export function parseAssignmentFilters(get: (k: string) => string | undefined): AssignmentFilters {
  const status = get("status")
  return {
    kpiId: get("kpi") || undefined,
    departmentId: get("dept") || undefined,
    designation: get("designation") || undefined,
    q: get("q") || undefined,
    status: status === "active" || status === "ended" ? status : undefined,
  }
}
