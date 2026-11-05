import { Clock } from "lucide-react"
import { describeAudit, type AuditEntry, type AuditLookups } from "@/lib/audit"
import { formatDateTime } from "@/lib/format"

/** A document's audit trail as a timeline, newest first. */
export function ActivityList({ rows, lookups }: { rows: AuditEntry[]; lookups: AuditLookups }) {
  const items: { id: number; text: string; actor: string | null; at: string }[] = []
  for (const row of rows) {
    const text = describeAudit(row, lookups, { withSubject: false })?.text
    if (!text) continue
    const actor = row.actorId ? (lookups.people[row.actorId] ?? "Unknown user") : null
    const prev = items[items.length - 1]
    // Collapse repeats from one action (e.g. several reviewer rows written together).
    if (prev && prev.text === text && prev.actor === actor && prev.at.slice(0, 19) === row.createdAt.slice(0, 19)) continue
    items.push({ id: row.id, text, actor, at: row.createdAt })
  }

  if (items.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>

  return (
    <ol className="relative grid gap-4 border-l pl-5">
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-background bg-primary/60" />
          <p className="text-sm">{item.text}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" />
            {formatDateTime(item.at)} · {item.actor ?? "System"}
          </p>
        </li>
      ))}
    </ol>
  )
}
