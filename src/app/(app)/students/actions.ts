"use server"

import { createHash, randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import QRCode from "qrcode"
import { fail, fromDbError, invalid, ok, type ActionResult } from "@/lib/actions"
import { canManageCertificates, canViewStudents, hasPerm } from "@/lib/auth/permissions"
import { requireAppContext } from "@/lib/auth/session"
import { contentMatchesExtension, describeFile } from "@/lib/files"
import { MAX_CERTIFICATE_BYTES } from "@/lib/students"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { siteUrl } from "@/lib/verification/site"
import {
  certificateSchema,
  certificateTypeSchema,
  studentRow,
  studentSchema,
  type CertificateInput,
  type CertificateTypeInput,
  type StudentInput,
} from "@/lib/validation/students"

const BUCKET = "certificates"
const CERTIFICATE_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "webp"]

function refresh(studentId?: string) {
  revalidatePath("/students")
  if (studentId) revalidatePath(`/students/${studentId}`)
}

// -----------------------------------------------------------------------------
// Students
// -----------------------------------------------------------------------------

export async function createStudent(input: StudentInput): Promise<ActionResult<{ id: string }>> {
  await requireAppContext()
  const parsed = studentSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { data, error } = await supabase.from("students").insert(studentRow(parsed.data)).select("id").single()
  if (error) return fromDbError(error)
  refresh()
  return ok({ id: data.id as string })
}

export async function updateStudent(studentId: string, input: StudentInput): Promise<ActionResult> {
  await requireAppContext()
  const parsed = studentSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { data, error } = await supabase.from("students").update(studentRow(parsed.data)).eq("id", studentId).select("id")
  if (error) return fromDbError(error)
  if (!data?.length) return fail("You do not have permission to edit this student.")
  refresh(studentId)
  return ok()
}

/** Rows already mapped and checked in the browser; the database re-checks everything, all or nothing. */
export async function importStudents(rows: Record<string, string | number | null>[]): Promise<ActionResult<{ count: number }>> {
  await requireAppContext()
  if (!Array.isArray(rows) || rows.length === 0) return fail("Nothing to import.")
  if (rows.length > 2000) return fail("Import at most 2000 students at a time.")

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("import_students", { p_rows: rows })
  if (error) return /^Row \d+:/.test(error.message) ? fail(error.message) : fromDbError(error)
  refresh()
  return ok({ count: data as number })
}

export async function logStudentView(studentId: string) {
  await requireAppContext()
  const supabase = await createClient()
  await supabase.rpc("log_student_access", { p_student_id: studentId, p_action: "view" })
}

// -----------------------------------------------------------------------------
// Certificates: (1) signed upload URL → browser uploads to Storage →
// (2) server checks the stored file and issues the certificate.
// -----------------------------------------------------------------------------

async function studentFor(studentId: string) {
  const supabase = await createClient()
  const { data } = await supabase.from("students").select("id, department_id").eq("id", studentId).maybeSingle()
  return (data as { id: string; department_id: string } | null) ?? null
}

export async function requestCertificateUpload(
  studentId: string,
  fileName: string,
  sizeBytes: number
): Promise<ActionResult<{ path: string; token: string; contentType: string }>> {
  const ctx = await requireAppContext()
  const student = await studentFor(studentId)
  if (!student) return fail("Student not found.")
  if (!canManageCertificates(ctx, student.department_id)) return fail("You do not have permission to upload certificates here.")

  const file = describeFile(fileName)
  if (!file || !CERTIFICATE_EXTENSIONS.includes(file.ext)) return fail("Certificates must be PDF or image files.")
  if (sizeBytes <= 0) return fail("The file is empty.")
  if (sizeBytes > MAX_CERTIFICATE_BYTES) return fail("Certificate files can be at most 20 MB.")

  const path = `${student.department_id}/${student.id}/${randomUUID()}.${file.ext}`
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return fail(`Could not start the upload: ${error?.message ?? "unknown error"}`)
  return ok({ path, token: data.token, contentType: file.mime })
}

