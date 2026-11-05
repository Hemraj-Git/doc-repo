import type { Metadata } from "next"
import { DocumentsTable } from "@/components/documents/documents-table"
import { PageHeader } from "@/components/page-header"
import { ShowMore, shownRows } from "@/components/show-more"
import { requireNavAccess } from "@/lib/auth/guards"
import { hasPerm } from "@/lib/auth/permissions"
import { listRequirements } from "@/lib/data/documents"

export const metadata: Metadata = { title: "Requirements" }

export default async function RequirementsPage({ searchParams }: PageProps<"/requirements">) {
  const [ctx, params] = await Promise.all([requireNavAccess("/requirements"), searchParams])
  const shownOpen = shownRows(params.open)
  const shownClosed = shownRows(params.closed)
  const [open, done] = await Promise.all([
    listRequirements(ctx, { state: "open", limit: shownOpen }),
    listRequirements(ctx, { state: "closed", limit: shownClosed }),
  ])
  const scope = hasPerm(ctx, "document.create.any_dept") ? "across the institute" : `in ${ctx.department.name}`
  const count = (page: { rows: unknown[]; hasMore: boolean }) => `${page.rows.length}${page.hasMore ? "+" : ""}`

  return (
    <div className="space-y-8">
      <PageHeader
        title="Requirements"
        description={`Document requirements ${scope}. Create new ones from a folder in the Repository.`}
      />
      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Open, oldest first <span className="tabular-nums">({count(open)})</span>
        </h2>
        <DocumentsTable
          documents={open.rows}
          columns={["location", "uploader", "version", "due", "pending"]}
          emptyText="No open requirements."
        />
        {open.hasMore && <ShowMore shown={shownOpen} param="open" params={{ closed: shownClosed }} />}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Closed, most recent first <span className="tabular-nums">({count(done)})</span>
        </h2>
        <DocumentsTable documents={done.rows} columns={["location", "uploader", "version", "updated"]} emptyText="Nothing approved or closed yet." />
        {done.hasMore && <ShowMore shown={shownClosed} param="closed" params={{ open: shownOpen }} />}
      </section>
    </div>
  )
}
