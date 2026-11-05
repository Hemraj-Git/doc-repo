"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { fail, fromDbError, invalid, ok, type ActionResult } from "@/lib/actions"
import { hasPerm } from "@/lib/auth/permissions"
import { requireAppContext } from "@/lib/auth/session"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { checkUploadRequest, DOCUMENTS_BUCKET as BUCKET, verifyStoredUpload } from "@/lib/uploads"
import { safeNextPath } from "@/lib/validation/auth"
import { directUploadSchema, documentSchema, reviewDecisionSchema, type DirectUploadInput, type DocumentInput } from "@/lib/validation/documents"
import { referenceIdSchema } from "@/lib/validation/repository"

function refreshAll(documentId?: string) {
  // Lists, counts and the notification bell appear on many pages.
  revalidatePath("/", "layout")
  if (documentId) revalidatePath(`/documents/${documentId}`)
}

async function folderLevel(folderId: string) {
  const supabase = await createClient()
  const { data } = await supabase.from("folders").select("level").eq("id", folderId).maybeSingle()
  return (data?.level as "root" | "child" | "sub" | undefined) ?? null
}

function rpcArgs(v: ReturnType<typeof documentSchema.parse>, referenceId: string | null) {
  return {
    p_name: v.name,
    p_document_type_id: v.documentTypeId,
    p_reference_id: referenceId,
    p_description: v.description,
    p_uploader_id: v.uploaderId,
    p_requires_review: v.requiresReview,
    p_reviewer_ids: v.requiresReview ? v.reviewerIds : [],
    p_due_date: v.dueDate || null,
  }
}

/** Standalone documents (directly in a department) need a Ref ID; inside folders it is optional. */
function documentRef(level: string | null, raw: string): ActionResult<string | null> {
  if (level !== "root" && !raw.trim()) return ok(null)
  const ref = referenceIdSchema.safeParse(raw)
  return ref.success ? ok(ref.data) : fail("Please correct the highlighted fields.", { referenceId: ref.error.issues[0]!.message })
}

export async function createDocument(folderId: string, input: DocumentInput): Promise<ActionResult<{ id: string }>> {
  await requireAppContext()
  const parsed = documentSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const level = await folderLevel(folderId)
  if (!level) return fail("Folder not found.")
  const ref = documentRef(level, parsed.data.referenceId)
  if (!ref.ok) return ref

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_document", { p_folder_id: folderId, ...rpcArgs(parsed.data, ref.data) })
  if (error) return fromDbError(error)

  refreshAll()
  return ok({ id: data as string })
}

export async function updateDocument(documentId: string, input: DocumentInput): Promise<ActionResult> {
  await requireAppContext()
  const parsed = documentSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { data: doc } = await supabase.from("documents").select("folder_id").eq("id", documentId).maybeSingle()
  if (!doc) return fail("Document not found.")
  const ref = documentRef(await folderLevel(doc.folder_id as string), parsed.data.referenceId)
  if (!ref.ok) return ref

  const { error } = await supabase.rpc("update_document", { p_document_id: documentId, ...rpcArgs(parsed.data, ref.data) })
  if (error) return fromDbError(error)

  refreshAll(documentId)
  return ok()
}

// -----------------------------------------------------------------------------
// Upload: (1) signed upload URL → browser uploads straight to Storage →
// (2) server verifies the stored file and records the version.
// -----------------------------------------------------------------------------

/** The caller's context and the document, loaded together. */
async function loadForUpload(documentId: string) {
  const supabase = await createClient()
  const [ctx, { data }] = await Promise.all([
    requireAppContext(),
    supabase.from("documents").select("id, department_id, assigned_uploader_id, status").eq("id", documentId).maybeSingle(),
  ])
  if (!data) return fail("Document not found.")
  if (data.assigned_uploader_id !== ctx.user.id) return fail("Only the assigned uploader can upload this document.")
  if (data.status === "in_review") return fail("A review is in progress. Wait for it to finish before uploading a new version.")
  return ok({ ...(data as { id: string; department_id: string }), actorId: ctx.user.id })
}

