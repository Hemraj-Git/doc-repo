import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Building2, ChevronRight } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { listRepositoryDepartments } from "@/lib/data/repository"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Repository" }

export default async function RepositoryPage() {
  await requireNavAccess("/repository")
  const departments = await listRepositoryDepartments()

  // Most staff can browse only their own department: go straight there.
  if (departments.length === 1) redirect(`/repository/${departments[0]!.code}`)

  return (
    <>
      <PageHeader title="Repository" description="Every department has its own folder. Open one to see its folders and documents." />
      {departments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No department folders are available to you yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {departments.map((d) => (
            <li key={d.id}>
              <Link
                href={`/repository/${d.code}`}
                className={cn(
                  "group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-primary/5",
                  !d.isActive && "opacity-60"
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="text-xs text-muted-foreground">
                    <span className="font-mono">{d.code}</span> · {d.childCount} folder{d.childCount === 1 ? "" : "s"}
                    {!d.isActive && " · inactive"}
                  </span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
