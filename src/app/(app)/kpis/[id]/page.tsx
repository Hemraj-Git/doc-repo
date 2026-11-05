import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { StatusBadge } from "@/components/status-badge"
import { requireNavAccess } from "@/lib/auth/guards"
import { hasPerm } from "@/lib/auth/permissions"
import { getKpi, listDesignations, listKpiScorerDepartments } from "@/lib/data/kpis"
import { listPeoplePicker } from "@/lib/data/org"
import { formatDateTime } from "@/lib/format"
import { KPI_REVIEWER_LABELS, KPI_SCORER_PERSON } from "@/lib/kpis"
import { MONTHS } from "@/lib/validation/settings"
import { KpiDetailsDialog } from "../kpi-details-dialog"
import { KpiBuilder } from "./kpi-builder"
import { KpiHeaderActions } from "./kpi-header-actions"

export async function generateMetadata({ params }: PageProps<"/kpis/[id]">): Promise<Metadata> {
  const { id } = await params
  const k = await getKpi(id)
  return { title: k ? `${k.name} · KPIs` : "KPIs" }
}

export default async function KpiPage({ params }: PageProps<"/kpis/[id]">) {
  const { id } = await params
  const [ctx, kpi] = await Promise.all([requireNavAccess("/kpis"), getKpi(id)])
  if (!kpi) notFound()
  const canManage = hasPerm(ctx, "kpi.manage")
  const canAssign = hasPerm(ctx, "kpi.assign.own_dept", "kpi.assign.any_dept")
  const [people, designations, scorerDepartments] = await Promise.all([
    listPeoplePicker(),
    canManage ? listDesignations() : Promise.resolve([]),
    canManage ? listKpiScorerDepartments() : Promise.resolve([]),
  ])
  const total = kpi.areas.reduce((s, a) => s + a.weightage, 0)
  const reviewer =
    kpi.reviewerRule === "fixed" ? (people.find((p) => p.value === kpi.reviewerUserId)?.label ?? "A specific person") : KPI_REVIEWER_LABELS[kpi.reviewerRule]
  const scorer = kpi.scorerDepartment
    ? `Head of ${kpi.scorerDepartment.name}`
    : kpi.scorerUserId
      ? (people.find((p) => p.value === kpi.scorerUserId)?.label ?? "A specific person")
      : null

  return (
    <div className="space-y-6">
      <div>
        <Link href="/kpis" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> KPIs
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{kpi.name}</h1>
              <StatusBadge active={kpi.isActive} />
            </div>
            <p className="text-sm text-muted-foreground">
              {kpi.designation ? `For ${kpi.designation} · ` : ""}Year starts in {MONTHS[kpi.yearStartMonth - 1]} · reviewer: {reviewer} · scorer: {scorer ?? <span className="font-medium text-warning-text">not set</span>} · submit within {kpi.dueDays} days of each period ending · edited{" "}
              {formatDateTime(kpi.updatedAt)}
            </p>
            {kpi.description && <p className="max-w-3xl text-sm whitespace-pre-line">{kpi.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <KpiDetailsDialog
                kpi={{
                  id: kpi.id,
                  name: kpi.name,
                  designation: kpi.designation ?? "",
                  description: kpi.description ?? "",
                  yearStartMonth: kpi.yearStartMonth,
                  reviewerRule: kpi.reviewerRule,
                  reviewerUserId: kpi.reviewerUserId,
                  scorer: kpi.scorerUserId ? KPI_SCORER_PERSON : (kpi.scorerDepartment?.id ?? null),
                  scorerUserId: kpi.scorerUserId,
                  dueDays: kpi.dueDays,
                }}
                designations={designations.map((d) => d.designation)}
                people={people}
                scorerDepartments={scorerDepartments}
              />
            )}
            <KpiHeaderActions
              kpiId={kpi.id}
              name={kpi.name}
              isActive={kpi.isActive}
              canManage={canManage}
              canAssign={canAssign}
              ready={total === 100 && kpi.areas.every((a) => Boolean(a.description))}
            />
          </div>
        </div>
      </div>

      <KpiBuilder kpi={kpi} canManage={canManage} />
    </div>
  )
}
