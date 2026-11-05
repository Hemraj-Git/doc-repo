import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { BadgeCheck, Download } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { formatDateTime } from "@/lib/format"
import { getSlip } from "@/lib/verification/slips"
import { CertificateList, StudentSummary } from "../../verification-details"

export const metadata: Metadata = { title: "Verification slip" }

/** Confirms a verification slip is genuine: shown from the stored record, never from the PDF. */
export default async function SlipPage({ params }: PageProps<"/verify/slip/[token]">) {
  const { token } = await params
  const slip = await getSlip(token)
  if (!slip) notFound()

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-emerald-600/30 bg-background p-6">
        <div className="flex items-start gap-3">
          <BadgeCheck className="mt-0.5 size-6 shrink-0 text-emerald-600" />
          <div>
            <h1 className="text-lg font-semibold">Genuine verification slip</h1>
            <p className="text-sm text-muted-foreground">
              Verification ID <span className="font-mono">{slip.code}</span>, issued {formatDateTime(slip.created_at)} to {slip.requester_name} (
              {slip.requester_org}){slip.purpose ? ` for ${slip.purpose.toLowerCase()}` : ""}.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Below is exactly what was verified at that time. Compare it with the printed slip.
            </p>
          </div>
        </div>
        <a href={`/verify/slip/${token}/pdf`} className={buttonVariants({ variant: "outline" })}>
          <Download /> Download PDF
        </a>
      </section>
      <section className="grid gap-5 rounded-xl border bg-background p-6">
        <StudentSummary student={slip.snapshot.student} />
        <div className="space-y-2">
          <h2 className="text-sm font-medium">Certificates at the time of verification</h2>
          <CertificateList certificates={slip.snapshot.certificates} />
        </div>
      </section>
    </div>
  )
}
