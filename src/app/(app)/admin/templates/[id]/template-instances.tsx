"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Loader2, Send } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { TemplateUsage } from "@/lib/data/instances"
import { formatDate } from "@/lib/format"
import { pushTemplateUpdates } from "../actions"

/** Where the template is used, and "add new items" for instances created before its latest changes. */
export function TemplateInstances({ templateId, version, instances }: { templateId: string; version: number; instances: TemplateUsage[] }) {
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  if (instances.length === 0) return null
  const outdated = instances.filter((i) => i.status === "active" && i.version < version)

  const push = (ids: string[], key: string) =>
    startTransition(async () => {
      setBusy(key)
      const result = await pushTemplateUpdates(templateId, ids)
      setBusy(null)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.data.added ? `Added ${result.data.added} new folder${result.data.added === 1 ? "" : "s"} or item${result.data.added === 1 ? "" : "s"}` : "Nothing new to add")
    })

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="section-heading">
            Created from this template <span className="tabular-nums">({instances.length})</span>
          </h2>
          <p className="text-sm text-muted-foreground">
            Changes to this template don’t reach folders already created until you add them. This adds new folders and files; it never removes anything.
            Files whose uploader is chosen at creation go to the entry’s owner, else the head of department.
          </p>
        </div>
        {outdated.length > 1 && (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => push(outdated.map((i) => i.id), "all")}>
            {busy === "all" ? <Loader2 className="animate-spin" /> : <Send />}
            Add new items to all {outdated.length}
          </Button>
        )}
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-0">
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {instances.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <Link href={`/repository/${i.department.code}/${i.rootFolderId}`} className="font-medium hover:underline">
                    {i.name}
                  </Link>
                  {i.parentName && <div className="text-xs text-muted-foreground">in {i.parentName}</div>}
                </TableCell>
                <TableCell className="text-xs">{i.department.name}</TableCell>
                <TableCell>
                  {i.status === "closed" ? (
                    <Badge variant="outline">Closed</Badge>
                  ) : i.version < version ? (
                    <Badge variant="outline">Template changed</Badge>
                  ) : (
                    <Badge variant="secondary">Up to date</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(i.createdAt)}</TableCell>
                <TableCell>
                  {i.status === "active" && i.version < version && (
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => push([i.id], i.id)}>
                      {busy === i.id ? <Loader2 className="animate-spin" /> : <Send />}
                      Add new items
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
