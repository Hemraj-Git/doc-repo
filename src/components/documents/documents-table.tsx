import Link from "next/link"
import { FileText } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { DocumentListRow } from "@/lib/data/documents"
import { daysSince, isClosed, isOverdue } from "@/lib/documents"
import { formatDate, todayIso } from "@/lib/format"
import { cn } from "@/lib/utils"
import { DocumentStatusBadge } from "./document-status-badge"

type Column = "location" | "department" | "uploader" | "version" | "updated" | "pending" | "due"

type Props = {
  documents: DocumentListRow[]
  columns?: Column[]
  emptyText: string
  /** Extra per-row content, e.g. a "Review" button. */
  action?: (doc: DocumentListRow) => React.ReactNode
}

const DEFAULT_COLUMNS: Column[] = ["uploader", "version", "updated"]

export function DocumentsTable({ documents, columns = DEFAULT_COLUMNS, emptyText, action }: Props) {
  const has = (c: Column) => columns.includes(c)
  const today = todayIso()

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed py-10 text-center">
        <FileText className="mb-2 size-7 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Document</TableHead>
            <TableHead>Type</TableHead>
            {has("location") && <TableHead>Location</TableHead>}
            {has("department") && <TableHead>Department</TableHead>}
            {has("uploader") && <TableHead>Uploader</TableHead>}
            <TableHead>Status</TableHead>
            {has("version") && <TableHead className="text-right">Version</TableHead>}
            {has("due") && <TableHead>Due</TableHead>}
            {has("pending") && <TableHead className="text-right">Days pending</TableHead>}
            {has("updated") && <TableHead>Updated</TableHead>}
            {action && (
              <TableHead className="w-0">
                <span className="sr-only">Action</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((d) => {
            const overdue = isOverdue(d.status, d.dueDate, today)
            return (
              <TableRow key={d.id}>
                <TableCell>
                  <Link href={`/documents/${d.id}`} className="flex items-center gap-2 font-medium hover:underline">
                    <FileText className="size-4 shrink-0 text-primary" />
                    {d.name}
                  </Link>
                  {d.kpi && (
                    <span className="ml-6 inline-flex rounded bg-violet-50 px-1.5 text-[10px] font-medium tracking-wide text-violet-700 uppercase">KPI</span>
                  )}
                  {d.referenceId && <div className="ml-6 font-mono text-xs text-muted-foreground">{d.referenceId}</div>}
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs" title={d.type.name}>
                    {d.type.code}
                  </span>
                </TableCell>
                {has("location") && (
                  <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                    {d.department.code} ·{" "}
                    {d.kpi
                      ? `KPI · ${d.kpi.name} · ${d.folder.name}`
                      : d.folder.level === "root"
                      ? "Standalone"
                      : d.instanceName && d.instanceName !== d.folder.name
                        ? `${d.instanceName} · ${d.folder.name}`
                        : d.folder.name}
                  </TableCell>
                )}
                {has("department") && <TableCell className="text-xs">{d.department.name}</TableCell>}
                {has("uploader") && <TableCell>{d.uploader.fullName}</TableCell>}
                <TableCell>
                  <DocumentStatusBadge status={d.status} unreviewed={d.unreviewed} />
                </TableCell>
                {has("version") && (
                  <TableCell className="text-right tabular-nums">{d.currentVersion ? `v${d.currentVersion.versionNo}` : "—"}</TableCell>
                )}
                {has("due") && (
                  <TableCell className={cn("text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {d.dueDate ? formatDate(d.dueDate) : "—"}
                    {overdue && <span className="block text-[11px] uppercase tracking-wide">Overdue</span>}
                  </TableCell>
                )}
                {has("pending") && (
                  <TableCell className="text-right tabular-nums">
                    {isClosed(d.status) ? "—" : daysSince(d.createdAt)}
                  </TableCell>
                )}
                {has("updated") && <TableCell className="text-xs text-muted-foreground">{formatDate(d.updatedAt)}</TableCell>}
                {action && <TableCell className="text-right">{action(d)}</TableCell>}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
