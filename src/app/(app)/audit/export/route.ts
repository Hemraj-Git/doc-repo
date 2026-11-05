import { NextResponse, type NextRequest } from "next/server"
import { describeAudit, type AuditEntry } from "@/lib/audit"
import { hasPerm } from "@/lib/auth/permissions"
import { getAppContext } from "@/lib/auth/session"
import { buildLookups, listAudit, parseAuditFilters } from "@/lib/data/audit"
import { formatDateTime } from "@/lib/format"

const MAX_ROWS = 10_000
const PAGE = 500

const csvCell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV export of the audit log with the same filters as the page (RLS still applies). */
export async function GET(request: NextRequest) {
  const ctx = await getAppContext()
  if (!ctx || !ctx.user.isActive) return new NextResponse("Not signed in", { status: 401 })
  if (!hasPerm(ctx, "audit.view.own_dept", "audit.view.all")) return new NextResponse("Forbidden", { status: 403 })

  const filters = parseAuditFilters((k) => request.nextUrl.searchParams.get(k) ?? undefined)
  const rows: AuditEntry[] = []
  let before = filters.before
  while (rows.length < MAX_ROWS) {
    const page = await listAudit({ ...filters, before }, PAGE)
    rows.push(...page.rows)
    if (!page.nextBefore) break
    before = page.nextBefore
  }
  const lookups = await buildLookups(rows)

  const header = ["Entry", "When (institute time)", "When (UTC)", "Who", "What", "Department", "Area", "Action", "Entity ID", "Before", "After", "Details"]
  const lines = [header.join(",")]
  for (const r of rows) {
    lines.push(
      [
        r.id,
        formatDateTime(r.createdAt),
        r.createdAt,
        r.actorId ? (lookups.people[r.actorId] ?? r.actorId) : "System",
        describeAudit(r, lookups)?.text ?? `${r.entityType} ${r.action}`,
        r.departmentId ? (lookups.departments[r.departmentId]?.code ?? "") : "",
        r.entityType,
        r.action,
        r.entityId,
        r.before,
        r.after,
        r.meta,
      ]
        .map(csvCell)
        .join(",")
    )
  }

  const stamp = new Date().toISOString().slice(0, 10)
  // BOM so Excel opens UTF-8 (names, “quotes”) correctly.
  return new NextResponse(`﻿${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  })
}
