"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Folder, Loader2, Pencil, Plus, Trash2, UsersRound, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Field } from "@/components/field"
import { PersonCombobox, type PersonItem } from "@/components/person-combobox"
import type { GroupRow } from "@/lib/data/folder-access"
import { FOLDER_ACCESS_LABELS, groupSchema } from "@/lib/validation/folder-access"
import { addGroupMember, createGroup, deleteGroup, removeGroupMember, updateGroup } from "./actions"

export function GroupsView({ groups, people }: { groups: GroupRow[]; people: PersonItem[] }) {
  // undefined = closed, null = new, row = editing
  const [editing, setEditing] = useState<GroupRow | null | undefined>(undefined)

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing(null)}>
          <Plus /> New group
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed py-10 text-center">
          <UsersRound className="mb-2 size-7 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No groups yet. Create one, then give it access to a folder.</p>
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <GroupCard key={g.id} group={g} people={people} onEdit={() => setEditing(g)} />
          ))}
        </ul>
      )}

      <Dialog open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)}>
        <DialogContent className="sm:max-w-md">
          {editing !== undefined && <GroupForm key={editing?.id ?? "new"} group={editing} onClose={() => setEditing(undefined)} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

function GroupCard({ group, people, onEdit }: { group: GroupRow; people: PersonItem[]; onEdit: () => void }) {
  const [pending, startTransition] = useTransition()
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const memberIds = new Set(group.members.map((m) => m.id))
  const candidates = people.filter((p) => !memberIds.has(p.value))

  const add = (userId: string | null) => {
    if (!userId) return
    startTransition(async () => {
      const result = await addGroupMember(group.id, userId)
      if (!result.ok) toast.error(result.error)
    })
  }
  const remove = (userId: string) => {
    setRemovingId(userId)
    startTransition(async () => {
      const result = await removeGroupMember(group.id, userId)
      setRemovingId(null)
      if (!result.ok) toast.error(result.error)
    })
  }

  return (
    <li className="grid content-start gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-medium">{group.name}</h2>
          {group.description && <p className="text-sm text-muted-foreground">{group.description}</p>}
        </div>
        <div className="flex shrink-0 gap-0.5">
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${group.name}`} onClick={onEdit}>
            <Pencil />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${group.name}`} onClick={() => setDeleting(true)}>
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="grid gap-1.5">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Members <span className="tabular-nums">({group.members.length})</span>
        </h3>
        {group.members.length > 0 && (
          <ul className="grid max-h-56 gap-1 overflow-y-auto">
            {group.members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {m.fullName}
                  {m.hint && <span className="text-xs text-muted-foreground"> · {m.hint}</span>}
                </span>
                {!m.isActive && <Badge variant="outline">Inactive</Badge>}
                <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${m.fullName}`} onClick={() => remove(m.id)} disabled={pending}>
                  {removingId === m.id ? <Loader2 className="animate-spin" /> : <X />}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <PersonCombobox people={candidates} value={null} onChange={add} placeholder="Add a person…" disabled={pending} />
      </div>

      <div className="grid gap-1.5">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Folder access</h3>
        {group.folders.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet. Use Manage access on a folder&apos;s page.</p>
        ) : (
          <ul className="grid gap-1">
            {group.folders.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-sm">
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                {f.href ? (
                  <Link href={f.href} className="min-w-0 flex-1 truncate hover:underline">
                    {f.name}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                )}
                <Badge variant="outline">{FOLDER_ACCESS_LABELS[f.access]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${group.name}?`}
        description={
          group.folders.length > 0
            ? `Its ${group.members.length} ${group.members.length === 1 ? "member" : "members"} will lose access to ${group.folders.length} ${group.folders.length === 1 ? "folder" : "folders"} given through this group.`
            : "Nobody loses folder access, because this group has none."
        }
        confirmLabel="Delete group"
        destructive
        onConfirm={async () => {
          const result = await deleteGroup(group.id)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          toast.success(`${group.name} deleted`)
        }}
      />
    </li>
  )
}

function GroupForm({ group, onClose }: { group: GroupRow | null; onClose: () => void }) {
  const [pending, startTransition] = useTransition()
  const form = useForm({
    resolver: zodResolver(groupSchema),
    defaultValues: { name: group?.name ?? "", description: group?.description ?? "" },
  })
  const { errors } = form.formState

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = group ? await updateGroup(group.id, values) : await createGroup(values)
      if (!result.ok) {
        Object.entries(result.fieldErrors ?? {}).forEach(([field, message]) => form.setError(field as keyof typeof values, { message }))
        toast.error(result.error)
        return
      }
      toast.success(group ? "Group updated" : `${values.name} created`)
      onClose()
    })
  )

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{group ? `Edit ${group.name}` : "New group"}</DialogTitle>
        <DialogDescription>You can add people from any department after creating it.</DialogDescription>
      </DialogHeader>
      <Field id="group-name" label="Group name" error={errors.name?.message}>
        {(d) => <Input id="group-name" autoFocus placeholder="Exam Committee" aria-describedby={d} aria-invalid={!!errors.name || undefined} {...form.register("name")} />}
      </Field>
      <Field id="group-description" label="Description" optional error={errors.description?.message}>
        {(d) => <Textarea id="group-description" rows={2} aria-describedby={d} {...form.register("description")} />}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {group ? "Save changes" : "Create group"}
        </Button>
      </DialogFooter>
    </form>
  )
}
