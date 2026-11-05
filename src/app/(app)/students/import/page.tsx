import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { hasPerm } from "@/lib/auth/permissions"
import { listDepartments } from "@/lib/data/org"
import { ImportWizard } from "./import-wizard"

export const metadata: Metadata = { title: "Import students" }

export default async function ImportStudentsPage() {
  const ctx = await requireNavAccess("/students")
  const any = hasPerm(ctx, "student.manage.any_dept")
  if (!any && !hasPerm(ctx, "student.manage.own_dept")) notFound()
  const departments = any
    ? (await listDepartments()).filter((d) => d.isActive).map((d) => ({ id: d.id, code: d.code, name: d.name }))
    : [{ id: ctx.department.id, code: ctx.department.code, name: ctx.department.name }]

  return (
    <div className="space-y-4">
      <Link href="/students" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Students
      </Link>
      <PageHeader
        title="Import students"
        description="Upload an Excel or CSV file with one student per row. Everything is checked first; nothing is saved until every row is valid."
      />
      <ImportWizard departments={departments} />
    </div>
  )
}
