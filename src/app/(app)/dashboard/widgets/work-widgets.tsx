import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { DocumentStatusBadge } from "@/components/documents/document-status-badge"
import type { DocumentListRow, ReviewTask, TaskCounts } from "@/lib/data/documents"
import { daysSince, isClosed, STATUS_LABELS, type DocumentStatus } from "@/lib/documents"

const MAX_ITEMS = 5

export function Tiles({ tiles }: { tiles: { label: string; value: number | string; href?: string; tone?: "attention" }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
      {tiles.map((t) => {
        const body = (
          <>
            <dt className="text-xs text-muted-foreground">{t.label}</dt>
            <dd className={`mt-1 text-2xl font-semibold tabular-nums ${t.tone === "attention" && t.value ? "text-primary" : ""}`}>{t.value}</dd>
          </>
        )
        return t.href ? (
          <Link key={t.label} href={t.href} className="rounded-lg border bg-muted/20 p-3 transition-colors hover:bg-muted/50">
            {body}
          </Link>
        ) : (
          <div key={t.label} className="rounded-lg border bg-muted/20 p-3">
            {body}
          </div>
        )
      })}
    </dl>
  )
}

export function MyKpis({ counts }: { counts: TaskCounts }) {
  return (
    <Tiles
      tiles={[
        { label: "To upload", value: counts.toUpload - counts.changesRequested, href: "/tasks", tone: "attention" },
        { label: "Overdue", value: counts.overdue, href: "/tasks", tone: "attention" },
        { label: "To review", value: counts.toReview, href: "/tasks", tone: "attention" },
        { label: "Changes requested", value: counts.changesRequested, href: "/tasks", tone: "attention" },
        { label: "My approved documents", value: counts.approved, href: "/my-documents" },
      ]}
    />
  )
}

function MoreLink({ href, count }: { href: string; count: number }) {
  if (count <= MAX_ITEMS) return null
  return (
    <Link href={href} className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
      {count - MAX_ITEMS} more <ArrowRight className="size-3" />
    </Link>
  )
}

/** Compact document list for dashboard cards. */
export function DocList({
  documents,
  empty,
  moreHref,
  meta,
}: {
  documents: DocumentListRow[]
  empty: string
  moreHref: string
  meta: (d: DocumentListRow) => React.ReactNode
}) {
  if (documents.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <div>
      <ul className="grid gap-2">
        {documents.slice(0, MAX_ITEMS).map((d) => (
          <li key={d.id}>
            <Link href={`/documents/${d.id}`} className="-mx-1.5 block rounded-md px-1.5 py-1 hover:bg-muted/50">
              <span className="block truncate text-sm font-medium">{d.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{meta(d)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <MoreLink href={moreHref} count={documents.length} />
    </div>
  )
}

export function ReviewList({ tasks }: { tasks: ReviewTask[] }) {
  return (
    <DocList
      documents={tasks.map((t) => t.document)}
      empty="No reviews are waiting for you."
      moreHref="/tasks"
      meta={(d) => {
        const t = tasks.find((x) => x.document.id === d.id)!
        return `Step ${t.stepOrder}/${t.totalSteps} · from ${d.uploader.fullName} · ${daysSince(t.activatedAt)}d waiting`
      }}
    />
  )
}

/** Open requirements, oldest first. */
export function RequirementTracker({ documents }: { documents: DocumentListRow[] }) {
  const open = documents.filter((d) => !isClosed(d.status))
  if (open.length === 0) return <p className="text-sm text-muted-foreground">No open requirements.</p>
  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-2 font-normal">Document</th>
            <th className="pb-2 font-normal">Uploader</th>
            <th className="pb-2 font-normal">Status</th>
            <th className="pb-2 text-right font-normal">Days</th>
          </tr>
        </thead>
        <tbody>
          {open.slice(0, MAX_ITEMS).map((d) => (
            <tr key={d.id} className="border-t">
              <td className="max-w-48 truncate py-1.5 pr-2">
                <Link href={`/documents/${d.id}`} className="hover:underline">
                  {d.name}
                </Link>
              </td>
              <td className="max-w-32 truncate py-1.5 pr-2 text-muted-foreground">{d.uploader.fullName}</td>
              <td className="py-1.5 pr-2">
                <DocumentStatusBadge status={d.status} className="text-[10px]" />
              </td>
              <td className="py-1.5 text-right tabular-nums">{daysSince(d.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <MoreLink href="/requirements" count={open.length} />
    </div>
  )
}

/** Pending uploads per person, most first. */
export function TeamWorkload({ documents }: { documents: DocumentListRow[] }) {
  const pending = documents.filter((d) => d.status === "pending_upload" || d.status === "changes_requested")
  const byPerson = new Map<string, { name: string; count: number }>()
  for (const d of pending) {
    const entry = byPerson.get(d.uploader.id) ?? { name: d.uploader.fullName, count: 0 }
    entry.count += 1
    byPerson.set(d.uploader.id, entry)
  }
  const rows = [...byPerson.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No pending uploads in your department.</p>
  return (
    <ul className="grid gap-1.5 text-sm">
      {rows.slice(0, 8).map((r) => (
        <li key={r.name} className="flex items-center justify-between gap-2">
          <span className="truncate">{r.name}</span>
          <span className="font-medium tabular-nums">{r.count}</span>
        </li>
      ))}
    </ul>
  )
}

export function StatusBreakdown({ documents }: { documents: DocumentListRow[] }) {
  const order: DocumentStatus[] = ["pending_upload", "changes_requested", "in_review", "approved", "not_applicable"]
  const counts = Object.fromEntries(order.map((s) => [s, documents.filter((d) => d.status === s).length]))
  return (
    <ul className="grid gap-1.5 text-sm">
      {order.map((s) => (
        <li key={s} className="flex items-center justify-between gap-2">
          <span>{STATUS_LABELS[s]}</span>
          <span className="font-medium tabular-nums">{counts[s]}</span>
        </li>
      ))}
    </ul>
  )
}
