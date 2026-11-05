import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { listPermissions, listRoles } from "@/lib/data/org"
import { RolesView } from "./roles-view"

export const metadata: Metadata = { title: "Roles & Permissions" }

export default async function RolesPage() {
  const ctx = await requireNavAccess("/admin/roles")
  const [roles, permissions] = await Promise.all([listRoles(), listPermissions()])

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="Every user holds Employee. Other roles add permissions on top; a user's access is the union of their roles."
      />
      <RolesView roles={roles} permissions={permissions} myPermissions={ctx.permissions} />
    </>
  )
}
