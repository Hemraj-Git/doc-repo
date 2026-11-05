import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/format"
import { CERTIFICATE_STATUS_LABELS, CERTIFICATE_STATUS_STYLES, STUDENT_STATUS_LABELS } from "@/lib/students"
import type { PublicCertificate, PublicStudent } from "@/lib/verification/types"
import { cn } from "@/lib/utils"

export function StudentSummary({ student }: { student: PublicStudent }) {
  const rows: [string, string | null][] = [
    ["Name", student.full_name],
    ["Regd No.", student.regd_no],
    ["Course", student.course],
    ["Batch", student.batch],
    ["Department", student.department],
    ["Status", STUDENT_STATUS_LABELS[student.status]],
    ["Completed on", student.completion_date ? formatDate(student.completion_date) : null],
  ]
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {rows
        .filter(([, v]) => v)
        .map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm font-medium">{value}</dd>
          </div>
        ))}
    </dl>
  )
}

export function CertificateStatusBadge({ c }: { c: PublicCertificate }) {
  return (
    <Badge variant="outline" className={CERTIFICATE_STATUS_STYLES[c.status]}>
      {CERTIFICATE_STATUS_LABELS[c.status]}
      {c.status !== "issued" && c.status_changed_at ? ` on ${formatDate(c.status_changed_at)}` : ""}
    </Badge>
  )
}

export function CertificateList({ certificates }: { certificates: PublicCertificate[] }) {
  if (certificates.length === 0) return <p className="text-sm text-muted-foreground">No certificates are on record for this student.</p>
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Certificate</th>
            <th className="px-3 py-2 font-medium">Number</th>
            <th className="px-3 py-2 font-medium">Issued</th>
            <th className="px-3 py-2 font-medium">Period</th>
            <th className="px-3 py-2 font-medium">Result</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {certificates.map((c) => (
            <tr key={c.certificate_no} className={cn("border-t", c.highlight && "bg-primary/5")}>
              <td className="px-3 py-2">{c.type}</td>
              <td className="px-3 py-2 font-mono text-xs">{c.certificate_no}</td>
              <td className="px-3 py-2 whitespace-nowrap">{formatDate(c.issue_date)}</td>
              <td className="px-3 py-2">{[c.academic_year, c.semester ? `Sem ${c.semester}` : null].filter(Boolean).join(" · ") || "—"}</td>
              <td className="px-3 py-2">{c.result ?? "—"}</td>
              <td className="px-3 py-2">
                <CertificateStatusBadge c={c} />
                {c.replaced_by && <div className="mt-0.5 text-xs text-muted-foreground">Replaced by {c.replaced_by}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
