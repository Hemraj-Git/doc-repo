import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeft, ChevronRight, FileUp, GraduationCap, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { hasPerm } from "@/lib/auth/permissions"
import { listDepartments } from "@/lib/data/org"
import { listStudents, studentFacets } from "@/lib/data/students"
import { STUDENT_STATUS_LABELS, STUDENT_STATUS_STYLES, type StudentStatus } from "@/lib/students"
import { NewStudentButton } from "./student-dialog"
import { StudentsToolbar } from "./students-toolbar"
import { EmptyState } from "@/components/empty-state"

export const metadata: Metadata = { title: "Students" }

const STATUSES = Object.keys(STUDENT_STATUS_LABELS) as StudentStatus[]

export default async function StudentsPage({ searchParams }: PageProps<"/students">) {
  const ctx = await requireNavAccess("/students")
  const params = await searchParams
  const get = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined)
  const page = Math.max(1, Number(get("page") ?? 1) || 1)
  const status = STATUSES.find((s) => s === get("status"))

  const seesAll = hasPerm(ctx, "student.view.all", "student.manage.any_dept", "certificate.manage.any_dept")
  const managesAny = hasPerm(ctx, "student.manage.any_dept")
  const managesOwn = hasPerm(ctx, "student.manage.own_dept")
  const issues = hasPerm(ctx, "certificate.manage.own_dept", "certificate.manage.any_dept")

  const [{ rows, total, pageSize }, facets, departments] = await Promise.all([
    listStudents({ q: get("q"), departmentId: get("dept"), course: get("course"), batch: get("batch"), status }, page),
    studentFacets(),
    seesAll || managesAny ? listDepartments() : Promise.resolve([]),
  ])
  const activeDepartments = departments.filter((d) => d.isActive).map((d) => ({ value: d.id, label: d.name }))
  const manageable = managesAny ? activeDepartments : managesOwn ? [{ value: ctx.department.id, label: ctx.department.name }] : []
  const pages = Math.max(1, Math.ceil(total / pageSize))

  const pageLink = (p: number) => {
    const next = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string"))
    next.set("page", String(p))
    return `/students?${next}`
  }

  return (
    <>
      <PageHeader
        title="Students"
        description={`Student profiles and their certificates${seesAll ? " across the institute" : ` in ${ctx.department.name}`}. Certificates can be verified publicly at /verify.`}
        actions={
          <>
            {issues && (
              <Link href="/students/bulk-upload" className={buttonVariants({ variant: "outline" })}>
                <Upload /> Bulk certificates
              </Link>
            )}
            {manageable.length > 0 && (
              <>
                <Link href="/students/import" className={buttonVariants({ variant: "outline" })}>
                  <FileUp /> Import
                </Link>
                <NewStudentButton departments={manageable} />
              </>
            )}
          </>
        }
      />
      <StudentsToolbar
        departments={seesAll ? activeDepartments : null}
        courses={facets.courses}
        batches={facets.batches}
      />

      {rows.length === 0 ? (
        <EmptyState icon={GraduationCap}>
          <p className="font-medium">{total === 0 && !get("q") ? "No students yet" : "No students match these filters"}</p>
          {manageable.length > 0 && (
            <p className="text-sm text-muted-foreground">Add students one by one, or import a whole batch from Excel or CSV.</p>
          )}
        </EmptyState>
      ) : (
        <>
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Regd No.</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Batch</TableHead>
                  {seesAll && <TableHead>Department</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Certificates</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link href={`/students/${s.id}`} className="font-medium hover:underline">
                        {s.fullName}
                      </Link>
                      {s.indosNo && <div className="text-xs text-muted-foreground">INDoS {s.indosNo}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.regdNo}</TableCell>
                    <TableCell className="max-w-56 truncate text-sm">{s.courseName}</TableCell>
                    <TableCell className="text-sm">{s.batch}</TableCell>
                    {seesAll && <TableCell className="text-xs">{s.department.code}</TableCell>}
                    <TableCell>
                      <Badge variant="outline" className={STUDENT_STATUS_STYLES[s.status]}>
                        {STUDENT_STATUS_LABELS[s.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.certificateCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span className="tabular-nums">
              {total} student{total === 1 ? "" : "s"} · page {page} of {pages}
            </span>
            <span className="flex gap-2">
              {page > 1 && (
                <Link href={pageLink(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <ChevronLeft /> Previous
                </Link>
              )}
              {page < pages && (
                <Link href={pageLink(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Next <ChevronRight />
                </Link>
              )}
            </span>
          </div>
        </>
      )}
    </>
  )
}
