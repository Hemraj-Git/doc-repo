import { NextResponse, type NextRequest } from "next/server"
import { hasPerm } from "@/lib/auth/permissions"
import { getAppContext } from "@/lib/auth/session"
import { listVerifications } from "@/lib/data/students"
import { formatDateTime } from "@/lib/format"
import { VERIFICATION_OUTCOME_LABELS } from "@/lib/students"
import { parseVerificationFilters } from "../filters"

const MAX_ROWS = 20_000
const PAGE = 1000

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV export of the verification log with the page's filters. */
export async function GET(request: NextRequest) {
  const ctx = await getAppContext()
  if (!ctx || !ctx.user.isActive) return new NextResponse("Not signed in", { status: 401 })
  if (!hasPerm(ctx, "verification.view_log")) return new NextResponse("Forbidden", { status: 403 })

  const filters = parseVerificationFilters((k) => request.nextUrl.searchParams.get(k) ?? undefined)
  // PostgREST returns at most 1000 rows per request: page through.
  const rows: Awaited<ReturnType<typeof listVerifications>> = []
  while (rows.length < MAX_ROWS) {
    const page = await listVerifications(filters, PAGE, rows.length)
    rows.push(...page)
    if (page.length < PAGE) break
  }
  const header = [
    "Verification ID",
    "When (institute time)",
    "When (UTC)",
    "Via",
    "Outcome",
    "Requester",
    "Organisation",
    "Email",
    "Purpose",
    "Regd No. entered",
    "Name entered",
    "Certificate No.",
    "Matched student",
    "Matched Regd No.",
  ]
  const lines = [header.join(",")]
  for (const v of rows) {
    lines.push(
      [
        v.code,
        formatDateTime(v.createdAt),
        v.createdAt,
        v.kind === "form" ? "Portal" : "QR scan",
        VERIFICATION_OUTCOME_LABELS[v.outcome] ?? v.outcome,
        v.requesterName,
        v.requesterOrg,
        v.requesterEmail,
        v.purpose,
        v.inputRegdNo,
        v.inputName,
        v.inputCertificateNo ?? v.certificateNo,
        v.student?.fullName,
        v.student?.regdNo,
      ]
        .map(csvCell)
        .join(",")
    )
  }
  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(`﻿${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="verifications-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  })
}
