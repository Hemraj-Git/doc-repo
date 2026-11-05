import type { Metadata } from "next"
import Link from "next/link"
import { Network } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { hasPerm } from "@/lib/auth/permissions"
import { getOrgChart, listDepartments } from "@/lib/data/org"
import { DepartmentSwitcher } from "./department-switcher"
import { OrgTree } from "./org-tree"

export const metadata: Metadata = { title: "Org Chart" }

const INSTITUTE = "all"

export default async function OrgChartPage({ searchParams }: PageProps<"/admin/org-chart">) {
  const ctx = await requireNavAccess("/admin/org-chart")
  const { dept } = await searchParams
  const canManage = hasPerm(ctx, "user.manage")

  // User managers can view the whole institute or any department; HODs see their own
  // department together with everyone who reports up to them.
  const departments = canManage ? (await listDepartments()).filter((d) => d.isActive) : []
  const requested = typeof dept === "string" ? dept : undefined
  const view =
    canManage && (requested === INSTITUTE || departments.some((d) => d.id === requested))
      ? requested!
      : canManage
        ? INSTITUTE
        : ctx.department.id

  const { roots, total } = await getOrgChart(view === INSTITUTE ? "all" : { departmentId: view })
  const title =
    view === INSTITUTE
      ? "the whole institute"
      : (departments.find((d) => d.id === view)?.name ?? ctx.department.name)

  return (
    <>
      <PageHeader
        title="Org Chart"
        description={`Reporting hierarchy of ${title} · ${total} ${total === 1 ? "person" : "people"}`}
        actions={
          canManage && (
            <>
              <DepartmentSwitcher
                options={[
                  { value: INSTITUTE, label: "Whole institute" },
                  ...departments.map((d) => ({ value: d.id, label: d.name })),
                ]}
                value={view}
              />
              {view !== INSTITUTE && (
                <Link href={`/admin/users?dept=${view}`} className={buttonVariants({ variant: "outline" })}>
                  Manage users
                </Link>
              )}
            </>
          )
        }
      />
      {roots.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed py-14 text-center">
          <Network className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No one here yet</p>
          <p className="text-sm text-muted-foreground">Add the department head first, then the people who report to them.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-muted/20 p-4 md:p-6">
          <OrgTree roots={roots} viewDepartmentId={view === INSTITUTE ? undefined : view} />
        </div>
      )}
    </>
  )
}
