"use client"

import { useState } from "react"
import Link from "next/link"
import { LayoutTemplate, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusBadge } from "@/components/status-badge"
import type { TemplateSummary } from "@/lib/data/templates"
import { formatDate } from "@/lib/format"
import { TemplateDetailsDialog } from "./template-details-dialog"

type Props = { templates: TemplateSummary[]; departments: { id: string; name: string }[] }

export function TemplatesList({ templates, departments }: Props) {
  const [creating, setCreating] = useState(false)
  const deptName = new Map(departments.map((d) => [d.id, d.name]))

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus /> New template
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed py-14 text-center">
          <LayoutTemplate className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No templates yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Tip: build the smallest repeating unit first (e.g. a <em>Subject</em> template), then a bigger one (e.g.{" "}
            <em>Program</em>) that repeats it in a slot.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Available to</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead>Used inside</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link href={`/admin/templates/${t.id}`} className="font-medium hover:underline">
                      {t.name}
                    </Link>
                    {t.description && <div className="max-w-md truncate text-xs text-muted-foreground">{t.description}</div>}
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-xs">
                    {t.departmentIds?.length ? t.departmentIds.map((id) => deptName.get(id) ?? "?").join(", ") : "Every department"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{t.nodeCount}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {t.usedBy.length ? t.usedBy.map((n) => <Badge key={n} variant="outline">{n}</Badge>) : <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge active={t.isActive} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(t.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <TemplateDetailsDialog open={creating} onOpenChange={setCreating} departments={departments} />
    </>
  )
}