/** Downloads the uploaded file and checks it; removes it when it fails. */
async function checkUploaded(path: string, originalFilename: string) {
  const file = describeFile(originalFilename)
  if (!file || !CERTIFICATE_EXTENSIONS.includes(file.ext) || !path.endsWith(`.${file.ext}`)) {
    return fail("Certificates must be PDF or image files.")
  }
  const storage = createAdminClient().storage.from(BUCKET)
  const discard = async (message: string) => {
    await storage.remove([path])
    return fail(message)
  }
  const { data: blob, error } = await storage.download(path)
  if (error || !blob) return fail("The upload could not be found. Please try again.")
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.byteLength === 0) return discard("The file is empty.")
  if (bytes.byteLength > MAX_CERTIFICATE_BYTES) return discard("Certificate files can be at most 20 MB.")
  if (!contentMatchesExtension(file.ext, bytes)) {
    return discard(`The file's content does not match its .${file.ext} extension.`)
  }
  return ok({
    file,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    remove: () => storage.remove([path]),
  })
}

export async function issueCertificate(
  studentId: string,
  input: CertificateInput,
  upload: { path: string; originalFilename: string },
  /** Bulk upload passes false and refreshes once at the end, instead of re-rendering the page per certificate. */
  refreshPage = true
): Promise<ActionResult<{ id: string }>> {
  const parsed = certificateSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const [ctx, student] = await Promise.all([requireAppContext(), studentFor(studentId)])
  if (!student) return fail("Student not found.")
  if (!upload.path.startsWith(`${student.department_id}/${student.id}/`)) return fail("Invalid upload.")

  const checked = await checkUploaded(upload.path, upload.originalFilename)
  if (!checked.ok) return checked
  const v = parsed.data
  const { data, error } = await createAdminClient().rpc("record_certificate", {
    p_actor: ctx.user.id,
    p_student_id: studentId,
    p_type_id: v.typeId,
    p_certificate_no: v.certificateNo,
    p_issue_date: v.issueDate,
    p_academic_year: v.academicYear,
    p_semester: v.semester,
    p_result: v.result,
    p_remarks: v.remarks,
    p_storage_path: upload.path,
    p_original_filename: upload.originalFilename.slice(0, 255),
    p_file_format: checked.data.file.format,
    p_mime_type: checked.data.file.mime,
    p_size_bytes: checked.data.size,
    p_sha256: checked.data.sha256,
  })
  if (error) {
    await checked.data.remove()
    return fromDbError(error)
  }
  if (refreshPage) refresh(studentId)
  return ok({ id: data as string })
}

export async function replaceCertificateFile(
  certificateId: string,
  reason: string,
  upload: { path: string; originalFilename: string }
): Promise<ActionResult> {
  const ctx = await requireAppContext()
  if (!reason.trim()) return fail("Give a reason.", { reason: "Give a reason" })
  const supabase = await createClient()
  const { data: cert } = await supabase.from("certificates").select("id, student_id, department_id").eq("id", certificateId).maybeSingle()
  if (!cert) return fail("Certificate not found.")
  if (!upload.path.startsWith(`${cert.department_id}/${cert.student_id}/`)) return fail("Invalid upload.")

  const checked = await checkUploaded(upload.path, upload.originalFilename)
  if (!checked.ok) return checked
  const { error } = await createAdminClient().rpc("replace_certificate_file", {
    p_actor: ctx.user.id,
    p_certificate_id: certificateId,
    p_reason: reason.trim().slice(0, 500),
    p_storage_path: upload.path,
    p_original_filename: upload.originalFilename.slice(0, 255),
    p_file_format: checked.data.file.format,
    p_mime_type: checked.data.file.mime,
    p_size_bytes: checked.data.size,
    p_sha256: checked.data.sha256,
  })
  if (error) {
    await checked.data.remove()
    return fromDbError(error)
  }
  refresh(cert.student_id as string)
  return ok()
}

