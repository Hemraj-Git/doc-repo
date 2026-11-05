import "server-only"
import { cache } from "react"
import type { AuditEntry } from "@/lib/audit"
import { buildLookups } from "@/lib/data/audit"
import { createClient } from "@/lib/supabase/server"
import type { AppContext } from "@/lib/auth/session"
import type { DocumentStatus, ReviewState } from "@/lib/documents"
import type { FileFormat } from "@/lib/files"
import type { Recurrence } from "@/lib/templates"

export type DocumentListRow = {
  id: string
  name: string
  referenceId: string | null
  status: DocumentStatus
  type: { code: string; name: string }
  uploader: { id: string; fullName: string }
  department: { id: string; code: string; name: string }
  folder: { id: string; name: string; level: "root" | "child" | "sub" }
  currentVersion: { versionNo: number; uploadedAt: string } | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
  createdBy: string
  /** Set for requirements created by a recurring series. */
  series: { id: string; name: string; recurrence: Exclude<Recurrence, "once"> } | null
  period: { label: string; start: string; end: string } | null
  /** The template instance (program, subject…) the document belongs to. */
  instanceName: string | null
  /** KPI evidence: the assignment it belongs to. */
  kpi: { assignmentId: string; name: string } | null
  /** Uploaded straight into a folder, with no requirement behind it. */
  isDirect: boolean
  /** A direct upload that was never reviewed, so "Approved" would be wrong. */
  unreviewed: boolean
}

type ListDb = {
  id: string
  name: string
  reference_id: string | null
  status: DocumentStatus
  due_date: string | null
  created_at: string
  updated_at: string
  created_by: string
  is_direct: boolean
  review_round: number
  document_type: { code: string; name: string }
  uploader: { id: string; full_name: string }
  department: { id: string; code: string; name: string }
  folder: { id: string; name: string; level: "root" | "child" | "sub" }
  current_version: { version_no: number; uploaded_at: string } | null
  series_id: string | null
  period_label: string | null
  period_start: string | null
  period_end: string | null
  series: { name: string; recurrence: Exclude<Recurrence, "once"> } | null
  instance: { name: string } | null
  kpi: { id: string; kpi_name: string } | null
}

const LIST_COLUMNS = [
  "id, name, reference_id, status, due_date, created_at, updated_at, created_by, is_direct, review_round, series_id, period_label, period_start, period_end",
  "series:recurring_series(name, recurrence)",
  "instance:template_instances(name)",
  "kpi:kpi_assignments!documents_kpi_assignment_id_fkey(id, kpi_name)",
  "document_type:document_types(code, name)",
  "uploader:profiles!documents_assigned_uploader_id_fkey(id, full_name)",
  "department:departments(id, code, name)",
  "folder:folders(id, name, level)",
  "current_version:document_versions!documents_current_version_fkey(version_no, uploaded_at)",
].join(", ")

function toListRow(d: ListDb): DocumentListRow {
  return {
    id: d.id,
    name: d.name,
    referenceId: d.reference_id,
    status: d.status,
    type: d.document_type,
    uploader: { id: d.uploader.id, fullName: d.uploader.full_name },
    department: d.department,
    // Reviewers from another department may not see the folder itself.
    folder: d.folder ?? { id: "", name: "—", level: "sub" },
    currentVersion: d.current_version
      ? { versionNo: d.current_version.version_no, uploadedAt: d.current_version.uploaded_at }
      : null,
    dueDate: d.due_date,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    createdBy: d.created_by,
    series: d.series_id && d.series ? { id: d.series_id, name: d.series.name, recurrence: d.series.recurrence } : null,
    period: d.period_label && d.period_start && d.period_end ? { label: d.period_label, start: d.period_start, end: d.period_end } : null,
    instanceName: d.instance?.name ?? null,
    kpi: d.kpi ? { assignmentId: d.kpi.id, name: d.kpi.kpi_name } : null,
    isDirect: d.is_direct,
    unreviewed: d.is_direct && d.review_round === 0,
  }
}

