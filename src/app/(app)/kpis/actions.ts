"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { fail, fromDbError, invalid, ok, type ActionResult } from "@/lib/actions"
import { hasPerm } from "@/lib/auth/permissions"
import { requireAppContext } from "@/lib/auth/session"
import { searchDocuments } from "@/lib/data/documents"
import { KPI_SCORER_PERSON } from "@/lib/kpis"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { checkUploadRequest, DOCUMENTS_BUCKET, verifyStoredUpload } from "@/lib/uploads"
import {
  assignSchema,
  entrySubmitSchema,
  kpiAreaSchema,
  kpiDetailsSchema,
  scoreSchema,
  type AssignInput,
  type EntrySubmitInput,
  type KpiAreaInput,
  type KpiDetailsInput,
} from "@/lib/validation/kpis"

const NO_PERMISSION = "You do not have permission to edit KPIs."

async function canManage() {
  return hasPerm(await requireAppContext(), "kpi.manage")
}

function refresh(kpiId?: string) {
  revalidatePath("/kpis")
  if (kpiId) revalidatePath(`/kpis/${kpiId}`)
}

// -----------------------------------------------------------------------------
// KPI definitions
// -----------------------------------------------------------------------------

function detailsRow(v: ReturnType<typeof kpiDetailsSchema.parse>) {
  return {
    name: v.name,
    designation: v.designation || null,
    description: v.description || null,
    year_start_month: v.yearStartMonth,
    reviewer_rule: v.reviewerRule,
    reviewer_user_id: v.reviewerRule === "fixed" ? v.reviewerUserId : null,
    scorer_department_id: v.scorer === KPI_SCORER_PERSON ? null : v.scorer,
    scorer_user_id: v.scorer === KPI_SCORER_PERSON ? v.scorerUserId : null,
    due_days: v.dueDays,
  }
}

export async function createKpi(input: KpiDetailsInput): Promise<ActionResult<{ id: string }>> {
  if (!(await canManage())) return fail(NO_PERMISSION)
  const parsed = kpiDetailsSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await createClient()
  const { data, error } = await supabase.from("kpis").insert(detailsRow(parsed.data)).select("id").single()
  if (error) return error.code === "23505" ? fail("A KPI with this name already exists.", { name: "Already in use" }) : fromDbError(error)
  refresh()
  return ok({ id: data.id as string })
}

export async function updateKpi(kpiId: string, input: KpiDetailsInput): Promise<ActionResult> {
  if (!(await canManage())) return fail(NO_PERMISSION)
  const parsed = kpiDetailsSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await createClient()
  const { error } = await supabase.from("kpis").update(detailsRow(parsed.data)).eq("id", kpiId)
  if (error) return error.code === "23505" ? fail("A KPI with this name already exists.", { name: "Already in use" }) : fromDbError(error)
  refresh(kpiId)
  return ok()
}

/** Activation is checked by the database: weightages total 100% and every area says what is measured. */
export async function setKpiActive(kpiId: string, active: boolean): Promise<ActionResult> {
  if (!(await canManage())) return fail(NO_PERMISSION)
  const supabase = await createClient()
  const { error } = await supabase.from("kpis").update({ is_active: active }).eq("id", kpiId)
  if (error) return fromDbError(error)
  refresh(kpiId)
  return ok()
}

export async function duplicateKpi(kpiId: string): Promise<ActionResult<{ id: string }>> {
  if (!(await canManage())) return fail(NO_PERMISSION)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("duplicate_kpi", { p_kpi: kpiId })
  if (error) return fromDbError(error)
  refresh()
  return ok({ id: data as string })
}

/** Existing assignments keep their own copy of the areas. */
export async function deleteKpi(kpiId: string): Promise<ActionResult> {
  if (!(await canManage())) return fail(NO_PERMISSION)
  const supabase = await createClient()
  const { error } = await supabase.from("kpis").delete().eq("id", kpiId)
  if (error) return fromDbError(error)
  refresh()
  return ok()
}

// -----------------------------------------------------------------------------
// Areas
// -----------------------------------------------------------------------------

