import "server-only"
import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import type { FileFormat } from "@/lib/files"
import type { CertificateStatus, Gender, StudentStatus } from "@/lib/students"

export type StudentListRow = {
  id: string
  regdNo: string
  fullName: string
  courseName: string
  batch: string
  status: StudentStatus
  indosNo: string | null
  department: { id: string; code: string; name: string }
  certificateCount: number
  updatedAt: string
}

export type StudentFilters = {
  q?: string
  departmentId?: string
  course?: string
  batch?: string
  status?: StudentStatus
}

const PAGE_SIZE = 50

/** Students the user may see (RLS decides), filtered and paged. */
export async function listStudents(filters: StudentFilters, page = 1): Promise<{ rows: StudentListRow[]; total: number; pageSize: number }> {
  const supabase = await createClient()
  let q = supabase
    .from("students")
    .select(
      "id, regd_no, full_name, course_name, batch, status, indos_no, updated_at, department:departments(id, code, name), certificates(count)",
      { count: "exact" }
    )
  const term = filters.q?.trim()
  if (term) {
    const safe = term.replace(/[%,()]/g, " ")
    q = q.or(`regd_no.ilike.%${safe}%,full_name.ilike.%${safe}%,indos_no.ilike.%${safe}%,enrollment_no.ilike.%${safe}%`)
  }
  if (filters.departmentId) q = q.eq("department_id", filters.departmentId)
  if (filters.course) q = q.ilike("course_name", filters.course)
  if (filters.batch) q = q.eq("batch", filters.batch)
  if (filters.status) q = q.eq("status", filters.status)
  const from = (page - 1) * PAGE_SIZE
  const { data, error, count } = await q.order("full_name").range(from, from + PAGE_SIZE - 1)
  if (error) throw new Error(`Could not load students: ${error.message}`)
  return {
    rows: ((data ?? []) as unknown as {
      id: string
      regd_no: string
      full_name: string
      course_name: string
      batch: string
      status: StudentStatus
      indos_no: string | null
      updated_at: string
      department: StudentListRow["department"]
      certificates: { count: number }[]
    }[]).map((s) => ({
      id: s.id,
      regdNo: s.regd_no,
      fullName: s.full_name,
      courseName: s.course_name,
      batch: s.batch,
      status: s.status,
      indosNo: s.indos_no,
      department: s.department,
      certificateCount: s.certificates[0]?.count ?? 0,
      updatedAt: s.updated_at,
    })),
    total: count ?? 0,
    pageSize: PAGE_SIZE,
  }
}

/** Distinct courses and batches among visible students (for filters). */
export async function studentFacets() {
  const supabase = await createClient()
  const { data } = await supabase.from("students").select("course_name, batch").limit(5000)
  const rows = (data ?? []) as { course_name: string; batch: string }[]
  const sorted = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b))
  return { courses: sorted(rows.map((r) => r.course_name)), batches: sorted(rows.map((r) => r.batch)).reverse() }
}

export type Student = {
  id: string
  regdNo: string
  fullName: string
  enrollmentNo: string | null
  dateOfBirth: string | null
  gender: Gender | null
  nationality: string | null
  department: { id: string; code: string; name: string }
  courseName: string
  courseCode: string | null
  batch: string
  admissionDate: string | null
  currentSemester: number | null
  status: StudentStatus
  completionDate: string | null
  finalResult: string | null
  indosNo: string | null
  cdcNo: string | null
  passportNo: string | null
  passportExpiry: string | null
  sponsor: string | null
  email: string | null
  mobile: string | null
  address: string | null
  programFolder: { id: string; name: string; departmentCode: string } | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
}

type StudentDb = {
  id: string
  regd_no: string
  full_name: string
  enrollment_no: string | null
  date_of_birth: string | null
  gender: Gender | null
  nationality: string | null
  course_name: string
  course_code: string | null
  batch: string
  admission_date: string | null
  current_semester: number | null
  status: StudentStatus
  completion_date: string | null
  final_result: string | null
  indos_no: string | null
  cdc_no: string | null
  passport_no: string | null
  passport_expiry: string | null
  sponsor: string | null
  email: string | null
  mobile: string | null
  address: string | null
  created_at: string
  updated_at: string
  department: { id: string; code: string; name: string }
  folder: { id: string; name: string; department: { code: string } } | null
  creator: { full_name: string } | null
}

export const getStudent = cache(async (id: string): Promise<Student | null> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from("students")
    .select(
      "*, department:departments(id, code, name), folder:folders(id, name, department:departments(code)), creator:profiles!students_created_by_fkey(full_name)"
    )
    .eq("id", id)
    .maybeSingle()
  if (!data) return null
  const s = data as unknown as StudentDb
  return {
    id: s.id,
    regdNo: s.regd_no,
    fullName: s.full_name,
    enrollmentNo: s.enrollment_no,
    dateOfBirth: s.date_of_birth,
    gender: s.gender,
    nationality: s.nationality,
    department: s.department,
    courseName: s.course_name,
    courseCode: s.course_code,
    batch: s.batch,
    admissionDate: s.admission_date,
    currentSemester: s.current_semester,
    status: s.status,
    completionDate: s.completion_date,
    finalResult: s.final_result,
    indosNo: s.indos_no,
    cdcNo: s.cdc_no,
    passportNo: s.passport_no,
    passportExpiry: s.passport_expiry,
    sponsor: s.sponsor,
    email: s.email,
    mobile: s.mobile,
    address: s.address,
    programFolder: s.folder ? { id: s.folder.id, name: s.folder.name, departmentCode: s.folder.department.code } : null,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    createdBy: s.creator?.full_name ?? null,
  }
})