export async function revokeCertificate(certificateId: string, reason: string, replacementNo: string): Promise<ActionResult> {
  await requireAppContext()
  if (!reason.trim()) return fail("Give a reason.", { reason: "Give a reason" })
  const supabase = await createClient()
  const { data: cert } = await supabase.from("certificates").select("student_id").eq("id", certificateId).maybeSingle()
  const { error } = await supabase.rpc("revoke_certificate", {
    p_certificate_id: certificateId,
    p_reason: reason.trim().slice(0, 500),
    p_replacement_no: replacementNo.trim() || null,
  })
  if (error) return fromDbError(error)
  refresh(cert?.student_id as string | undefined)
  return ok()
}

/** A short-lived link to a certificate file (RLS decides whether the user may see it). */
export async function getCertificateFileUrl(fileId: string, mode: "view" | "download"): Promise<ActionResult<{ url: string }>> {
  const ctx = await requireAppContext()
  if (mode === "download" && !hasPerm(ctx, "document.download")) return fail("You do not have permission to download files.")
  const supabase = await createClient()
  const { data: file } = await supabase
    .from("certificate_files")
    .select("id, storage_path, original_filename, certificate:certificates!certificate_files_certificate_id_fkey(id, student_id, department_id)")
    .eq("id", fileId)
    .maybeSingle()
  if (!file) return fail("File not found.")
  const cert = file.certificate as unknown as { id: string; student_id: string; department_id: string }
  if (!canViewStudents(ctx, cert.department_id) && !hasPerm(ctx, "student.view.all")) return fail("File not found.")

  const { data, error } = await createAdminClient()
    .storage.from(BUCKET)
    .createSignedUrl(file.storage_path as string, 60, mode === "download" ? { download: file.original_filename as string } : undefined)
  if (error || !data) return fail("Could not open the file.")
  await supabase.rpc("log_student_access", {
    p_student_id: cert.student_id,
    p_action: mode === "download" ? "certificate_download" : "certificate_view",
    p_certificate_id: cert.id,
  })
  return ok({ url: data.signedUrl })
}

/** QR code (PNG data URL) for the certificate's public verification link. */
export async function certificateQr(certificateId: string): Promise<ActionResult<{ url: string; dataUrl: string }>> {
  await requireAppContext()
  const supabase = await createClient()
  const { data } = await supabase.from("certificates").select("verify_token").eq("id", certificateId).maybeSingle()
  if (!data) return fail("Certificate not found.")
  const url = `${await siteUrl()}/verify/c/${data.verify_token as string}`
  const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 480 })
  return ok({ url, dataUrl })
}

// -----------------------------------------------------------------------------
// Certificate types (Admin)
// -----------------------------------------------------------------------------

function typeRow(v: ReturnType<typeof certificateTypeSchema.parse>) {
  return { code: v.code, name: v.name, needs_period: v.needsPeriod, show_result: v.showResult, is_active: v.isActive }
}

export async function createCertificateType(input: CertificateTypeInput): Promise<ActionResult> {
  const ctx = await requireAppContext()
  if (!hasPerm(ctx, "document_type.manage")) return fail("You do not have permission to manage certificate types.")
  const parsed = certificateTypeSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await createClient()
  const { error } = await supabase.from("certificate_types").insert(typeRow(parsed.data))
  if (error) return fromDbError(error)
  revalidatePath("/admin/certificate-types")
  return ok()
}

export async function updateCertificateType(id: string, input: CertificateTypeInput): Promise<ActionResult> {
  const ctx = await requireAppContext()
  if (!hasPerm(ctx, "document_type.manage")) return fail("You do not have permission to manage certificate types.")
  const parsed = certificateTypeSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await createClient()
  const { error } = await supabase.from("certificate_types").update(typeRow(parsed.data)).eq("id", id)
  if (error) return fromDbError(error)
  revalidatePath("/admin/certificate-types")
  return ok()
}
