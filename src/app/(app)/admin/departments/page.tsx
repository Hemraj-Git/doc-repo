import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { listDepartments, listPeople } from "@/lib/data/org"
import { DepartmentsTable } from "./departments-table"

export const metadata: Metadata = { title: "Departments" }

export default async function DepartmentsPage() {
  await requireNavAccess("/admin/departments")
  const [departments, people] = await Promise.all([listDepartments(), listPeople()])

  return (
    <>
      <PageHeader
        title="Departments"
        description="Configure departments first, then add their users in hierarchy order and assign each head."
      />
      <DepartmentsTable departments={departments} people={people} />
    </>
  )
}
