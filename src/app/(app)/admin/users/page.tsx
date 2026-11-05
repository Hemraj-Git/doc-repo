import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { hasPerm } from "@/lib/auth/permissions"
import { listDepartments, listPeople, listRoles, listUsers, type UserFilters } from "@/lib/data/org"
import { UsersTable } from "./users-table"
import { UsersToolbar } from "./users-toolbar"

export const metadata: Metadata = { title: "Users" }

const STATUSES = new Set(["active", "inactive", "all"])

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const ctx = await requireNavAccess("/admin/users")
  const params = await searchParams
  const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined)

  const filters: UserFilters = {
    q: str(params.q),
    departmentId: str(params.dept),
    status: STATUSES.has(str(params.status) ?? "") ? (str(params.status) as UserFilters["status"]) : "active",
  }

  const [users, departments, people, roles] = await Promise.all([
    listUsers(filters),
    listDepartments(),
    listPeople(),
    listRoles(),
  ])

  return (
    <>
      <PageHeader
        title="Users"
        description="Add users in hierarchy order — each person reports to someone already in their department."
      />
      <UsersToolbar departments={departments.map((d) => ({ value: d.id, label: d.name }))} />
      <UsersTable
        users={users}
        departments={departments}
        people={people}
        roles={roles}
        currentUserId={ctx.user.id}
        myPermissions={ctx.permissions}
        canAssignHead={hasPerm(ctx, "department.manage")}
        defaultDepartmentId={filters.departmentId}
      />
    </>
  )
}