async function query(build: (q: ReturnType<typeof base>) => unknown, what: string): Promise<DocumentListRow[]> {
  const res = (await build(base(await createClient()))) as { data: unknown; error: { message: string } | null }
  if (res.error) throw new Error(`Could not load ${what}: ${res.error.message}`)
  return ((res.data ?? []) as ListDb[]).map(toListRow)
}

function base(supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase.from("documents").select(LIST_COLUMNS)
}

/** Most recently approved documents the user may see. */
export function listRecentlyApproved(limit = 6) {
  return query((q) => q.eq("status", "approved").order("updated_at", { ascending: false }).limit(limit), "approved documents")
}

/** Documents by id, in the given order (ids the user cannot see are dropped). */
export async function listDocumentsByIds(ids: string[]) {
  if (ids.length === 0) return []
  const rows = await query((q) => q.in("id", ids), "documents")
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter((r): r is DocumentListRow => Boolean(r))
}

/** Documents in a folder that the signed-in user may see (RLS decides). */
export function listFolderDocuments(folderId: string) {
  return query((q) => q.eq("folder_id", folderId).order("name"), "documents")
}

/** One page of a list: the first `limit` rows, and whether there are more. */
export type Page<T> = { rows: T[]; hasMore: boolean }

/** Lists fetch limit + 1 rows, so the extra one tells the page to offer "Show more". */
function toPage<T>(rows: T[], limit?: number): Page<T> {
  return limit && rows.length > limit ? { rows: rows.slice(0, limit), hasMore: true } : { rows, hasMore: false }
}

type Limitable = { limit: (n: number) => unknown }

async function paged(build: (q: ReturnType<typeof base>) => unknown, what: string, limit?: number) {
  const rows = await query((q) => (limit ? (build(q) as Limitable).limit(limit + 1) : build(q)), what)
  return toPage(rows, limit)
}

/** my_documents() / shared_documents(): RLS-checked document sets too large to pass as id lists. */
async function pagedRpc(fn: "my_documents" | "shared_documents", what: string, limit?: number) {
  const supabase = await createClient()
  const q = supabase.rpc(fn).select(LIST_COLUMNS).order("updated_at", { ascending: false }).order("due_date", { ascending: true, nullsFirst: false }).order("name")
  const { data, error } = await (limit ? q.limit(limit + 1) : q)
  if (error) throw new Error(`Could not load ${what}: ${error.message}`)
  return toPage(((data ?? []) as unknown as ListDb[]).map(toListRow), limit)
}

/** Documents the user uploads, reviews or created, most recently updated first. */
export function listMyDocuments(limit?: number) {
  return pagedRpc("my_documents", "your documents", limit)
}

/** HOD: every document in the department. Senior: documents assigned to people below them. */
export async function listTeamDocuments(ctx: AppContext, limit?: number): Promise<Page<DocumentListRow>> {
  if (ctx.isHod) {
    return paged((q) => q.eq("department_id", ctx.department.id).order("updated_at", { ascending: false }).order("due_date", { ascending: true, nullsFirst: false }).order("name"), "team documents", limit)
  }
  const supabase = await createClient()
  const { data } = await supabase.rpc("my_subordinate_ids")
  const ids = ((data ?? []) as string[]).filter(Boolean)
  if (ids.length === 0) return { rows: [], hasMore: false }
  return paged((q) => q.in("assigned_uploader_id", ids).order("updated_at", { ascending: false }).order("due_date", { ascending: true, nullsFirst: false }).order("name"), "team documents", limit)
}

/** Documents of other departments where the user uploads or reviews. */
export function listSharedDocuments(limit?: number) {
  return pagedRpc("shared_documents", "shared documents", limit)
}

const CLOSED_STATUSES = ["approved", "not_applicable"]

/**
 * Requirements the user created, or (with create rights) all in their scope.
 * Open ones oldest first; with `state: "closed"`, the most recently closed first.
 */
