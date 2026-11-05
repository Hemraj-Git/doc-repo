"use client"

import { useState } from "react"
import Link from "next/link"
import { Folder, FolderTree, LayoutTemplate, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConfirmDialog } from "@/components/confirm-dialog"
import type { FolderRow } from "@/lib/data/repository"
import { formatDate } from "@/lib/format"
import { deleteFolder } from "./actions"
import { FolderDialog, type FolderDialogMode, type FolderParent } from "./folder-dialog"

type Props = {
  title: string
  folders: FolderRow[]
  /** Where new folders are created. */
  parent: FolderParent
  departmentCode: string
  canManage: boolean
  emptyText: string
  /** Link to the "New from template" wizard for this folder, when the user may use it. */
  templateHref?: string
}

export function FolderList({ title, folders, parent, departmentCode, canManage, emptyText, templateHref }: Props) {
  const [dialog, setDialog] = useState<FolderDialogMode | null>(null)
  const [deleting, setDeleting] = useState<FolderRow | null>(null)
  const isChildLevel = parent.level === "root"

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {title} <span className="tabular-nums">({folders.length})</span>
        </h2>
        {canManage && (
          <div className="flex gap-2">
            {templateHref && (
              <Link href={templateHref} className={buttonVariants({ size: "sm", variant: "outline" })}>
                <LayoutTemplate /> New from template
              </Link>
            )}
            <Button size="sm" onClick={() => setDialog({ kind: "create", parent })}>
              <Plus /> {isChildLevel ? "New folder" : "New sub-folder"}
            </Button>
          </div>
        )}
      </div>

      {folders.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed py-10 text-center">
          <Folder className="mb-2 size-7 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Reference ID</TableHead>
                <TableHead>Sub-folders</TableHead>
                <TableHead>Created</TableHead>
                {canManage && (
                  <TableHead className="w-10">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {folders.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>
                    <Link
                      href={`/repository/${departmentCode}/${f.id}`}
                      className="flex items-center gap-2 font-medium hover:underline"
                    >
                      {f.allowSubfolders ? (
                        <FolderTree className="size-4 shrink-0 text-primary" />
                      ) : (
                        <Folder className="size-4 shrink-0 text-primary" />
                      )}
                      {f.name}
                    </Link>
                    {f.description && <div className="ml-6 max-w-md truncate text-xs text-muted-foreground">{f.description}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{f.referenceId ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    {f.allowSubfolders ? (
                      <Badge variant="secondary" className="tabular-nums">
                        {f.subfolderCount}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not used</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(f.createdAt)}
                    {f.createdBy && <div>{f.createdBy.fullName}</div>}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${f.name}`} />}
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setDialog({ kind: "edit", folder: f, parentReferenceId: parent.referenceId })}
                          >
                            <Pencil /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(f)}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FolderDialog mode={dialog} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description="Only empty folders can be deleted. Its Reference ID becomes available again. This is recorded in the audit log."
        confirmLabel="Delete folder"
        destructive
        onConfirm={async () => {
          if (!deleting) return
          const result = await deleteFolder(deleting.id)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          toast.success(`“${deleting.name}” deleted`)
        }}
      />
    </section>
  )
}
