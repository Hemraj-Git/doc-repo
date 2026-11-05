"use client"

import { useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, MoreHorizontal, Pencil, Plus, Power, PowerOff } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/field"
import { StatusBadge } from "@/components/status-badge"
import type { DocumentTypeRow } from "@/lib/data/repository"
import { documentTypeSchema } from "@/lib/validation/repository"
import { createDocumentType, setDocumentTypeActive, updateDocumentType } from "./actions"

export function DocumentTypesTable({ types }: { types: DocumentTypeRow[] }) {
  // undefined = closed, null = new, row = editing
  const [editing, setEditing] = useState<DocumentTypeRow | null | undefined>(undefined)
  const [, startTransition] = useTransition()

  const toggle = (t: DocumentTypeRow) =>
    startTransition(async () => {
      const result = await setDocumentTypeActive(t.id, !t.isActive)
      if (!result.ok) toast.error(result.error)
      else toast.success(t.isActive ? `${t.code} deactivated` : `${t.code} reactivated`)
    })

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing(null)}>
          <Plus /> New document type
        </Button>
      </div>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((t) => (
              <TableRow key={t.id} className={t.isActive ? undefined : "text-muted-foreground"}>
                <TableCell className="font-mono text-xs font-medium">{t.code}</TableCell>
                <TableCell>{t.name}</TableCell>
                <TableCell className="max-w-md truncate text-muted-foreground">{t.description ?? "—"}</TableCell>
                <TableCell>
                  <StatusBadge active={t.isActive} />
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.code}`} />}>
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditing(t)}>
                        <Pencil /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant={t.isActive ? "destructive" : "default"} onClick={() => toggle(t)}>
                        {t.isActive ? <PowerOff /> : <Power />} {t.isActive ? "Deactivate" : "Reactivate"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Deactivated types can no longer be chosen for new documents; existing documents keep their type.
      </p>

      <Dialog open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)}>
        <DialogContent className="sm:max-w-md">
          {editing !== undefined && (
            <DocumentTypeForm key={editing?.id ?? "new"} type={editing} onClose={() => setEditing(undefined)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function DocumentTypeForm({ type, onClose }: { type: DocumentTypeRow | null; onClose: () => void }) {
  const [pending, startTransition] = useTransition()
  const form = useForm({
    resolver: zodResolver(documentTypeSchema),
    defaultValues: { code: type?.code ?? "", name: type?.name ?? "", description: type?.description ?? "" },
  })
  const { errors } = form.formState

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = type ? await updateDocumentType(type.id, values) : await createDocumentType(values)
      if (!result.ok) {
        Object.entries(result.fieldErrors ?? {}).forEach(([field, message]) =>
          form.setError(field as keyof typeof values, { message })
        )
        toast.error(result.error)
        return
      }
      toast.success(type ? `${values.code} updated` : `${values.code} added`)
      onClose()
    })
  )

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{type ? `Edit ${type.code}` : "New document type"}</DialogTitle>
        <DialogDescription>Document types classify documents. Any file format can be uploaded for any type.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <Field id="type-code" label="Code" error={errors.code?.message}>
          {(d) => (
            <Input
              id="type-code"
              placeholder="SOP"
              className="font-mono uppercase"
              aria-describedby={d}
              aria-invalid={!!errors.code || undefined}
              {...form.register("code")}
            />
          )}
        </Field>
        <Field id="type-name" label="Name" error={errors.name?.message}>
          {(d) => (
            <Input
              id="type-name"
              placeholder="Standard Operating Procedure"
              aria-describedby={d}
              aria-invalid={!!errors.name || undefined}
              {...form.register("name")}
            />
          )}
        </Field>
      </div>
      <Field id="type-description" label="Description" optional error={errors.description?.message}>
        {(d) => <Textarea id="type-description" rows={2} aria-describedby={d} {...form.register("description")} />}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {type ? "Save changes" : "Add type"}
        </Button>
      </DialogFooter>
    </form>
  )
}
