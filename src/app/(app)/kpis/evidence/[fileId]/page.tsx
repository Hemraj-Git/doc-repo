import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, FileWarning } from "lucide-react"
import { FilePreview } from "@/components/preview/file-preview"
import { requireAppContext } from "@/lib/auth/session"
import { getEvidenceFile } from "@/lib/data/kpis"
import { FORMAT_LABELS, formatBytes, previewKind } from "@/lib/files"

export const metadata: Metadata = { title: "KPI evidence" }

/**
 * A file attached to a KPI period. Access follows the KPI assignment, not the repository:
 * a reviewer can read this exact file without being able to browse the document's folder.
 */
export default async function EvidencePreviewPage({ params }: PageProps<"/kpis/evidence/[fileId]">) {
  const { fileId } = await params
  const [, file] = await Promise.all([requireAppContext(), getEvidenceFile(fileId)])
  if (!file) notFound()
  const kind = previewKind(file.fileName)

  return (
    <div className="space-y-4">
      <div className="min-w-0 space-y-1">
        <Link href={`/kpis/assignments/${file.assignmentId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {file.kpiName}
        </Link>
        <h1 className="truncate text-xl font-semibold tracking-tight">{file.fileName}</h1>
        <p className="text-xs text-muted-foreground">
          {file.areaName} · {file.periodLabel} · {FORMAT_LABELS[file.fileFormat]} · {formatBytes(file.sizeBytes)}
          {file.source === "repository" ? " · attached from the repository" : ""}
        </p>
      </div>
      {kind ? (
        <FilePreview kpiFileId={file.id} fileName={file.fileName} kind={kind} />
      ) : (
        <div className="flex flex-col items-center rounded-xl border border-dashed py-16 text-center">
          <FileWarning className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No in-browser preview for this file type</p>
          <p className="max-w-md text-sm text-muted-foreground">Download it from the KPI page to open it.</p>
        </div>
      )}
    </div>
  )
}
