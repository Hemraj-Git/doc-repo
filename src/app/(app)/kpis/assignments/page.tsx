import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { hasPerm } from "@/lib/auth/permissions"
import { listAssignments, listKpis } from "@/lib/data/kpis"
import { listDepartments } from "@/lib/data/org"
import { todayIso } from "@/lib/format"
import { AssignmentsTable } from "./assignments-table"
import { AssignmentsToolbar } from "./assignments-toolbar"
import { parseAssignmentFilters } from "./filters"

export const metadata: Metadata = { title: "KPI assignments" }

export default async function AssignmentsPage({ searchParams }: PageProps<"/kpis/assignments">) {
  const ctx = await requireNavAccess("/kpis")
  const params = await searchParams
  const filters = parseAssignmentFilters((k) => (typeof params[k] === "string" ? (params[k] as string) : undefined))
  const [rows, kpis, departments] = await Promise.all([listAssignments(filters), listKpis(), listDepartments()])
  const designations = [...new Set(rows.map((r) => (r.user.designation ?? "").trim()).filter(Boolean))].sort()

  return (
    <>
      <Link href="/kpis" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> KPIs
      </Link>
      <PageHeader
        title="KPI assignments"
        description="Who has which KPI, for which year, and how they are scoring. The Projected Score uses the periods scored so far; the Final Score is generated once the year is over and every period is decided."
      />
      <AssignmentsToolbar
        kpis={kpis.map((k) => ({ value: k.id, label: k.name }))}
        departments={departments.filter((d) => d.isActive).map((d) => ({ value: d.id, label: d.name }))}
        designations={designations}
      />
      <AssignmentsTable
        rows={rows}
        canManage={hasPerm(ctx, "kpi.assign.own_dept", "kpi.assign.any_dept", "kpi.manage")}
        today={todayIso()}
      />
    </>
  )
}
