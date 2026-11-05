import type { Metadata } from "next"
import Link from "next/link"
import { BadgeCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { listVerifications } from "@/lib/data/students"
import { formatDateTime } from "@/lib/format"
import { VERIFICATION_OUTCOME_LABELS } from "@/lib/students"
import { parseVerificationFilters } from "./filters"
import { VerificationsToolbar } from "./verifications-toolbar"
import { EmptyState } from "@/components/empty-state"

export const metadata: Metadata = { title: "Verification Log" }

const OUTCOME_STYLES: Record<string, string> = {
  matched: "border-success-line bg-success-soft text-success-text",
  not_matched: "border-warning-line bg-warning-soft text-warning-text",
  rate_limited: "border-danger-line bg-danger-soft text-danger-text",
  captcha_failed: "border-border bg-muted text-muted-foreground",
}

export default async function VerificationsPage({ searchParams }: PageProps<"/admin/verifications">) {
  await requireNavAccess("/admin/verifications")
  const params = await searchParams
  const filters = parseVerificationFilters((k) => (typeof params[k] === "string" ? (params[k] as string) : undefined))
  const rows = await listVerifications(filters)

  return (
    <>
      <PageHeader
        title="Verification Log"
        description="Every request made on the public verification portal and every certificate QR scan — including failed ones. Requester IP addresses are stored only as a hash."
      />
      <VerificationsToolbar />
      {rows.length === 0 ? (
        <EmptyState icon={BadgeCheck}>
          <p className="font-medium">No verification requests match these filters</p>
        </EmptyState>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">When</TableHead>
                <TableHead>Verification ID</TableHead>
                <TableHead>Requester</TableHead>
                <TableHead>Entered</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Student</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{formatDateTime(v.createdAt)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {v.slipToken ? (
                      <Link href={`/verify/slip/${v.slipToken}`} target="_blank" className="hover:underline">
                        {v.code}
                      </Link>
                    ) : (
                      v.code
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {v.kind === "certificate_link" ? (
                      <span className="text-muted-foreground">QR scan</span>
                    ) : (
                      <>
                        <div>{v.requesterOrg}</div>
                        <div className="text-xs text-muted-foreground">
                          {v.requesterName} · {v.requesterEmail}
                          {v.purpose ? ` · ${v.purpose}` : ""}
                        </div>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {v.kind === "form" ? (
                      <>
                        <span className="font-mono">{v.inputRegdNo}</span> · {v.inputName}
                        {v.inputCertificateNo && <div className="font-mono text-muted-foreground">Cert {v.inputCertificateNo}</div>}
                      </>
                    ) : (
                      <span className="font-mono">{v.certificateNo ?? "—"}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={OUTCOME_STYLES[v.outcome]}>
                      {VERIFICATION_OUTCOME_LABELS[v.outcome] ?? v.outcome}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {v.student ? (
                      <Link href={`/students/${v.student.id}`} className="hover:underline">
                        {v.student.fullName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {rows.length === 200 && <p className="mt-2 text-xs text-muted-foreground">Showing the latest 200. Narrow the dates or export to see more.</p>}
    </>
  )
}