export async function saveArea(kpiId: string, areaId: string | null, input: KpiAreaInput): Promise<ActionResult> {
  if (!(await canManage())) return fail(NO_PERMISSION)
  const parsed = kpiAreaSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data
  const row = { name: v.name, weightage: v.weightage, description: v.description, recurrence: v.recurrence }
  const supabase = await createClient()
  let error
  if (areaId) {
    ;({ error } = await supabase.from("kpi_areas").update(row).eq("id", areaId))
  } else {
    const { data: last } = await supabase.from("kpi_areas").select("sort_order").eq("kpi_id", kpiId).order("sort_order", { ascending: false }).limit(1).maybeSingle()
    ;({ error } = await supabase.from("kpi_areas").insert({ ...row, kpi_id: kpiId, sort_order: ((last?.sort_order as number | undefined) ?? 0) + 10 }))
  }
  if (error) return error.code === "23505" ? fail("An area with this name already exists.", { name: "Already in use" }) : fromDbError(error)
  refresh(kpiId)
  return ok()
}

export async function deleteArea(kpiId: string, areaId: string): Promise<ActionResult> {
  if (!(await canManage())) return fail(NO_PERMISSION)
  const supabase = await createClient()
  const { error } = await supabase.from("kpi_areas").delete().eq("id", areaId)
  if (error) return fromDbError(error)
  refresh(kpiId)
  return ok()
}

export async function moveArea(kpiId: string, id: string, direction: "up" | "down"): Promise<ActionResult> {
  if (!(await canManage())) return fail(NO_PERMISSION)
  const supabase = await createClient()
  const { data: siblings } = await supabase.from("kpi_areas").select("id").eq("kpi_id", kpiId).order("sort_order").order("name")
  const order = ((siblings ?? []) as { id: string }[]).map((s) => s.id)
  const i = order.indexOf(id)
  const j = direction === "up" ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= order.length) return ok()
  ;[order[i], order[j]] = [order[j]!, order[i]!]
  for (const [index, rowId] of order.entries()) {
    const { error } = await supabase.from("kpi_areas").update({ sort_order: (index + 1) * 10 }).eq("id", rowId)
    if (error) return fromDbError(error)
  }
  refresh(kpiId)
  return ok()
}

// -----------------------------------------------------------------------------
// Assignments
// -----------------------------------------------------------------------------

function refreshAssignments(id?: string) {
  revalidatePath("/", "layout")
  if (id) revalidatePath(`/kpis/assignments/${id}`)
}

export async function assignKpi(input: AssignInput): Promise<ActionResult<{ created: number }>> {
  await requireAppContext()
  const parsed = assignSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("assign_kpi", {
    p_kpi: v.kpiId,
    p_user_ids: v.userIds,
    p_start: v.startDate,
    p_end: v.endDate,
    p_reviewer_ids: v.reviewerId ? [v.reviewerId] : null,
    p_backfill: v.backfill,
    p_scorer: v.scorerId,
  })
  if (error) return fromDbError(error)
  refreshAssignments()
  return ok({ created: (data as number) ?? 0 })
}

export async function setAssignmentStatus(id: string, active: boolean): Promise<ActionResult<{ created: number }>> {
  await requireAppContext()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("set_kpi_assignment_status", { p_assignment: id, p_active: active })
  if (error) return fromDbError(error)
  refreshAssignments(id)
  return ok({ created: (data as number) ?? 0 })
}