export function listRequirements(ctx: AppContext, opts: { state?: "open" | "closed"; limit?: number } = {}) {
  const anyDept = ctx.permissions.includes("document.create.any_dept")
  const ownDept = ctx.permissions.includes("document.create.own_dept")
  return paged(
    (q) => {
      let scoped = anyDept ? q : ownDept ? q.or(`department_id.eq.${ctx.department.id},created_by.eq.${ctx.user.id}`) : q.eq("created_by", ctx.user.id)
      if (opts.state === "open") scoped = scoped.not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
      if (opts.state === "closed") scoped = scoped.in("status", CLOSED_STATUSES)
      return opts.state === "closed" ? scoped.order("updated_at", { ascending: false }) : scoped.order("created_at", { ascending: true })
    },
    "requirements",
    opts.limit
  )
}

/** Strips characters that have meaning in PostgREST filter syntax. */
export function sanitizeSearch(q: string) {
  return q.replace(/[,()*%\\:"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100)
}

export type SearchFilters = { status?: string; typeId?: string; departmentId?: string }

/** Documents whose name or Reference ID contains q, among those the user may see. */
export function searchDocuments(q: string, f: SearchFilters = {}, limit = 50) {
  const term = sanitizeSearch(q)
  return query((b) => {
    let x = term ? b.or(`name.ilike.*${term}*,reference_id.ilike.*${term}*`) : b
    if (f.status) x = x.eq("status", f.status)
    if (f.typeId) x = x.eq("document_type_id", f.typeId)
    if (f.departmentId) x = x.eq("department_id", f.departmentId)
    return x.order("updated_at", { ascending: false }).limit(limit)
  }, "search results")
}

export type FolderHit = {
  id: string
  name: string
  referenceId: string | null
  level: "child" | "sub"
  department: { code: string; name: string }
}

export async function searchFolders(q: string, departmentId?: string, limit = 30): Promise<FolderHit[]> {
  const term = sanitizeSearch(q)
  const supabase = await createClient()
  let x = supabase
    .from("folders")
    .select("id, name, reference_id, level, department:departments(code, name)")
    .neq("level", "root")
    .eq("is_private", false)
    .or(`name.ilike.*${term}*,reference_id.ilike.*${term}*`)
  if (departmentId) x = x.eq("department_id", departmentId)
  const { data, error } = await x.order("name").limit(limit)
  if (error) throw new Error(`Could not search folders: ${error.message}`)
  return ((data ?? []) as unknown as {
    id: string
    name: string
    reference_id: string | null
    level: "child" | "sub"
    department: { code: string; name: string }
  }[]).map((f) => ({ id: f.id, name: f.name, referenceId: f.reference_id, level: f.level, department: f.department }))
}

// -----------------------------------------------------------------------------
// Tasks
// -----------------------------------------------------------------------------

export type ReviewTask = {
  stepId: string
  stepOrder: number
  totalSteps: number
  activatedAt: string
  document: DocumentListRow
}

export async function listUploadTasks(ctx: AppContext) {
  return query(
    (q) =>
      q
        .eq("assigned_uploader_id", ctx.user.id)
        .in("status", ["pending_upload", "changes_requested"])
        .order("created_at", { ascending: true }),
    "upload tasks"
  )
}

export async function listReviewTasks(ctx: AppContext): Promise<ReviewTask[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("document_review_steps")
    .select("id, step_order, activated_at, version_id, document_id")
    .eq("reviewer_id", ctx.user.id)
    .eq("state", "active")
    .order("activated_at", { ascending: true })
  if (error) throw new Error(`Could not load review tasks: ${error.message}`)
  const steps = (data ?? []) as { id: string; step_order: number; activated_at: string; version_id: string; document_id: string }[]
  if (steps.length === 0) return []

  const [docs, totals] = await Promise.all([
    query((q) => q.in("id", steps.map((s) => s.document_id)), "review tasks"),
    supabase.from("document_review_steps").select("version_id").in("version_id", steps.map((s) => s.version_id)),
  ])
  const byId = new Map(docs.map((d) => [d.id, d]))
  const countByVersion = new Map<string, number>()
  for (const r of (totals.data ?? []) as { version_id: string }[]) {
    countByVersion.set(r.version_id, (countByVersion.get(r.version_id) ?? 0) + 1)
  }
  return steps
    .filter((s) => byId.has(s.document_id))
    .map((s) => ({
      stepId: s.id,
      stepOrder: s.step_order,
      totalSteps: countByVersion.get(s.version_id) ?? s.step_order,
      activatedAt: s.activated_at,
      document: byId.get(s.document_id)!,
    }))
}

export type TaskCounts = {
  toUpload: number
  changesRequested: number
  overdue: number
  toReview: number
  approved: number
  kpiToFill: number
  kpiOverdue: number
  kpiToReview: number
  kpiToScore: number
  unreadNotifications: number
}

export const getTaskCounts = cache(async (): Promise<TaskCounts> => {
  const supabase = await createClient()
  const { data } = await supabase.rpc("my_task_counts")
  const c = (data ?? {}) as Record<string, number>
  return {
    toUpload: c.to_upload ?? 0,
    changesRequested: c.changes_requested ?? 0,
    overdue: c.overdue ?? 0,
    toReview: c.to_review ?? 0,
    approved: c.approved ?? 0,
    kpiToFill: c.kpi_to_fill ?? 0,
    kpiOverdue: c.kpi_overdue ?? 0,
    kpiToReview: c.kpi_to_review ?? 0,
    kpiToScore: c.kpi_to_score ?? 0,
    unreadNotifications: c.unread_notifications ?? 0,
  }
})

// -----------------------------------------------------------------------------
// Document detail
// -----------------------------------------------------------------------------

export type VersionRow = {
  id: string
  versionNo: number
  originalFilename: string
  fileFormat: FileFormat
  sizeBytes: number
  sha256: string
  note: string | null
  uploadedAt: string
  uploadedBy: { id: string; fullName: string }
}

export type ReviewStepRow = {
  id: string
  round: number
  stepOrder: number
  state: ReviewState
  comment: string | null
  activatedAt: string | null
  decidedAt: string | null
  versionNo: number
  reviewer: { id: string; fullName: string }
}

export type DocumentDetail = DocumentListRow & {
  description: string | null
  notApplicable: { reason: string; at: string; by: string | null } | null
  requiresReview: boolean
  documentTypeId: string
  folderParent: { id: string; name: string } | null
  owner: { id: string; fullName: string } | null
  creator: { id: string; fullName: string } | null
  reviewers: { stepOrder: number; id: string; fullName: string; designation: string | null; departmentCode: string }[]
  versions: VersionRow[]
  steps: ReviewStepRow[]
}

export const getDocument = cache(async (id: string): Promise<DocumentDetail | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("documents")
    .select(
      [
        LIST_COLUMNS,
        "description, requires_review, document_type_id, not_applicable_reason, not_applicable_at",
        "na_by:profiles!documents_not_applicable_by_fkey(full_name)",
        "creator:profiles!documents_created_by_fkey(id, full_name)",
        "folder_full:folders(parent:parent_id(id, name))",
        "department_full:departments(head:profiles!departments_head_user_id_fkey(id, full_name))",
        "reviewers:document_reviewers(step_order, reviewer:profiles(id, full_name, designation, department:departments!profiles_department_id_fkey(code)))",
        "versions:document_versions!document_versions_document_id_fkey(id, version_no, original_filename, file_format, size_bytes, sha256, note, uploaded_at, uploader:profiles(id, full_name))",
        "steps:document_review_steps(id, round, step_order, state, comment, activated_at, decided_at, version:document_versions(version_no), reviewer:profiles(id, full_name))",
      ].join(", ")
    )
    .eq("id", id)
    .maybeSingle()
  if (error) {
    if (error.code === "22P02") return null
    throw new Error(`Could not load the document: ${error.message}`)
  }
  if (!data) return null

  const d = data as unknown as ListDb & {
    description: string | null
    not_applicable_reason: string | null
    not_applicable_at: string | null
    na_by: { full_name: string } | null
    requires_review: boolean
    document_type_id: string
    creator: { id: string; full_name: string } | null
    folder_full: { parent: { id: string; name: string } | null }
    department_full: { head: { id: string; full_name: string } | null }
    reviewers: { step_order: number; reviewer: { id: string; full_name: string; designation: string | null; department: { code: string } } }[]
    versions: {
      id: string
      version_no: number
      original_filename: string
      file_format: FileFormat
      size_bytes: number
      sha256: string
      note: string | null
      uploaded_at: string
      uploader: { id: string; full_name: string }
    }[]
    steps: {
      id: string
      round: number
      step_order: number
      state: ReviewState
      comment: string | null
      activated_at: string | null
      decided_at: string | null
      version: { version_no: number }
      reviewer: { id: string; full_name: string }
    }[]
  }

  return {
    ...toListRow(d),
    description: d.description,
    notApplicable:
      d.not_applicable_reason && d.not_applicable_at
        ? { reason: d.not_applicable_reason, at: d.not_applicable_at, by: d.na_by?.full_name ?? null }
        : null,
    requiresReview: d.requires_review,
    documentTypeId: d.document_type_id,
    folderParent: d.folder_full?.parent ?? null,
    owner: d.department_full?.head ? { id: d.department_full.head.id, fullName: d.department_full.head.full_name } : null,
    creator: d.creator ? { id: d.creator.id, fullName: d.creator.full_name } : null,
    reviewers: d.reviewers
      .sort((a, b) => a.step_order - b.step_order)
      .map((r) => ({
        stepOrder: r.step_order,
        id: r.reviewer.id,
        fullName: r.reviewer.full_name,
        designation: r.reviewer.designation,
        departmentCode: r.reviewer.department.code,
      })),
    versions: d.versions
      .sort((a, b) => b.version_no - a.version_no)
      .map((v) => ({
        id: v.id,
        versionNo: v.version_no,
        originalFilename: v.original_filename,
        fileFormat: v.file_format,
        sizeBytes: v.size_bytes,
        sha256: v.sha256,
        note: v.note,
        uploadedAt: v.uploaded_at,
        uploadedBy: { id: v.uploader.id, fullName: v.uploader.full_name },
      })),
    steps: d.steps
      .sort((a, b) => b.round - a.round || a.step_order - b.step_order)
      .map((s) => ({
        id: s.id,
        round: s.round,
        stepOrder: s.step_order,
        state: s.state,
        comment: s.comment,
        activatedAt: s.activated_at,
        decidedAt: s.decided_at,
        versionNo: s.version.version_no,
        reviewer: { id: s.reviewer.id, fullName: s.reviewer.full_name },
      })),
  }
})

/** The document's audit trail, newest first, with names resolved. */
export async function getDocumentActivity(documentId: string, limit = 200) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, department_id, created_at, actor_id, before, after, meta")
    .in("entity_type", ["document", "document_version", "document_reviewer", "document_review"]) // uses audit_logs_entity_idx
    .eq("entity_id", documentId)
    .order("id", { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Could not load activity: ${error.message}`)

  const rows: AuditEntry[] = (
    (data ?? []) as {
      id: number
      action: string
      entity_type: string
      entity_id: string | null
      department_id: string | null
      created_at: string
      actor_id: string | null
      before: Record<string, unknown> | null
      after: Record<string, unknown> | null
      meta: Record<string, unknown> | null
    }[]
  ).map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    departmentId: r.department_id,
    createdAt: r.created_at,
    actorId: r.actor_id,
    before: r.before,
    after: r.after,
    meta: r.meta,
  }))
  return { rows, lookups: await buildLookups(rows) }
}

// -----------------------------------------------------------------------------
// Notifications
// -----------------------------------------------------------------------------

export type NotificationRow = {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  readAt: string | null
  createdAt: string
}

export async function listNotifications(limit = 15): Promise<NotificationRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("notifications")
    .select("id, type, title, body, link, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)
  return ((data ?? []) as {
    id: string
    type: string
    title: string
    body: string | null
    link: string | null
    read_at: string | null
    created_at: string
  }[]).map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.read_at, createdAt: n.created_at }))
}
