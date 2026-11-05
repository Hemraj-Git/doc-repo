import "server-only"
import { APP_TIMEZONE } from "@/lib/config"
import { AUDIT_CATEGORIES, type AuditCategory, type AuditEntry, type AuditLookups } from "@/lib/audit"
import { createClient } from "@/lib/supabase/server"

export type AuditFilters = {
  departmentId?: string
  category?: AuditCategory
  actorId?: string
  /** YYYY-MM-DD, inclusive, in the institute's timezone. */
  from?: string
  to?: string
  /** Keyset pagination: only rows with id < before. */
  before?: number
}

type Row = {
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
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f-]{36}$/

/** Reads audit filters from page or route search params; unknown values are ignored. */
export function parseAuditFilters(get: (key: string) => string | undefined): AuditFilters {
  const v = (k: string) => {
    const x = get(k)?.trim()
    return x ? x : undefined
  }
  const category = v("category")
  const before = Number(v("before"))
  return {
    departmentId: UUID.test(v("dept") ?? "") ? v("dept") : undefined,
    category: category && category in AUDIT_CATEGORIES ? (category as AuditCategory) : undefined,
    actorId: UUID.test(v("actor") ?? "") ? v("actor") : undefined,
    from: DAY.test(v("from") ?? "") ? v("from") : undefined,
    to: DAY.test(v("to") ?? "") ? v("to") : undefined,
    before: Number.isInteger(before) && before > 0 ? before : undefined,
  }
}

/** Start of a local calendar day as an ISO instant, e.g. 2026-10-20 → 2026-10-19T18:30:00Z for IST. */
function localDayStart(day: string) {
  const probe = new Date(`${day}T00:00:00Z`)
  const local = new Date(probe.toLocaleString("en-US", { timeZone: APP_TIMEZONE }))
  const offsetMs = local.getTime() - new Date(probe.toLocaleString("en-US", { timeZone: "UTC" })).getTime()
  return new Date(probe.getTime() - offsetMs).toISOString()
}

const nextDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Audit rows visible to the caller (RLS: audit permissions, own actions, documents they can see). */
export async function listAudit(filters: AuditFilters, limit = 50): Promise<{ rows: AuditEntry[]; nextBefore: number | null }> {
  const supabase = await createClient()
  let q = supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, department_id, created_at, actor_id, before, after, meta")
    .order("id", { ascending: false })
    .limit(limit + 1)

  if (filters.departmentId) q = q.eq("department_id", filters.departmentId)
  if (filters.category) q = q.in("entity_type", [...AUDIT_CATEGORIES[filters.category].entityTypes])
  if (filters.actorId) q = q.eq("actor_id", filters.actorId)
  if (filters.from) q = q.gte("created_at", localDayStart(filters.from))
  if (filters.to) q = q.lt("created_at", localDayStart(nextDay(filters.to)))
  if (filters.before) q = q.lt("id", filters.before)

  const { data, error } = await q
  if (error) throw new Error(`Could not load the audit log: ${error.message}`)
  const rows = ((data ?? []) as Row[]).map(toEntry)
  const hasMore = rows.length > limit
  return { rows: rows.slice(0, limit), nextBefore: hasMore ? rows[limit - 1]!.id : null }
}

function toEntry(r: Row): AuditEntry {
  return {
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
  }
}

const ID_FIELDS = ["head_user_id", "reports_to_id", "user_id", "assigned_uploader_id", "created_by"]
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v)

/** Resolves every person, role, document and department id referenced by the rows. */
export async function buildLookups(rows: AuditEntry[]): Promise<AuditLookups> {
  const people = new Set<string>()
  const roles = new Set<string>()
  const documents = new Set<string>()
  for (const r of rows) {
    if (r.actorId) people.add(r.actorId)
    for (const side of [r.before, r.after]) {
      if (!side) continue
      for (const f of ID_FIELDS) if (isUuid(side[f])) people.add(side[f] as string)
      if (isUuid(side.role_id)) roles.add(side.role_id as string)
    }
    if (r.entityType === "user" && isUuid(r.entityId)) people.add(r.entityId)
    if (isUuid(r.meta?.to_user_id)) people.add(r.meta.to_user_id as string)
    if (r.entityType.startsWith("document") && r.entityType !== "document_type" && isUuid(r.entityId)) documents.add(r.entityId)
  }

  const supabase = await createClient()
  const [p, ro, d, dep] = await Promise.all([
    people.size ? supabase.from("profiles").select("id, full_name").in("id", [...people]) : null,
    roles.size ? supabase.from("roles").select("id, name").in("id", [...roles]) : null,
    documents.size ? supabase.from("documents").select("id, name").in("id", [...documents]) : null,
    supabase.from("departments").select("id, name, code"),
  ])

  return {
    people: Object.fromEntries(((p?.data ?? []) as { id: string; full_name: string }[]).map((x) => [x.id, x.full_name])),
    roles: Object.fromEntries(((ro?.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name])),
    documents: Object.fromEntries(((d?.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name])),
    departments: Object.fromEntries(
      ((dep.data ?? []) as { id: string; name: string; code: string }[]).map((x) => [x.id, { name: x.name, code: x.code }])
    ),
  }
}
