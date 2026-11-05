import { createClient } from "@/lib/supabase/server"
import { formatBytes } from "@/lib/files"

type Tile = { label: string; value: number | string | null }

/** Institute-wide totals. Document figures cover what the viewer may see (all, for admins). */
export async function OrgStats() {
  const supabase = await createClient()
  const count = (table: string, build?: (q: ReturnType<typeof head>) => ReturnType<typeof head>) => {
    const q = head(table)
    return (build ? build(q) : q).then((r) => r.count)
  }
  const head = (table: string) => supabase.from(table).select("id", { count: "exact", head: true })

  const [departments, users, documents, pendingUploads, inReview, sizes] = await Promise.all([
    count("departments", (q) => q.eq("is_active", true)),
    count("profiles", (q) => q.eq("is_active", true)),
    count("documents"),
    count("documents", (q) => q.in("status", ["pending_upload", "changes_requested"])),
    count("documents", (q) => q.eq("status", "in_review")),
    supabase.rpc("storage_used"),
  ])
  const storage = Number(sizes.data ?? 0)

  const tiles: Tile[] = [
    { label: "Departments", value: departments },
    { label: "Active users", value: users },
    { label: "Documents", value: documents },
    { label: "Pending uploads", value: pendingUploads },
    { label: "In review", value: inReview },
    { label: "Storage used", value: formatBytes(storage) },
  ]

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border bg-muted/20 p-3">
          <dt className="text-xs text-muted-foreground">{t.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{t.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  )
}
