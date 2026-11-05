import "server-only"
import { APP_TIMEZONE } from "@/lib/config"
import type { BarDatum } from "@/components/charts/bar-list"
import type { ActivityPoint } from "@/components/charts/activity-chart"
import { createClient } from "@/lib/supabase/server"
import { listAudit, buildLookups } from "@/lib/data/audit"
import type { AuditCategory } from "@/lib/audit"

// All aggregates run as the caller (SECURITY INVOKER), so they only count what RLS shows them.

export async function countsByDepartment(): Promise<BarDatum[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("document_counts_by_department")
  return ((data ?? []) as { department_id: string; code: string; name: string; total: number; approved: number }[]).map((r) => ({
    key: r.department_id,
    label: r.name,
    value: Number(r.total),
    detail: `${Number(r.approved)} approved`,
    href: `/repository/${r.code}`,
  }))
}

export async function countsByType(departmentId?: string): Promise<BarDatum[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("document_counts_by_type", { p_department_id: departmentId ?? null })
  return ((data ?? []) as { code: string; name: string; total: number }[]).map((r) => ({
    key: r.code,
    label: r.name === r.code ? r.code : `${r.code} — ${r.name}`,
    value: Number(r.total),
  }))
}

export async function departmentSummary(departmentId: string) {
  const supabase = await createClient()
  const { data } = await supabase.rpc("department_document_summary", { p_department_id: departmentId, p_tz: APP_TIMEZONE })
  const s = (data ?? {}) as Record<string, number>
  return {
    total: s.total ?? 0,
    pendingUpload: s.pending_upload ?? 0,
    changesRequested: s.changes_requested ?? 0,
    inReview: s.in_review ?? 0,
    approved: s.approved ?? 0,
    approvedThisMonth: s.approved_this_month ?? 0,
  }
}

export async function activitySeries(days = 30, departmentId?: string): Promise<ActivityPoint[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("activity_series", { p_days: days, p_department_id: departmentId ?? null, p_tz: APP_TIMEZONE })
  return ((data ?? []) as { day: string; uploads: number; approvals: number }[]).map((r) => ({
    day: r.day,
    uploads: Number(r.uploads),
    approvals: Number(r.approvals),
  }))
}

export async function recentDocumentIds(limit = 6): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("my_recent_documents", { p_limit: limit })
  return ((data ?? []) as { document_id: string }[]).map((r) => r.document_id)
}

/** Latest audit entries with names resolved, for dashboard feeds. */
export async function auditFeed(options: { departmentId?: string; category?: AuditCategory; limit?: number } = {}) {
  const { rows } = await listAudit({ departmentId: options.departmentId, category: options.category }, options.limit ?? 8)
  return { rows, lookups: await buildLookups(rows) }
}

export type Compliance = { total: number; done: number; inReview: number }

/** Recurring requirements of a department for the current week and month, and overdue count. */
export async function departmentCompliance(departmentId: string) {
  const supabase = await createClient()
  const { data } = await supabase.rpc("department_compliance", { p_department_id: departmentId })
  const c = (data ?? {}) as { week?: Record<string, number>; month?: Record<string, number>; overdue?: number }
  const part = (x?: Record<string, number>): Compliance => ({ total: x?.total ?? 0, done: x?.done ?? 0, inReview: x?.in_review ?? 0 })
  return { week: part(c.week), month: part(c.month), overdue: c.overdue ?? 0 }
}
