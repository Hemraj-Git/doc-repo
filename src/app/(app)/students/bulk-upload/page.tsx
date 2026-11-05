import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { hasPerm } from "@/lib/auth/permissions"
import { listDepartments } from "@/lib/data/org"
import { listCertificateTypes, listStudentKeys } from "@/lib/data/students"
import { BulkUpload } from "./bulk-upload"

export const metadata: Metadata = { title: "Bulk certificate upload" }

export default async function BulkUploadPage({ searchParams }: PageProps<"/students/bulk-upload">) {
  const ctx = await requireNavAccess("/students")
  const any = hasPerm(ctx, "certificate.manage.any_dept")
  if (!any && !hasPerm(ctx, "certificate.manage.own_dept")) notFound()

  const departments = any
    ? (await listDepartments()).filter((d) => d.isActive).map((d) => ({ value: d.id, label: d.name }))
    : [{ value: ctx.department.id, label: ctx.department.name }]
  const { dept } = await searchParams
  const departmentId = departments.find((d) => d.value === dept)?.value ?? departments.find((d) => d.value === ctx.department.id)?.value ?? departments[0]?.value
  if (!departmentId) notFound()

  const [students, types] = await Promise.all([listStudentKeys(departmentId), listCertificateTypes({ activeOnly: true })])

  return (
    <div className="space-y-4">
      <Link href="/students" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Students
      </Link>
      <PageHeader
        title="Bulk certificate upload"
        description="Drop many certificate files at once — e.g. a whole batch's marksheets. Name files by Regd No. and certificate number, like SOM-2026-001_MS-2026-0001.pdf; check the matches, then upload."
      />
      <BulkUpload
        key={departmentId}
        departmentId={departmentId}
        departments={departments}
        students={students}
        types={types.map((t) => ({ id: t.id, code: t.code, name: t.name, needsPeriod: t.needsPeriod }))}
      />
    </div>
  )
}
