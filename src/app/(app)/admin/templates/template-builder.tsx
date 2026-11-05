"use client"

import { useMemo, useState, useTransition } from "react"
import { ArrowDown, ArrowUp, Copy, FilePlus2, FileText, Folder, FolderPlus, Pencil, Plus, Repeat, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { OptionSelect, type Option } from "@/components/option-select"
import type { PersonItem } from "@/components/person-combobox"
import { RECURRENCE_LABELS, type NodeKind, type TemplateNode, type TemplateTreeNode } from "@/lib/templates"
import { addNode, deleteNode, duplicateNode, moveNode } from "./actions"
import { NodeEditor } from "./node-editor"

type Props = {
  templateId: string
  tree: TemplateTreeNode[]
  nodes: TemplateNode[]
  usedAsSlot: boolean
  documentTypes: Option[]
  otherTemplates: Option[]
  people: PersonItem[]
  templateNames: Record<string, string>
}

export function TemplateBuilder({ templateId, tree, nodes, usedAsSlot, documentTypes, otherTemplates, people, templateNames }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<TemplateNode | null>(null)
  const [slotParent, setSlotParent] = useState<string | null | undefined>(undefined)
  const [slotTemplate, setSlotTemplate] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const editing = useMemo(() => nodes.find((n) => n.id === editingId) ?? null, [nodes, editingId])

  const add = (parentId: string | null, kind: NodeKind, slotTemplateId?: string) =>
    startTransition(async () => {
      const result = await addNode(templateId, parentId, kind, { slotTemplateId })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setEditingId(result.data.id)
    })

  const move = (id: string, direction: "up" | "down") =>
    startTransition(async () => {
      const result = await moveNode(templateId, id, direction)
      if (!result.ok) toast.error(result.error)
    })

  const duplicate = (id: string) =>
    startTransition(async () => {
      const result = await duplicateNode(templateId, id)
      if (!result.ok) toast.error(result.error)
      else toast.success("Duplicated — rename the copy")
    })

  const addMenu = (parentId: string | null, compact = false) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          compact ? (
            <Button variant="ghost" size="icon-sm" aria-label="Add inside this folder" disabled={pending} />
          ) : (
            <Button variant="outline" size="sm" disabled={pending} />
          )
        }
      >
        <Plus /> {!compact && "Add"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => add(parentId, "folder")}>
          <FolderPlus /> Folder
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => add(parentId, "document")}>
          <FilePlus2 /> Document item
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setSlotTemplate(otherTemplates[0]?.value ?? null)
            setSlotParent(parentId)
          }}
          disabled={otherTemplates.length === 0}
        >
          <Repeat /> Slot (repeat another template)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const renderNodes = (list: TemplateTreeNode[], level: number) => (
    <ul className={level ? "ml-5 border-l pl-3" : ""}>
      {list.map((n, i) => (
        <li key={n.id} className="py-0.5">
          <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
            {n.kind === "folder" ? (
              <Folder className="size-4 shrink-0 text-primary" />
            ) : n.kind === "slot" ? (
              <Repeat className="size-4 shrink-0 text-primary" />
            ) : (
              <FileText className="size-4 shrink-0 text-muted-foreground" />
            )}
            <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:underline" onClick={() => setEditingId(n.id)}>
              {n.name}
            </button>
            <span className="hidden flex-wrap gap-1 sm:flex">
              {n.kind === "document" && n.recurrence !== "once" && <Badge variant="secondary">{RECURRENCE_LABELS[n.recurrence]}</Badge>}
              {n.kind === "document" && n.requiresReview && <Badge variant="outline">Review ×{n.reviewers.length}</Badge>}
              {n.kind === "slot" && <Badge variant="outline">repeats “{templateNames[n.slotTemplateId ?? ""] ?? "?"}”</Badge>}
              {n.kind === "slot" && n.slotEntryDates && <Badge variant="outline">own dates</Badge>}
            </span>
            <span className="flex shrink-0 items-center opacity-60 group-hover:opacity-100">
              {n.kind === "folder" && addMenu(n.id, true)}
              <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0 || pending} onClick={() => move(n.id, "up")}>
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === list.length - 1 || pending} onClick={() => move(n.id, "down")}>
                <ArrowDown />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${n.name}`} onClick={() => setEditingId(n.id)}>
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Duplicate ${n.name}`}
                title="Duplicate with everything inside"
                disabled={pending}
                onClick={() => duplicate(n.id)}
              >
                <Copy />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Delete ${n.name}`} onClick={() => setDeleting(n)}>
                <Trash2 />
              </Button>
            </span>
          </div>
          {n.children.length > 0 && renderNodes(n.children, level + 1)}
        </li>
      ))}
    </ul>
  )

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-heading">Structure</h2>
        {addMenu(null)}
      </div>
      <div className="rounded-xl border bg-card p-2">
        {tree.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">
            Empty. Add the folders and document items every instance should have.
          </p>
        ) : (
          renderNodes(tree, 0)
        )}
      </div>

      <NodeEditor
        templateId={templateId}
        node={editing}
        usedAsSlot={usedAsSlot}
        documentTypes={documentTypes}
        otherTemplates={otherTemplates}
        people={people}
        onClose={() => setEditingId(null)}
      />

      <Dialog open={slotParent !== undefined} onOpenChange={(open) => !open && setSlotParent(undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a slot</DialogTitle>
            <DialogDescription>
              A slot repeats another template once per entry — e.g. one folder per subject, each built from the
              Subject template.
            </DialogDescription>
          </DialogHeader>
          <OptionSelect options={otherTemplates} value={slotTemplate} onChange={setSlotTemplate} placeholder="Choose a template" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSlotParent(undefined)}>
              Cancel
            </Button>
            <Button
              disabled={!slotTemplate || pending}
              onClick={() => {
                const parent = slotParent ?? null
                setSlotParent(undefined)
                if (slotTemplate) add(parent, "slot", slotTemplate)
              }}
            >
              Add slot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description={
          deleting?.kind === "folder"
            ? "Everything inside this folder is removed from the template too. Existing instances are not affected."
            : "It is removed from the template. Existing instances are not affected."
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return
          const result = await deleteNode(templateId, deleting.id)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          if (editingId === deleting.id) setEditingId(null)
        }}
      />
    </section>
  )
}
