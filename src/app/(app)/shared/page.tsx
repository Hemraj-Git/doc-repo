import type { Metadata } from "next"
import Link from "next/link"
import { ChevronRight, Folder } from "lucide-react"
import { DocumentsTable } from "@/components/documents/documents-table"
import { PageHeader } from "@/components/page-header"
import { ShowMore, shownRows } from "@/components/show-more"
import { Badge } from "@/components/ui/badge"
import { requireNavAccess } from "@/lib/auth/guards"
import { listSharedDocuments } from "@/lib/data/documents"
import { listMySharedFolders } from "@/lib/data/folder-access"

export const metadata: Metadata = { title: "Shared with me" }

export default async function SharedPage({ searchParams }: PageProps<"/shared">) {
  const shown = shownRows((await searchParams).show)
  const [, { rows, hasMore }, folders] = await Promise.all([requireNavAccess("/shared"), listSharedDocuments(shown), listMySharedFolders()])

  return (
    <div className="space-y-8">
      <PageHeader title="Shared with me" description="Folders you have been given access to, and documents from other departments that involve you." />

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Shared folders <span className="tabular-nums">({folders.length})</span>
        </h2>
        {folders.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">No folders have been shared with you.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {folders.map((f) => (
              <li key={f.id}>
                <Link href={f.href} className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-primary/5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Folder className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{f.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{f.departmentName}</span>
                  </span>
                  <Badge variant="outline">{f.canUpload ? "Upload" : "View"}</Badge>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">Documents from other departments</h2>
        <DocumentsTable
          documents={rows}
          columns={["department", "uploader", "version", "updated"]}
          emptyText="No documents from other departments involve you."
        />
        {hasMore && <ShowMore shown={shown} />}
      </section>
    </div>
  )
}