export async function requestUpload(
  documentId: string,
  fileName: string,
  sizeBytes: number
): Promise<ActionResult<{ path: string; token: string; contentType: string }>> {
  const doc = await loadForUpload(documentId)
  if (!doc.ok) return doc

  const checked = checkUploadRequest(fileName, sizeBytes)
  if (!checked.ok) return checked
  const file = checked.data

  const path = `${doc.data.department_id}/${doc.data.id}/${randomUUID()}.${file.ext}`
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return fail(`Could not start the upload: ${error?.message ?? "unknown error"}`)

  return ok({ path, token: data.token, contentType: file.mime })
}

export async function finalizeUpload(
  documentId: string,
  path: string,
  originalFilename: string,
  note: string
): Promise<ActionResult> {
  const doc = await loadForUpload(documentId)
  if (!doc.ok) return doc
  if (!path.startsWith(`${doc.data.department_id}/${doc.data.id}/`)) return fail("Invalid upload.")

  const verified = await verifyStoredUpload(path, originalFilename)
  if (!verified.ok) return verified
  const { file, sizeBytes, sha256 } = verified.data

  const { error } = await createAdminClient().rpc("record_document_version", {
    p_actor: doc.data.actorId,
    p_document_id: documentId,
    p_storage_path: path,
    p_original_filename: originalFilename.slice(0, 255),
    p_file_format: file.format,
    p_mime_type: file.mime,
    p_size_bytes: sizeBytes,
    p_sha256: sha256,
    p_note: note.slice(0, 1000),
  })
  if (error) {
    await createAdminClient().storage.from(BUCKET).remove([path])
    return fromDbError(error)
  }

  refreshAll(documentId)
  return ok()
}

// -----------------------------------------------------------------------------
// Direct upload: a file put straight into a folder, with no requirement behind it.
// The document is only created once the file is verified, so a failed upload never
// leaves an empty document. Its id is chosen first because the storage path holds it.
// -----------------------------------------------------------------------------

/** The folder and checked details, if the signed-in user may upload here. */
async function loadForDirectUpload(folderId: string, input: DirectUploadInput) {
  const ctx = await requireAppContext()
  const parsed = directUploadSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const [{ data: folder }, { data: access, error }] = await Promise.all([
    supabase.from("folders").select("id, department_id, level").eq("id", folderId).maybeSingle(),
    supabase.rpc("my_folder_access", { p_folder: folderId }),
  ])
  if (error) return fromDbError(error)
  if (!folder || access !== "write") return fail("You do not have permission to upload to this folder.")

  const ref = documentRef(folder.level as string, parsed.data.referenceId)
  if (!ref.ok) return ref
  return ok({ folder: folder as { id: string; department_id: string }, values: parsed.data, referenceId: ref.data, actorId: ctx.user.id })
}

