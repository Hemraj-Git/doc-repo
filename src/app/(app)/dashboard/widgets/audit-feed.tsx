import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { describeAudit, type AuditEntry, type AuditLookups } from "@/lib/audit"
import { formatDateTime } from "@/lib/format"

/** Compact list of recent audit events for dashboard cards. */
export function AuditFeed({ rows, lookups, moreHref }: { rows: AuditEntry[]; lookups: AuditLookups; moreHref: string }) {
  const items = rows
    .map((r) => ({ r, d: describeAudit(r, lookups) }))
    .filter((x) => x.d)
    .slice(0, 6)

  if (items.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>

  return (
    <div>
      <ul className="grid gap-2">
        {items.map(({ r, d }) => (
          <li key={r.id} className="text-sm">
            {d!.href ? (
              <Link href={d!.href} className="line-clamp-2 hover:underline">
                {d!.text}
              </Link>
            ) : (
              <span className="line-clamp-2">{d!.text}</span>
            )}
            <span className="block text-xs text-muted-foreground">
              {r.actorId ? (lookups.people[r.actorId] ?? "Unknown user") : "System"} · {formatDateTime(r.createdAt)}
            </span>
          </li>
        ))}
      </ul>
      <Link href={moreHref} className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
        Open audit log <ArrowRight className="size-3" />
      </Link>
    </div>
  )
}