export type CertificateFile = {
  id: string
  versionNo: number
  originalFilename: string
  fileFormat: FileFormat
  sizeBytes: number
  sha256: string
  reason: string | null
  uploadedAt: string
  uploadedBy: string
}

export type CertificateRow = {
  id: string
  type: { id: string; code: string; name: string; needsPeriod: boolean; showResult: boolean }
  certificateNo: string
  issueDate: string
  academicYear: string | null
  semester: number | null
  result: string | null
  remarks: string | null
  status: CertificateStatus
  statusReason: string | null
  statusChangedAt: string | null
  replacedByNo: string | null
  verifyToken: string
  currentFileId: string | null
  files: CertificateFile[]
  createdAt: string
}

type CertificateDb = {
  id: string
  certificate_no: string
  issue_date: string
  academic_year: string | null
  semester: number | null
  result: string | null
  remarks: string | null
  status: CertificateStatus
  status_reason: string | null
  status_changed_at: string | null
  verify_token: string
  current_file_id: string | null
  created_at: string
  type: { id: string; code: string; name: string; needs_period: boolean; show_result: boolean }
  replaced_by: { certificate_no: string } | null
  files: {
    id: string
    version_no: number
    original_filename: string
    file_format: FileFormat
    size_bytes: number
    sha256: string
    reason: string | null
    uploaded_at: string
    uploader: { full_name: string }
  }[]
}

export async function listCertificates(studentId: string): Promise<CertificateRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("certificates")
    .select(
      "id, certificate_no, issue_date, academic_year, semester, result, remarks, status, status_reason, status_changed_at, verify_token, current_file_id, created_at, type:certificate_types(id, code, name, needs_period, show_result), replaced_by:certificates!replaced_by_id(certificate_no), files:certificate_files!certificate_files_certificate_id_fkey(id, version_no, original_filename, file_format, size_bytes, sha256, reason, uploaded_at, uploader:profiles(full_name))"
    )
    .eq("student_id", studentId)
    .order("issue_date", { ascending: false })
  if (error) throw new Error(`Could not load certificates: ${error.message}`)
  return ((data ?? []) as unknown as CertificateDb[]).map((c) => ({
    id: c.id,
    type: { id: c.type.id, code: c.type.code, name: c.type.name, needsPeriod: c.type.needs_period, showResult: c.type.show_result },
    certificateNo: c.certificate_no,
    issueDate: c.issue_date,
    academicYear: c.academic_year,
    semester: c.semester,
    result: c.result,
    remarks: c.remarks,
    status: c.status,
    statusReason: c.status_reason,
    statusChangedAt: c.status_changed_at,
    replacedByNo: c.replaced_by?.certificate_no ?? null,
    verifyToken: c.verify_token,
    currentFileId: c.current_file_id,
    files: c.files
      .map((f) => ({
        id: f.id,
        versionNo: f.version_no,
        originalFilename: f.original_filename,
        fileFormat: f.file_format,
        sizeBytes: f.size_bytes,
        sha256: f.sha256,
        reason: f.reason,
        uploadedAt: f.uploaded_at,
        uploadedBy: f.uploader.full_name,
      }))
      .sort((a, b) => b.versionNo - a.versionNo),
    createdAt: c.created_at,
  }))
}

export type CertificateType = {
  id: string
  code: string
  name: string
  needsPeriod: boolean
  showResult: boolean
  isActive: boolean
  sortOrder: number
  certificateCount: number
}

export async function listCertificateTypes({ activeOnly = false } = {}): Promise<CertificateType[]> {
  const supabase = await createClient()
  let q = supabase.from("certificate_types").select("id, code, name, needs_period, show_result, is_active, sort_order, certificates(count)")
  if (activeOnly) q = q.eq("is_active", true)
  const { data, error } = await q.order("sort_order").order("name")
  if (error) throw new Error(`Could not load certificate types: ${error.message}`)
  return ((data ?? []) as unknown as {
    id: string
    code: string
    name: string
    needs_period: boolean
    show_result: boolean
    is_active: boolean
    sort_order: number
    certificates: { count: number }[]
  }[]).map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    needsPeriod: t.needs_period,
    showResult: t.show_result,
    isActive: t.is_active,
    sortOrder: t.sort_order,
    certificateCount: t.certificates[0]?.count ?? 0,
  }))
}