export async function renewAssignments(ids: string[], start: string, end: string): Promise<ActionResult<{ created: number }>> {
  await requireAppContext()
  const dates = z.object({ start: z.iso.date(), end: z.iso.date() }).safeParse({ start, end })
  if (!dates.success || end < start) return fail("Enter a start date and an end date after it.")
  if (ids.length === 0) return fail("Choose the assignments to renew.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("renew_kpi_assignments", { p_assignments: ids, p_start: start, p_end: end })
  if (error) return fromDbError(error)
  refreshAssignments()
  return ok({ created: (data as number) ?? 0 })
}

export async function pushKpiUpdates(ids: string[]): Promise<ActionResult<{ added: number }>> {
  await requireAppContext()
  const supabase = await createClient()
  let added = 0
  for (const id of ids) {
    const { data, error } = await supabase.rpc("push_kpi_updates", { p_assignment: id })
    if (error) return fromDbError(error)
    added += (data as number) ?? 0
  }
  refreshAssignments(ids.length === 1 ? ids[0] : undefined)
  return ok({ added })
}

/** The scorer or HR. Hiding scores again is HR only (the database checks). */
export async function setScoresReleased(ids: string[], released: boolean): Promise<ActionResult> {
  await requireAppContext()
  if (ids.length === 0) return fail("Choose the assignments first.")
  const supabase = await createClient()
  for (const id of ids) {
    const { error } = await supabase.rpc("set_kpi_scores_released", { p_assignment: id, p_released: released })
    if (error) return fromDbError(error)
  }
  refreshAssignments(ids.length === 1 ? ids[0] : undefined)
  return ok()
}

export async function changeReviewer(id: string, reviewerId: string): Promise<ActionResult> {
  await requireAppContext()
  const supabase = await createClient()
  const { error } = await supabase.rpc("change_kpi_reviewer", { p_assignment: id, p_reviewer: reviewerId })
  if (error) return fromDbError(error)
  refreshAssignments(id)
  return ok()
}

export async function changeScorer(id: string, scorerId: string): Promise<ActionResult> {
  await requireAppContext()
  const supabase = await createClient()
  const { error } = await supabase.rpc("change_kpi_scorer", { p_assignment: id, p_scorer: scorerId })
  if (error) return fromDbError(error)
  refreshAssignments(id)
  return ok()
}

// -----------------------------------------------------------------------------
// The person: fill in a period
// -----------------------------------------------------------------------------

/** Autosaved draft. Does not revalidate, so typing never re-renders the page. */
export async function saveEntry(id: string, details: string): Promise<ActionResult> {
  await requireAppContext()
  const supabase = await createClient()
  const { error } = await supabase.rpc("save_kpi_entry", { p_entry: id, p_details: details.slice(0, 10000) })
  return error ? fromDbError(error) : ok()
}

export async function submitEntries(input: EntrySubmitInput): Promise<ActionResult<{ submitted: number }>> {
  await requireAppContext()
  const parsed = entrySubmitSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]!.message)
  const supabase = await createClient()
  for (const e of parsed.data) {
    const { error } = await supabase.rpc("save_kpi_entry", { p_entry: e.id, p_details: e.details })
    if (error) return fromDbError(error)
  }
  const { data, error } = await supabase.rpc("submit_kpi_entries", { p_entries: parsed.data.map((e) => e.id) })
  if (error) return fromDbError(error)
  refreshAssignments()
  return ok({ submitted: (data as number) ?? 0 })
}

/** Only the assigned person, while the period is still theirs to edit. */
async function loadEditableEntry(entryId: string) {
  const supabase = await createClient()
  const [ctx, { data }] = await Promise.all([
    requireAppContext(),
    supabase.from("kpi_entries").select("id, status, assignment:kpi_assignments(id, user_id, status, department_id)").eq("id", entryId).maybeSingle(),
  ])
  const row = data as unknown as { id: string; status: string; assignment: { id: string; user_id: string; status: string; department_id: string } } | null
  if (!row) return fail("KPI period not found.")
  if (row.assignment.user_id !== ctx.user.id) return fail("Only the assigned person can fill in this KPI.")
  if (row.assignment.status !== "active" || !["open", "changes_requested"].includes(row.status)) return fail("This period can no longer be changed.")
  return ok({ entryId: row.id, assignmentId: row.assignment.id, departmentId: row.assignment.department_id, actorId: ctx.user.id })
}

export async function requestEvidenceUpload(entryId: string, fileName: string, sizeBytes: number): Promise<ActionResult<{ path: string; token: string; contentType: string }>> {
  const entry = await loadEditableEntry(entryId)
  if (!entry.ok) return entry
  const file = checkUploadRequest(fileName, sizeBytes)
  if (!file.ok) return file
  const path = `${entry.data.departmentId}/kpi/${entry.data.entryId}/${randomUUID()}.${file.data.ext}`
  const { data, error } = await createAdminClient().storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return fail(`Could not start the upload: ${error?.message ?? "unknown error"}`)
  return ok({ path, token: data.token, contentType: file.data.mime })
}

export async function finalizeEvidenceUpload(entryId: string, path: string, originalFilename: string): Promise<ActionResult> {
  const entry = await loadEditableEntry(entryId)
  if (!entry.ok) return entry
  if (!path.startsWith(`${entry.data.departmentId}/kpi/${entry.data.entryId}/`)) return fail("Invalid upload.")
  const verified = await verifyStoredUpload(path, originalFilename)
  if (!verified.ok) return verified
  const admin = createAdminClient()
  const { error } = await admin.rpc("record_kpi_entry_file", {
    p_actor: entry.data.actorId,
    p_entry: entryId,
    p_storage_path: path,
    p_original_filename: originalFilename.slice(0, 255),
    p_file_format: verified.data.file.format,
    p_mime_type: verified.data.file.mime,
    p_size_bytes: verified.data.sizeBytes,
    p_sha256: verified.data.sha256,
  })
  if (error) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([path])
    return fromDbError(error)
  }
  refreshAssignments(entry.data.assignmentId)
  return ok()
}

