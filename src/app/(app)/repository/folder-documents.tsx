"use client"

import { useState } from "react"
import { ChevronDown, FilePlus2, Repeat, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DocumentDialog, type DocumentDialogMode, type DocumentTypeOption } from "@/components/documents/document-dialog"
import { DocumentsTable } from "@/components/documents/documents-table"
import type { PersonItem } from "@/components/person-combobox"
import type { DocumentListRow } from "@/lib/data/documents"
import { isClosed, isOverdue } from "@/lib/documents"
import { todayIso } from "@/lib/format"
import { RECURRENCE_LABELS } from "@/lib/templates"
import { DirectUploadDialog } from "./direct-upload-dialog"

type Props = {
  folder: { id: string; name: string; standalone: boolean }
  documents: DocumentListRow[]
  /** May create a requirement and ask someone to upload. */
  canCreate: boolean
  /** May upload a file straight into this folder. */
  canUpload: boolean
  documentTypes: DocumentTypeOption[]
  people: PersonItem[]
  myId: string
}

const COLUMNS = ["uploader", "version", "due", "updated"] as const

/** The documents section of a folder (or the standalone documents of a department). */
export function FolderDocuments({ folder, documents, canCreate, canUpload, documentTypes, people, myId }: Props) {
  const [dialog, setDialog] = useState<DocumentDialogMode | null>(null)
  const [uploading, setUploading] = useState(false)
  const title = folder.standalone ? "Standalone documents" : "Documents"

  // Recurring requirements are grouped by series, newest period first, so a year of
  // weekly lesson plans doesn't flood the list.
  const single = documents.filter((d) => !d.series)
  const groups = new Map<string, DocumentListRow[]>()
  for (const d of documents) {
    if (d.series) groups.set(d.series.id, [...(groups.get(d.series.id) ?? []), d])
  }
  const seriesGroups = [...groups.values()]
    .map((docs) => docs.sort((a, b) => (b.period?.start ?? "").localeCompare(a.period?.start ?? "")))
    .sort((a, b) => a[0]!.series!.name.localeCompare(b[0]!.series!.name))

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-heading">
          {title} <span className="tabular-nums">({documents.length})</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {canCreate && (
            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "create", folder })}>
              <FilePlus2 /> {folder.standalone ? "New standalone requirement" : "New requirement"}
            </Button>
          )}
          {canUpload && (
            <Button size="sm" onClick={() => setUploading(true)}>
              <Upload /> Upload files
            </Button>
          )}
        </div>
      </div>
      {(single.length > 0 || seriesGroups.length === 0) && (
        <DocumentsTable
          documents={single}
          columns={[...COLUMNS]}
          emptyText={
            folder.standalone
              ? "No standalone documents. These sit directly in the department and each has its own Reference ID."
              : canCreate
                ? "No documents yet. Upload a file, or create a requirement and choose who uploads it."
                : canUpload
                  ? "No documents yet. Upload the first file."
                  : "No documents you can see in this folder."
          }
        />
      )}
      {seriesGroups.map((docs) => (
        <SeriesGroup key={docs[0]!.series!.id} documents={docs} />
      ))}
      <DocumentDialog mode={dialog} onClose={() => setDialog(null)} documentTypes={documentTypes} people={people} />
      <DirectUploadDialog
        folder={uploading ? folder : null}
        onClose={() => setUploading(false)}
        documentTypes={documentTypes}
        people={people.filter((p) => p.value !== myId)}
      />
    </section>
  )
}

function SeriesGroup({ documents }: { documents: DocumentListRow[] }) {
  const [expanded, setExpanded] = useState(false)
  const series = documents[0]!.series!
  const today = todayIso()
  const done = documents.filter((d) => isClosed(d.status)).length
  const overdue = documents.filter((d) => isOverdue(d.status, d.dueDate, today)).length
  // Always show the latest period and anything still overdue; the rest on demand.
  const visible = expanded ? documents : documents.filter((d, i) => i === 0 || isOverdue(d.status, d.dueDate, today))
  const hidden = documents.length - visible.length

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Repeat className="size-4 text-primary" />
        <span className="font-medium">{series.name}</span>
        <Badge variant="secondary">{RECURRENCE_LABELS[series.recurrence]}</Badge>
        <span className="text-muted-foreground tabular-nums">
          {done}/{documents.length} done
        </span>
        {overdue > 0 && <Badge variant="destructive">{overdue} overdue</Badge>}
      </div>
      <DocumentsTable documents={visible} columns={[...COLUMNS]} emptyText="" />
      {(hidden > 0 || expanded) && documents.length > 1 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <ChevronDown className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          {expanded ? "Show fewer" : `Show ${hidden} earlier period${hidden === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  )
}
