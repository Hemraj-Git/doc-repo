import type { Metadata } from "next"
import { DocumentsTable } from "@/components/documents/documents-table"
import { PageHeader } from "@/components/page-header"
import { ShowMore, shownRows } from "@/components/show-more"
import { requireNavAccess } from "@/lib/auth/guards"
import { listMyDocuments } from "@/lib/data/documents"

export const metadata: Metadata = { title: "My Documents" }

export default async function MyDocumentsPage({ searchParams }: PageProps<"/my-documents">) {
  const shown = shownRows((await searchParams).show)
  const [, { rows, hasMore }] = await Promise.all([requireNavAccess("/my-documents"), listMyDocuments(shown)])

  return (
    <div className="space-y-4">
      <PageHeader title="My Documents" description="Documents you upload, review or created." />
      <DocumentsTable
        documents={rows}
        columns={["location", "uploader", "version", "updated"]}
        emptyText="You are not involved in any documents yet."
      />
      {hasMore && <ShowMore shown={shown} />}
    </div>
  )
}
