import Link from "next/link"
import { FileText } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { DocumentListRow } from "@/lib/data/documents"
import { daysSince, isClosed, isOverdue } from "@/lib/documents"
import { formatDate, todayIso } from "@/lib/format"
import { cn } from "@/lib/utils"
import { DocumentStatusBadge } from "./document-status-badge"
import { EmptyState } from "@/components/empty-state"

type Column = "location" | "department" | "uploader" | "version" | "updated" | "pending" | "due"

type Props = {
  documents: DocumentListRow[]
  columns?: Column[]
  emptyText: string
  /** One line instead of the full empty state, for pages with several lists. */
  compactEmpty?: boolean
  /** Extra per-row content, e.g. a "Review" button. */
  action?: (doc: DocumentListRow) => React.ReactNode
}

const DEFAULT_COLUMNS: Column[] = ["uploader", "version", "updated"]

export function DocumentsTable({ documents, columns = DEFAULT_COLUMNS, emptyText, compactEmpty, action }: Props) {
  const has = (c: Column) => columns.includes(c)
  const today = todayIso()

  if (documents.length === 0) {
    if (compactEmpty) return <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{emptyText}</p>
    return (
      <EmptyState icon={FileText}>
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      </EmptyState>
    )
  }

  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Document</TableHead>
            <TableHead className="hidden sm:table-cell">Type</TableHead>
            {has("location") && <TableHead className="hidden sm:table-cell">Location</TableHead>}
            {has("department") && <TableHead className="hidden sm:table-cell">Department</TableHead>}
            {has("uploader") && <TableHead className="hidden sm:table-cell">Uploader</TableHead>}
            <TableHead className="hidden sm:table-cell">Status</TableHead>
            {has("version") && <TableHead className="hidden sm:table-cell text-right">Version</TableHead>}
            {has("due") && <TableHead className="hidden sm:table-cell">Due</TableHead>}
            {has("pending") && <TableHead className="hidden sm:table-cell text-right">Days pending</TableHead>}
            {has("updated") && <TableHead className="hidden sm:table-cell">Updated</TableHead>}
            {action && (
              <TableHead className="hidden sm:table-cell w-0">
                <span className="sr-only">Action</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((d) => {
            const overdue = isOverdue(d.status, d.dueDate, today)
            const location = `${d.department.code} · ${
              d.kpi
                ? `KPI · ${d.kpi.name} · ${d.folder.name}`
                : d.folder.level === "root"
                  ? "Standalone"
                  : d.instanceName && d.instanceName !== d.folder.name
                    ? `${d.instanceName} · ${d.folder.name}`
                    : d.folder.name
            }`
            return (
              <TableRow key={d.id}>
                <TableCell className="max-sm:whitespace-normal">
                  <Link href={`/documents/${d.id}`} className="flex items-center gap-2 font-medium hover:underline">
                    <FileText className="size-4 shrink-0 text-primary" />
                    {d.name}
                  </Link>
                  {d.kpi && (
                    <span className="ml-6 inline-flex rounded bg-kpi-soft px-1.5 text-[10px] font-medium tracking-wide text-kpi-text uppercase">KPI</span>
                  )}
                  {d.referenceId && <div className="ml-6 font-mono text-xs break-all text-muted-foreground">{d.referenceId}</div>}
                  <div className="mt-1.5 ml-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:hidden">
                    <DocumentStatusBadge status={d.status} unreviewed={d.unreviewed} />
                    {has("due") && d.dueDate && (
                      <span className={overdue ? "font-medium text-destructive" : undefined}>
                        {overdue ? "Overdue" : "Due"} {formatDate(d.dueDate)}
                      </span>
                    )}
                    {has("location") && <span className="w-full">{location}</span>}
                    {has("uploader") && <span>{d.uploader.fullName}</span>}
                    {action && <span className="w-full pt-1">{action(d)}</span>}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <span className="font-mono text-xs" title={d.type.name}>
                    {d.type.code}
                  </span>
                </TableCell>
                {has("location") && (
                  <TableCell className="hidden sm:table-cell max-w-56 truncate text-xs text-muted-foreground" title={location}>
                    {location}
                  </TableCell>
                )}
                {has("department") && <TableCell className="hidden sm:table-cell text-xs">{d.department.name}</TableCell>}
                {has("uploader") && <TableCell className="hidden sm:table-cell">{d.uploader.fullName}</TableCell>}
                <TableCell className="hidden sm:table-cell">
                  <DocumentStatusBadge status={d.status} unreviewed={d.unreviewed} />
                </TableCell>
                {has("version") && (
                  <TableCell className="hidden sm:table-cell text-right tabular-nums">{d.currentVersion ? `v${d.currentVersion.versionNo}` : "—"}</TableCell>
                )}
                {has("due") && (
                  <TableCell className={cn("hidden sm:table-cell text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {d.dueDate ? formatDate(d.dueDate) : "—"}
                    {overdue && <span className="block text-[11px] uppercase tracking-wide">Overdue</span>}
                  </TableCell>
                )}
                {has("pending") && (
                  <TableCell className="hidden sm:table-cell text-right tabular-nums">
                    {isClosed(d.status) ? "—" : daysSince(d.createdAt)}
                  </TableCell>
                )}
                {has("updated") && <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">{formatDate(d.updatedAt)}</TableCell>}
                {action && <TableCell className="hidden sm:table-cell text-right">{action(d)}</TableCell>}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
