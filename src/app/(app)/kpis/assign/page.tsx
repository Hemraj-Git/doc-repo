import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { hasPerm } from "@/lib/auth/permissions"
import { getKpi, listAssignablePeople, listAssignments, listKpis } from "@/lib/data/kpis"
import { listPeoplePicker } from "@/lib/data/org"
import { todayIso } from "@/lib/format"
import { AssignForm } from "./assign-form"

export const metadata: Metadata = { title: "Assign KPI" }

export default async function AssignPage({ searchParams }: PageProps<"/kpis/assign">) {
  const ctx = await requireNavAccess("/kpis")
  const anyDept = hasPerm(ctx, "kpi.assign.any_dept")
  if (!anyDept && !hasPerm(ctx, "kpi.assign.own_dept")) notFound()
  const { kpi: kpiParam } = await searchParams

  const [kpis, people, reviewers, current] = await Promise.all([
    listKpis(),
    listAssignablePeople(),
    listPeoplePicker(),
    listAssignments({ status: "active" }),
  ])
  const active = kpis.filter((k) => k.isActive)
  const selected = typeof kpiParam === "string" ? await getKpi(kpiParam) : null

  return (
    <div className="space-y-4">
      <Link href="/kpis" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> KPIs
      </Link>
      <PageHeader
        title="Assign KPI"
        description="Choose the KPI, the people and the period within one KPI year. Their periods open now and as each new one starts; each person is notified."
      />
      <AssignForm
        kpis={active.map((k) => ({ id: k.id, name: k.name, designation: k.designation, yearStartMonth: k.yearStartMonth, areaCount: k.areaCount }))}
        initialKpiId={selected?.isActive ? selected.id : (active[0]?.id ?? null)}
        people={anyDept ? people : people.filter((p) => p.department.id === ctx.department.id)}
        reviewers={reviewers}
        activeAssignments={current.map((a) => ({ kpiId: a.kpiId, userId: a.user.id, startDate: a.startDate, endDate: a.endDate }))}
        today={todayIso()}
      />
    </div>
  )
}
