import type { Metadata } from "next"
import Link from "next/link"
import { AlertTriangle, Gauge, ListChecks, Send } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { requireNavAccess } from "@/lib/auth/guards"
import { hasPerm } from "@/lib/auth/permissions"
import { listDesignations, listKpis, listKpiScorerDepartments } from "@/lib/data/kpis"
import { listPeoplePicker } from "@/lib/data/org"
import { formatDate } from "@/lib/format"
import { MONTHS } from "@/lib/validation/settings"
import { KpiDetailsDialog } from "./kpi-details-dialog"

export const metadata: Metadata = { title: "KPIs" }

export default async function KpisPage() {
  const ctx = await requireNavAccess("/kpis")
  const canManage = hasPerm(ctx, "kpi.manage")
  const canAssign = hasPerm(ctx, "kpi.assign.own_dept", "kpi.assign.any_dept")
  const [kpis, designations, people, scorerDepartments] = await Promise.all([
    listKpis(),
    canManage ? listDesignations() : Promise.resolve([]),
    canManage ? listPeoplePicker() : Promise.resolve([]),
    canManage ? listKpiScorerDepartments() : Promise.resolve([]),
  ])

  return (
    <>
      <PageHeader
        title="KPIs"
        description="Each KPI has areas with a weightage (total 100%) and an interval: once, monthly, quarterly, half-yearly or annually. People write what they did and attach evidence for each period. Their reviewer approves it, the scorer scores it from 1 to 10, and the yearly result is out of 100."
        actions={
          <>
            <Link href="/kpis/assignments" className={buttonVariants({ variant: "outline" })}>
              <ListChecks /> Assignments
            </Link>
            {canAssign && (
              <Link href="/kpis/assign" className={buttonVariants({ variant: "outline" })}>
                <Send /> Assign
              </Link>
            )}
            {canManage && <KpiDetailsDialog designations={designations.map((d) => d.designation)} people={people} scorerDepartments={scorerDepartments} />}
          </>
        }
      />

      {kpis.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed py-14 text-center">
          <Gauge className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No KPIs yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Create one per role (e.g. “Faculty KPI”), add its areas, activate it, then assign it to everyone in that role.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>KPI</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead className="text-right">Areas</TableHead>
                <TableHead>Weightage</TableHead>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">Assigned</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kpis.map((k) => (
                <TableRow key={k.id}>
                  <TableCell>
                    <Link href={`/kpis/${k.id}`} className="font-medium hover:underline">
                      {k.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{k.designation ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{k.areaCount}</TableCell>
                  <TableCell>
                    {k.totalWeightage === 100 ? (
                      <Badge variant="secondary">100%</Badge>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-amber-700">
                        <AlertTriangle className="size-3.5" /> {k.totalWeightage}%
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">From {MONTHS[k.yearStartMonth - 1]}</TableCell>
                  <TableCell className="text-right tabular-nums">{k.activeAssignments}</TableCell>
                  <TableCell>
                    <StatusBadge active={k.isActive} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(k.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
