import type { Metadata } from "next"
import Link from "next/link"
import { Folder, SearchX } from "lucide-react"
import { DocumentsTable } from "@/components/documents/documents-table"
import { PageHeader } from "@/components/page-header"
import { requireAppContext } from "@/lib/auth/session"
import { searchDocuments, searchFolders, type SearchFilters as Filters } from "@/lib/data/documents"
import { listDocumentTypes, listRepositoryDepartments } from "@/lib/data/repository"
import { STATUS_LABELS } from "@/lib/documents"
import { SearchFilters } from "./search-filters"

export const metadata: Metadata = { title: "Search" }

const UUID = /^[0-9a-f-]{36}$/

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  await requireAppContext()
  const params = await searchParams
  const get = (k: string) => (typeof params[k] === "string" ? (params[k] as string).trim() : "")
  const q = get("q")
  const filters: Filters = {
    status: get("status") in STATUS_LABELS ? get("status") : undefined,
    typeId: UUID.test(get("type")) ? get("type") : undefined,
    departmentId: UUID.test(get("dept")) ? get("dept") : undefined,
  }

  const [types, departments] = await Promise.all([listDocumentTypes(), listRepositoryDepartments()])
  // A term of 2+ characters, or a filter on its own (e.g. "all approved documents").
  const hasFilter = Boolean(filters.status || filters.typeId || filters.departmentId)
  const searchable = q.length >= 2 || hasFilter
  const [documents, folders] = searchable
    ? await Promise.all([
        searchDocuments(q.length >= 2 ? q : "", filters),
        // Folder hits only make sense for a term and no document-only filter.
        q.length < 2 || filters.status || filters.typeId ? Promise.resolve([]) : searchFolders(q, filters.departmentId),
      ])
    : [[], []]

  return (
    <div className="space-y-6">
      <PageHeader
        title={q ? `Results for “${q}”` : hasFilter ? "Filtered documents" : "Search"}
        description="Searches document and folder names and Reference IDs you have access to."
      />
      <SearchFilters
        types={types.map((t) => ({ value: t.id, label: t.name === t.code ? t.code : `${t.code} — ${t.name}` }))}
        departments={departments.length > 1 ? departments.map((d) => ({ value: d.id, label: d.name })) : null}
      />

      {!searchable ? (
        <p className="text-sm text-muted-foreground">Type at least 2 characters in the search box above, or choose a filter.</p>
      ) : documents.length === 0 && folders.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed py-14 text-center">
          <SearchX className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">Nothing found</p>
          <p className="text-sm text-muted-foreground">Try part of the name or Reference ID, or remove a filter.</p>
        </div>
      ) : (
        <>
          {folders.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
                Folders <span className="tabular-nums">({folders.length})</span>
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {folders.map((f) => (
                  <li key={f.id}>
                    <Link
                      href={`/repository/${f.department.code}/${f.id}`}
                      className="flex items-center gap-3 rounded-lg border bg-card p-3 hover:border-primary/40 hover:bg-primary/5"
                    >
                      <Folder className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{f.name}</span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {f.department.code} · {f.referenceId}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="space-y-3">
            <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
              Documents <span className="tabular-nums">({documents.length})</span>
            </h2>
            <DocumentsTable
              documents={documents}
              columns={["location", "uploader", "version", "updated"]}
              emptyText="No documents match."
            />
          </section>
        </>
      )}
    </div>
  )
}