/** For bulk upload matching: every visible student of a department. */
export async function listStudentKeys(departmentId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("students")
    .select("id, regd_no, full_name")
    .eq("department_id", departmentId)
    .order("regd_no")
    .limit(10000)
  if (error) throw new Error(`Could not load students: ${error.message}`)
  return ((data ?? []) as { id: string; regd_no: string; full_name: string }[]).map((s) => ({
    id: s.id,
    regdNo: s.regd_no,
    fullName: s.full_name,
  }))
}

/** Template instances (programs, …) in a department, to link a student to their folder. */
export async function listLinkableFolders(departmentId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("template_instances")
    .select("name, root_folder_id, parent_instance_id, folder:folders!template_instances_root_folder_id_fkey(department_id)")
    .order("name")
  return ((data ?? []) as unknown as { name: string; root_folder_id: string; parent_instance_id: string | null; folder: { department_id: string } }[])
    .filter((i) => i.folder.department_id === departmentId)
    .map((i) => ({ value: i.root_folder_id, label: i.name }))
}

// -----------------------------------------------------------------------------
// Verification log
// -----------------------------------------------------------------------------

export type VerificationRow = {
  id: string
  code: string
  kind: "form" | "certificate_link"
  outcome: string
  requesterName: string | null
  requesterOrg: string | null
  requesterEmail: string | null
  purpose: string | null
  inputRegdNo: string | null
  inputName: string | null
  inputCertificateNo: string | null
  slipToken: string | null
  student: { id: string; fullName: string; regdNo: string } | null
  certificateNo: string | null
  createdAt: string
}

type VerificationDb = {
  id: string
  code: string
  kind: VerificationRow["kind"]
  outcome: string
  requester_name: string | null
  requester_org: string | null
  requester_email: string | null
  purpose: string | null
  input_regd_no: string | null
  input_name: string | null
  input_certificate_no: string | null
  slip_token: string
  created_at: string
  student: { id: string; full_name: string; regd_no: string } | null
  certificate: { certificate_no: string } | null
}

export type VerificationFilters = { q?: string; outcome?: string; from?: string; to?: string }

const VERIFICATION_COLUMNS =
  "id, code, kind, outcome, requester_name, requester_org, requester_email, purpose, input_regd_no, input_name, input_certificate_no, slip_token, created_at, student:students(id, full_name, regd_no), certificate:certificates(certificate_no)"

function toVerification(v: VerificationDb): VerificationRow {
  return {
    id: v.id,
    code: v.code,
    kind: v.kind,
    outcome: v.outcome,
    requesterName: v.requester_name,
    requesterOrg: v.requester_org,
    requesterEmail: v.requester_email,
    purpose: v.purpose,
    inputRegdNo: v.input_regd_no,
    inputName: v.input_name,
    inputCertificateNo: v.input_certificate_no,
    slipToken: v.outcome === "matched" && v.kind === "form" ? v.slip_token : null,
    student: v.student ? { id: v.student.id, fullName: v.student.full_name, regdNo: v.student.regd_no } : null,
    certificateNo: v.certificate?.certificate_no ?? null,
    createdAt: v.created_at,
  }
}

export async function listVerifications(filters: VerificationFilters, limit = 200, offset = 0): Promise<VerificationRow[]> {
  const supabase = await createClient()
  let q = supabase.from("verification_requests").select(VERIFICATION_COLUMNS)
  const term = filters.q?.trim()
  if (term) {
    const safe = term.replace(/[%,()]/g, " ")
    q = q.or(
      `code.ilike.%${safe}%,requester_org.ilike.%${safe}%,requester_email.ilike.%${safe}%,requester_name.ilike.%${safe}%,input_regd_no.ilike.%${safe}%`
    )
  }
  if (filters.outcome) q = q.eq("outcome", filters.outcome)
  if (filters.from) q = q.gte("created_at", `${filters.from}T00:00:00+05:30`)
  if (filters.to) q = q.lte("created_at", `${filters.to}T23:59:59.999+05:30`)
  const { data, error } = await q.order("created_at", { ascending: false }).range(offset, offset + limit - 1)
  if (error) throw new Error(`Could not load verifications: ${error.message}`)
  return ((data ?? []) as unknown as VerificationDb[]).map(toVerification)
}

export async function listStudentVerifications(studentId: string): Promise<VerificationRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("verification_requests")
    .select(VERIFICATION_COLUMNS)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(200)
  if (error) throw new Error(`Could not load verification history: ${error.message}`)
  return ((data ?? []) as unknown as VerificationDb[]).map(toVerification)
}

/** Matched verifications since the start of this month (institute time). */
export async function verificationsThisMonth(monthStart: string) {
  const supabase = await createClient()
  const [all, matched] = await Promise.all([
    supabase.from("verification_requests").select("id", { count: "exact", head: true }).gte("created_at", `${monthStart}T00:00:00+05:30`),
    supabase
      .from("verification_requests")
      .select("id", { count: "exact", head: true })
      .gte("created_at", `${monthStart}T00:00:00+05:30`)
      .eq("outcome", "matched"),
  ])
  return { total: all.count ?? 0, matched: matched.count ?? 0 }
}
