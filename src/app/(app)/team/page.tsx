import type { Metadata } from "next"
import { DocumentsTable } from "@/components/documents/documents-table"
import { PageHeader } from "@/components/page-header"
import { ShowMore, shownRows } from "@/components/show-more"
import { requireNavAccess } from "@/lib/auth/guards"
import { listTeamDocuments } from "@/lib/data/documents"

export const metadata: Metadata = { title: "Team Documents" }

export default async function TeamDocumentsPage({ searchParams }: PageProps<"/team">) {
  const [ctx, params] = await Promise.all([requireNavAccess("/team"), searchParams])
  const shown = shownRows(params.show)
  const { rows, hasMore } = await listTeamDocuments(ctx, shown)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Team Documents"
        description={
          ctx.isHod
            ? `Every document in ${ctx.department.name}.`
            : "Documents assigned to people below you in the hierarchy."
        }
      />
      <DocumentsTable
        documents={rows}
        columns={["location", "uploader", "version", "due", "updated"]}
        emptyText={ctx.isHod ? "No documents in your department yet." : "No documents are assigned to your team yet."}
      />
      {hasMore && <ShowMore shown={shown} />}
    </div>
  )
}
