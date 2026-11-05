import type { Metadata } from "next"
import Link from "next/link"
import { CheckCircle2, SearchX, ShieldAlert, XCircle } from "lucide-react"
import { formatDate, formatDateTime } from "@/lib/format"
import { checkCertificate } from "@/lib/verification/slips"
import { CertificateStatusBadge, StudentSummary } from "../../verification-details"

export const metadata: Metadata = { title: "Certificate check" }
export const dynamic = "force-dynamic"

/** Opened from the QR code printed on a certificate. */
export default async function CertificateCheckPage({ params }: PageProps<"/verify/c/[token]">) {
  const { token } = await params
  const check = await checkCertificate(token)

  if (check.outcome !== "matched" || !check.snapshot) {
    const limited = check.outcome === "rate_limited"
    const Icon = limited ? ShieldAlert : SearchX
    return (
      <section className="flex items-start gap-3 rounded-xl border bg-card p-6">
        <Icon className="mt-0.5 size-6 shrink-0 text-warning-text" />
        <div>
          <h1 className="font-semibold">{limited ? "Too many requests" : "This certificate link is not valid"}</h1>
          <p className="text-sm text-muted-foreground">
            {limited
              ? "Please try again later."
              : "The QR code or link does not match any certificate we have issued. The certificate may not be genuine."}{" "}
            You can also <Link href="/verify" className="text-primary hover:underline">verify by registration number</Link>.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Reference {check.code}</p>
        </div>
      </section>
    )
  }

  const { certificate: c, student } = check.snapshot
  const valid = c.status === "issued"
  return (
    <div className="space-y-6">
      <section className={`flex items-start gap-3 rounded-xl border bg-card p-6 ${valid ? "border-success-line" : "border-danger-line"}`}>
        {valid ? <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success-text" /> : <XCircle className="mt-0.5 size-6 shrink-0 text-danger-text" />}
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">{valid ? "Valid certificate" : c.status === "replaced" ? "This certificate was replaced" : "This certificate was revoked"}</h1>
          <p className="text-sm">
            {c.type} · <span className="font-mono">{c.certificate_no}</span> · issued {formatDate(c.issue_date)}
            {c.academic_year ? ` · ${c.academic_year}` : ""}
            {c.semester ? ` · Semester ${c.semester}` : ""}
            {c.result ? ` · ${c.result}` : ""}
          </p>
          <CertificateStatusBadge c={c} />
          {c.replaced_by && <p className="text-sm text-muted-foreground">Replaced by certificate {c.replaced_by}.</p>}
          <p className="text-xs text-muted-foreground">
            Checked {formatDateTime(check.createdAt)} · reference {check.code}
          </p>
        </div>
      </section>
      <section className="rounded-xl border bg-card p-6">
        <h2 className="mb-3 text-sm font-medium">Issued to</h2>
        <StudentSummary student={student} />
        <p className="mt-4 text-xs text-muted-foreground">
          Need a verification slip for your records? <Link href="/verify" className="text-primary hover:underline">Verify this student</Link> with their
          registration number and name.
        </p>
      </section>
    </div>
  )
}