export type RepositoryPick = { id: string; name: string; referenceId: string | null; department: string; status: string }

/** Documents the person can already see, that have a file. KPI records never appear. */
export async function searchRepository(q: string): Promise<ActionResult<RepositoryPick[]>> {
  await requireAppContext()
  const rows = await searchDocuments(q, {}, 25)
  return ok(
    rows
      .filter((d) => d.currentVersion && !d.kpi)
      .map((d) => ({
        id: d.id,
        name: d.name,
        referenceId: d.referenceId,
        department: d.department.name,
        status: d.status,
      }))
  )
}

export async function attachRepositoryFile(entryId: string, documentId: string): Promise<ActionResult> {
  await requireAppContext()
  const supabase = await createClient()
  const { error } = await supabase.rpc("attach_repository_file", { p_entry: entryId, p_document: documentId })
  if (error) return fromDbError(error)
  refreshAssignments()
  return ok()
}

/** RLS allows it only while the period is still the person's to edit. */
export async function removeEvidenceFile(fileId: string): Promise<ActionResult> {
  await requireAppContext()
  const supabase = await createClient()
  const { data, error } = await supabase.from("kpi_entry_files").delete().eq("id", fileId).select("source, storage_path")
  if (error) return fromDbError(error)
  const removed = (data ?? [])[0] as { source: string; storage_path: string } | undefined
  if (!removed) return fail("This file can no longer be removed.")
  // Repository files stay in storage: the document still uses them.
  if (removed.source === "upload") await createAdminClient().storage.from(DOCUMENTS_BUCKET).remove([removed.storage_path])
  refreshAssignments()
  return ok()
}

/** RLS: only returns the file if the viewer can see the assignment. Logged in the audit trail. */
export async function getEvidenceFileUrl(fileId: string, mode: "view" | "download"): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient()
  const [ctx, { data: file }] = await Promise.all([
    requireAppContext(),
    supabase.from("kpi_entry_files").select("id, storage_path, original_filename").eq("id", fileId).maybeSingle(),
  ])
  if (mode === "download" && !hasPerm(ctx, "document.download")) return fail("You do not have permission to download documents.")
  if (!file) return fail("File not found.")
  const { data, error } = await createAdminClient()
    .storage.from(DOCUMENTS_BUCKET)
    .createSignedUrl(file.storage_path as string, 60, mode === "download" ? { download: file.original_filename as string } : undefined)
  if (error || !data) return fail("Could not open the file.")
  await supabase.rpc("log_kpi_file_access", { p_file: file.id, p_action: mode })
  return ok({ url: data.signedUrl })
}

// -----------------------------------------------------------------------------
// The reviewer approves or sends back; the scorer scores
// -----------------------------------------------------------------------------

/** Approves a submitted period, or forwards a missed one. Either way it goes to the scorer. */
export async function approveEntry(id: string, comment: string): Promise<ActionResult> {
  await requireAppContext()
  const supabase = await createClient()
  const { error } = await supabase.rpc("approve_kpi_entry", { p_entry: id, p_comment: comment })
  if (error) return fromDbError(error)
  refreshAssignments()
  return ok()
}

export async function scoreEntry(id: string, score: number, comment: string): Promise<ActionResult> {
  await requireAppContext()
  const parsed = scoreSchema.safeParse({ score, comment })
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await createClient()
  const { error } = await supabase.rpc("score_kpi_entry", { p_entry: id, p_score: parsed.data.score, p_comment: parsed.data.comment })
  if (error) return fromDbError(error)
  refreshAssignments()
  return ok()
}

export async function returnEntry(id: string, comment: string): Promise<ActionResult> {
  await requireAppContext()
  const supabase = await createClient()
  const { error } = await supabase.rpc("return_kpi_entry", { p_entry: id, p_comment: comment })
  if (error) return fromDbError(error)
  refreshAssignments()
  return ok()
}

export async function markEntryNotApplicable(id: string, reason: string): Promise<ActionResult> {
  await requireAppContext()
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_kpi_entry_not_applicable", { p_entry: id, p_reason: reason })
  if (error) return fromDbError(error)
  refreshAssignments()
  return ok()
}

export async function reopenEntry(id: string): Promise<ActionResult> {
  await requireAppContext()
  const supabase = await createClient()
  const { error } = await supabase.rpc("reopen_kpi_entry", { p_entry: id })
  if (error) return fromDbError(error)
  refreshAssignments()
  return ok()
}
