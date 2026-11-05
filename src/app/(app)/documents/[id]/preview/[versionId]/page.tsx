import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, FileWarning } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { FilePreview } from "@/components/preview/file-preview"
import { DocumentStatusBadge } from "@/components/documents/document-status-badge"
import { hasPerm } from "@/lib/auth/permissions"
import { requireAppContext } from "@/lib/auth/session"
import { getDocument } from "@/lib/data/documents"
import { FORMAT_LABELS, formatBytes, previewKind } from "@/lib/files"
import { formatDateTime } from "@/lib/format"
import { FileButtons } from "../../file-buttons"

export async function generateMetadata({ params }: PageProps<"/documents/[id]/preview/[versionId]">): Promise<Metadata> {
  const { id } = await params
  const doc = await getDocument(id)
  return { title: doc ? `Preview · ${doc.name}` : "Preview" }
}

export default async function PreviewPage({ params }: PageProps<"/documents/[id]/preview/[versionId]">) {
  const { id, versionId } = await params
  // RLS: the document (and its versions) only load if the user may see them.
  const [ctx, doc] = await Promise.all([requireAppContext(), getDocument(id)])
  const version = doc?.versions.find((v) => v.id === versionId)
  if (!doc || !version) notFound()

  const kind = previewKind(version.originalFilename)
  const isCurrent = version.versionNo === doc.currentVersion?.versionNo
  const canDownload = hasPerm(ctx, "document.download")

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link
            href={`/documents/${doc.id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> {doc.name}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{version.originalFilename}</h1>
            <DocumentStatusBadge status={doc.status} unreviewed={doc.unreviewed} />
          </div>
          <p className="text-xs text-muted-foreground">
            Version {version.versionNo}
            {isCurrent ? " (current)" : " — an older version"} · {FORMAT_LABELS[version.fileFormat]} · {formatBytes(version.sizeBytes)} ·
            uploaded {formatDateTime(version.uploadedAt)} by {version.uploadedBy.fullName}
          </p>
        </div>
        <FileButtons
          documentId={doc.id}
          versionId={version.id}
          fileName={version.originalFilename}
          canDownload={canDownload}
          showPreview={false}
          size="default"
        />
      </div>

      {kind ? (
        <FilePreview versionId={version.id} fileName={version.originalFilename} kind={kind} />
      ) : (
        <div className="flex flex-col items-center rounded-xl border border-dashed py-16 text-center">
          <FileWarning className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No in-browser preview for this file type</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Older binary Office formats (.doc, .ppt) can&apos;t be previewed safely in the browser.
            {canDownload ? " Download the file to open it." : ""}
          </p>
          <div className="mt-4 flex gap-2">
            <Link href={`/documents/${doc.id}`} className={buttonVariants({ variant: "ghost" })}>
              Back to document
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
