import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, FolderOpen, GraduationCap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requireNavAccess } from "@/lib/auth/guards"
import { canManageCertificates, canManageStudents, hasPerm } from "@/lib/auth/permissions"
import { listDepartments } from "@/lib/data/org"
import { getStudent, listCertificates, listCertificateTypes, listLinkableFolders, listStudentVerifications } from "@/lib/data/students"
import { formatDate, formatDateTime } from "@/lib/format"
import {
  GENDER_LABELS,
  STUDENT_STATUS_LABELS,
  STUDENT_STATUS_STYLES,
  VERIFICATION_OUTCOME_LABELS,
} from "@/lib/students"
import { CertificatesPanel } from "./certificates-panel"
import { EditStudentButton } from "../student-dialog"
import { ViewLogger } from "./view-logger"

export async function generateMetadata({ params }: PageProps<"/students/[id]">): Promise<Metadata> {
  const { id } = await params
  const s = await getStudent(id)
  return { title: s ? `${s.fullName} · Students` : "Students" }
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}

export default async function StudentPage({ params }: PageProps<"/students/[id]">) {
  const { id } = await params
  const [ctx, student] = await Promise.all([requireNavAccess("/students"), getStudent(id)])
  if (!student) notFound()

  const canEdit = canManageStudents(ctx, student.department.id)
  const canIssue = canManageCertificates(ctx, student.department.id)
  const [certificates, types, verifications, departments, folders] = await Promise.all([
    listCertificates(student.id),
    canIssue ? listCertificateTypes({ activeOnly: true }) : Promise.resolve([]),
    listStudentVerifications(student.id),
    canEdit && hasPerm(ctx, "student.manage.any_dept") ? listDepartments() : Promise.resolve([]),
    canEdit ? listLinkableFolders(student.department.id) : Promise.resolve([]),
  ])
  const departmentOptions = hasPerm(ctx, "student.manage.any_dept")
    ? departments.filter((d) => d.isActive).map((d) => ({ value: d.id, label: d.name }))
    : [{ value: student.department.id, label: student.department.name }]
  const date = (v: string | null) => (v ? formatDate(v) : null)

  return (
    <div className="space-y-6">
      <ViewLogger studentId={student.id} />
      <div>
        <Link href="/students" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Students
        </Link>
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <GraduationCap className="size-5" />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{student.fullName}</h1>
              <Badge variant="outline" className={STUDENT_STATUS_STYLES[student.status]}>
                {STUDENT_STATUS_LABELS[student.status]}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{student.regdNo}</span> · {student.courseName} · Batch {student.batch} · {student.department.name}
            </p>
          </div>
          {canEdit && <EditStudentButton student={student} departments={departmentOptions} folders={folders} />}
        </div>
      </div>

      <Tabs defaultValue="certificates">
        <TabsList>
          <TabsTrigger value="certificates">Certificates ({certificates.length})</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="verifications">Verification history ({verifications.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="certificates" className="pt-4">
          <CertificatesPanel
            studentId={student.id}
            studentName={student.fullName}
            certificates={certificates}
            types={types}
            canManage={canIssue}
            canDownload={hasPerm(ctx, "document.download")}
          />
        </TabsContent>

        <TabsContent value="details" className="pt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-medium">Identity</h2>
              <dl className="grid grid-cols-2 gap-3">
                <Detail label="Full name" value={student.fullName} />
                <Detail label="Regd No." value={<span className="font-mono">{student.regdNo}</span>} />
                <Detail label="Enrollment / Roll No." value={student.enrollmentNo} />
                <Detail label="Date of birth" value={date(student.dateOfBirth)} />
                <Detail label="Gender" value={student.gender ? GENDER_LABELS[student.gender] : null} />
                <Detail label="Nationality" value={student.nationality} />
              </dl>
            </section>
            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-medium">Course</h2>
              <dl className="grid grid-cols-2 gap-3">
                <Detail label="Course / Program" value={student.courseName} />
                <Detail label="Course code" value={student.courseCode} />
                <Detail label="Batch" value={student.batch} />
                <Detail label="Admission date" value={date(student.admissionDate)} />
                <Detail label="Current semester" value={student.currentSemester} />
                <Detail label="Completion date" value={date(student.completionDate)} />
                <Detail label="Final result / CGPA" value={student.finalResult} />
              </dl>
            </section>
            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-medium">Maritime IDs</h2>
              <dl className="grid grid-cols-2 gap-3">
                <Detail label="INDoS No." value={student.indosNo} />
                <Detail label="CDC No." value={student.cdcNo} />
                <Detail label="Passport No." value={student.passportNo} />
                <Detail label="Passport expiry" value={date(student.passportExpiry)} />
                <Detail label="Sponsoring company" value={student.sponsor} />
              </dl>
            </section>
            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-medium">Contact</h2>
              <dl className="grid grid-cols-2 gap-3">
                <Detail label="Email" value={student.email} />
                <Detail label="Mobile" value={student.mobile} />
                <div className="col-span-2">
                  <Detail label="Address" value={student.address && <span className="whitespace-pre-line">{student.address}</span>} />
                </div>
              </dl>
            </section>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Added {formatDateTime(student.createdAt)}
            {student.createdBy ? ` by ${student.createdBy}` : ""} · updated {formatDateTime(student.updatedAt)}. Viewing this profile is recorded in the audit
            log.
          </p>
        </TabsContent>

        <TabsContent value="documents" className="pt-4">
          {student.programFolder ? (
            <Link
              href={`/repository/${student.programFolder.departmentCode}/${student.programFolder.id}`}
              className="flex w-fit items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/40"
            >
              <FolderOpen className="size-5 text-primary" />
              <span>
                <span className="block font-medium">{student.programFolder.name}</span>
                <span className="text-sm text-muted-foreground">Open the student’s folder in the repository</span>
              </span>
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">
              No repository folder is linked.{" "}
              {canEdit
                ? "Create the student’s folder from a template in the repository, then link it here with Edit → Program folder."
                : "A student manager can link one."}
            </p>
          )}
        </TabsContent>

        <TabsContent value="verifications" className="pt-4">
          {verifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one has verified this student yet.</p>
          ) : (
            <div className="rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Verification ID</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Via</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {verifications.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(v.createdAt)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {v.slipToken ? (
                          <Link href={`/verify/slip/${v.slipToken}`} className="hover:underline" target="_blank">
                            {v.code}
                          </Link>
                        ) : (
                          v.code
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {v.requesterOrg ?? <span className="text-muted-foreground">Anonymous (QR scan)</span>}
                        {v.requesterName && <div className="text-xs text-muted-foreground">{v.requesterName}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{v.purpose ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {v.kind === "form" ? "Portal" : `QR · ${v.certificateNo ?? ""}`}
                        {v.outcome !== "matched" && ` · ${VERIFICATION_OUTCOME_LABELS[v.outcome] ?? v.outcome}`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