export async function requestDirectUpload(
  folderId: string,
  fileName: string,
  sizeBytes: number,
  input: DirectUploadInput
): Promise<ActionResult<{ documentId: string; path: string; token: string; contentType: string }>> {
  const loaded = await loadForDirectUpload(folderId, input)
  if (!loaded.ok) return loaded

  const checked = checkUploadRequest(fileName, sizeBytes)
  if (!checked.ok) return checked
  const file = checked.data

  // Catch a Reference ID that is taken before the file is sent.
  if (loaded.data.referenceId) {
    const supabase = await createClient()
    const { data: available } = await supabase.rpc("reference_id_available", { p_ref: loaded.data.referenceId })
    if (available === false) return fail("This Reference ID is already in use", { referenceId: "This Reference ID is already in use" })
  }

  const documentId = randomUUID()
  const path = `${loaded.data.folder.department_id}/${documentId}/${randomUUID()}.${file.ext}`
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return fail(`Could not start the upload: ${error?.message ?? "unknown error"}`)

  return ok({ documentId, path, token: data.token, contentType: file.mime })
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

export async function finalizeDirectUpload(
  folderId: string,
  documentId: string,
  path: string,
  originalFilename: string,
  input: DirectUploadInput
): Promise<ActionResult<{ id: string }>> {
  const loaded = await loadForDirectUpload(folderId, input)
  if (!loaded.ok) return loaded
  const { folder, values, referenceId, actorId } = loaded.data

  // The browser sends these back, so they are not trusted. A failed upload deletes the
  // file at `path`, so that path must never point at an existing document's file.
  if (!new RegExp(`^${UUID}$`).test(documentId)) return fail("Invalid upload.")
  if (!new RegExp(`^${folder.department_id}/${documentId}/${UUID}\\.[a-z0-9]+$`).test(path)) return fail("Invalid upload.")
  const admin = createAdminClient()
  const { data: existing } = await admin.from("documents").select("id").eq("id", documentId).maybeSingle()
  if (existing) return fail("Invalid upload.")

  const verified = await verifyStoredUpload(path, originalFilename)
  if (!verified.ok) return verified
  const { file, sizeBytes, sha256 } = verified.data

  const { error } = await admin.rpc("create_direct_document", {
    p_actor: actorId,
    p_document_id: documentId,
    p_folder_id: folder.id,
    p_name: values.name,
    p_document_type_id: values.documentTypeId,
    p_reference_id: referenceId,
    p_description: values.description,
    p_reviewer_ids: values.reviewerIds,
    p_storage_path: path,
    p_original_filename: originalFilename.slice(0, 255),
    p_file_format: file.format,
    p_mime_type: file.mime,
    p_size_bytes: sizeBytes,
    p_sha256: sha256,
  })
  if (error) {
    await admin.storage.from(BUCKET).remove([path])
    return fromDbError(error)
  }

  refreshAll()
  return ok({ id: documentId })
}

// -----------------------------------------------------------------------------
// Review
// -----------------------------------------------------------------------------

export async function decideReview(documentId: string, stepId: string, approve: boolean, comment: string): Promise<ActionResult> {
  await requireAppContext()
  const parsed = reviewDecisionSchema.safeParse({ approve, comment })
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { error } = await supabase.rpc("decide_review", {
    p_step_id: stepId,
    p_approve: parsed.data.approve,
    p_comment: parsed.data.comment,
  })
  if (error) return fromDbError(error)

  refreshAll(documentId)
  return ok()
}

// -----------------------------------------------------------------------------
// File access: short-lived signed URLs, logged in the audit trail.
// -----------------------------------------------------------------------------

export async function getFileUrl(versionId: string, mode: "view" | "download"): Promise<ActionResult<{ url: string }>> {
  // RLS: only returns the version if the user can see its document.
  const supabase = await createClient()
  const [ctx, { data: version }] = await Promise.all([
    requireAppContext(),
    supabase.from("document_versions").select("id, document_id, storage_path, original_filename").eq("id", versionId).maybeSingle(),
  ])
  if (mode === "download" && !hasPerm(ctx, "document.download")) return fail("You do not have permission to download documents.")
  if (!version) return fail("File not found.")

  const { data, error } = await createAdminClient()
    .storage.from(BUCKET)
    .createSignedUrl(version.storage_path as string, 60, mode === "download" ? { download: version.original_filename as string } : undefined)
  if (error || !data) return fail("Could not open the file.")

  await supabase.rpc("log_document_access", {
    p_document_id: version.document_id,
    p_action: mode,
    p_version_id: version.id,
  })
  return ok({ url: data.signedUrl })
}

// -----------------------------------------------------------------------------
// Notifications
// -----------------------------------------------------------------------------

/** With `then` (an in-app path), redirects there, so marking read and opening the link is one round trip. */
export async function markNotificationsRead(ids?: string[], then?: string): Promise<ActionResult> {
  await requireAppContext()
  const supabase = await createClient()
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: ids ?? null })
  if (error) return fromDbError(error)
  revalidatePath("/", "layout")
  if (then) redirect(safeNextPath(then))
  return ok()
}

// -----------------------------------------------------------------------------
// Not applicable (e.g. a holiday week) and reopening
// -----------------------------------------------------------------------------

export async function markNotApplicable(documentId: string, reason: string): Promise<ActionResult> {
  await requireAppContext()
  const text = reason.trim()
  if (!text) return fail("Give a reason.", { reason: "Give a reason" })
  if (text.length > 500) return fail("At most 500 characters.", { reason: "At most 500 characters" })

  const supabase = await createClient()
  const { error } = await supabase.rpc("mark_not_applicable", { p_document_id: documentId, p_reason: text })
  if (error) return fromDbError(error)

  refreshAll(documentId)
  return ok()
}

export async function reopenDocument(documentId: string): Promise<ActionResult> {
  await requireAppContext()
  const supabase = await createClient()
  const { error } = await supabase.rpc("reopen_document", { p_document_id: documentId })
  if (error) return fromDbError(error)

  refreshAll(documentId)
  return ok()
}
