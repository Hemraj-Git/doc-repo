import type { Metadata } from "next"
import Link from "next/link"
import { ChevronRight, History } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/page-header"
import { AUDIT_CATEGORIES, describeAudit } from "@/lib/audit"
import { requireNavAccess } from "@/lib/auth/guards"
import { hasPerm } from "@/lib/auth/permissions"
import { buildLookups, listAudit, parseAuditFilters } from "@/lib/data/audit"
import { listDepartments, listPeoplePicker } from "@/lib/data/org"
import { formatDateTime } from "@/lib/format"
import { AuditToolbar } from "./audit-toolbar"

export const metadata: Metadata = { title: "Audit Log" }

const CATEGORY_OF: Record<string, string> = Object.fromEntries(
  Object.values(AUDIT_CATEGORIES).flatMap((c) => c.entityTypes.map((t) => [t, c.label]))
)

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const ctx = await requireNavAccess("/audit")
  const params = await searchParams
  const filters = parseAuditFilters((k) => (typeof params[k] === "string" ? (params[k] as string) : undefined))
  const seesAll = hasPerm(ctx, "audit.view.all")

  const [{ rows, nextBefore }, departments, people] = await Promise.all([
    listAudit(filters),
    seesAll ? listDepartments() : Promise.resolve(null),
    listPeoplePicker(),
  ])
  const lookups = await buildLookups(rows)
  const described = rows
    .map((r) => ({ row: r, desc: describeAudit(r, lookups) }))
    .filter((x): x is { row: typeof x.row; desc: NonNullable<typeof x.desc> } => Boolean(x.desc))

  const pageLink = (before?: number) => {
    const next = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string" && e[0] !== "before")
    )
    if (before) next.set("before", String(before))
    return `/audit${next.size ? `?${next}` : ""}`
  }

  return (
    <>
      <PageHeader
        title="Audit Log"
        description={`Every change, upload, review, view and download — ${seesAll ? "across the institute" : ctx.department.name}. Entries can never be edited or deleted.`}
      />
      <AuditToolbar departments={departments?.map((d) => ({ value: d.id, label: d.name })) ?? null} people={people} />

      {described.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed py-14 text-center">
          <History className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No activity matches these filters</p>
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">When</TableHead>
                <TableHead className="w-44">Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead className="w-32">Department</TableHead>
                <TableHead className="w-36">Area</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {described.map(({ row, desc }) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{formatDateTime(row.createdAt)}</TableCell>
                  <TableCell className="text-sm">
                    {row.actorId ? (lookups.people[row.actorId] ?? "Unknown user") : <span className="text-muted-foreground">System</span>}
                  </TableCell>
                  <TableCell className="text-sm whitespace-normal">
                    {desc.href ? (
                      <Link href={desc.href} className="hover:underline">
                        {desc.text}
                      </Link>
                    ) : (
                      desc.text
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.departmentId ? (lookups.departments[row.departmentId]?.code ?? "—") : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {CATEGORY_OF[row.entityType] ?? row.entityType}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-4 flex justify-between gap-2">
        {filters.before ? (
          <Link href={pageLink()} className={buttonVariants({ variant: "ghost" })}>
            Back to newest
          </Link>
        ) : (
          <span />
        )}
        {nextBefore && (
          <Link href={pageLink(nextBefore)} className={buttonVariants({ variant: "outline" })}>
            Older entries <ChevronRight />
          </Link>
        )}
      </div>
    </>
  )
}
