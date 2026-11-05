"use client"

import { useEffect, useState, useTransition } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleCheck, CircleX, FolderTree, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/field"
import type { FolderRow } from "@/lib/data/repository"
import { folderSchema, MAX_FOLDER_DEPTH, REFERENCE_ID_HINT, REFERENCE_ID_PATTERN, refIdRule } from "@/lib/validation/repository"
import { checkReferenceId, createFolder, updateFolder } from "./actions"

export type FolderParent = { id: string; level: "root" | "child" | "sub"; depth: number; name: string; referenceId: string | null }

export type FolderDialogMode =
  | { kind: "create"; parent: FolderParent }
  | { kind: "edit"; folder: FolderRow; parentReferenceId: string | null }

type Props = { mode: FolderDialogMode | null; onClose: () => void }

export function FolderDialog({ mode, onClose }: Props) {
  return (
    <Dialog open={Boolean(mode)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {mode && (
          <FolderForm key={mode.kind === "edit" ? mode.folder.id : `new-${mode.parent.id}`} mode={mode} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}

type RefStatus = "idle" | "checking" | "available" | "taken" | "invalid" | "unchanged"

function FolderForm({ mode, onClose }: { mode: FolderDialogMode; onClose: () => void }) {
  const [pending, startTransition] = useTransition()
  const depth = mode.kind === "create" ? mode.parent.depth + 1 : mode.folder.depth
  const rule = refIdRule(depth)
  const parentRef = mode.kind === "create" ? mode.parent.referenceId : mode.parentReferenceId
  const originalRef = mode.kind === "edit" ? mode.folder.referenceId : null
  const canNest = depth < MAX_FOLDER_DEPTH

  const form = useForm({
    resolver: zodResolver(folderSchema),
    defaultValues:
      mode.kind === "edit"
        ? {
            name: mode.folder.name,
            referenceId: mode.folder.referenceId ?? "",
            description: mode.folder.description ?? "",
            allowSubfolders: mode.folder.allowSubfolders,
          }
        : { name: "", referenceId: "", description: "", allowSubfolders: false },
  })
  const { errors } = form.formState
  const name = useWatch({ control: form.control, name: "name" })
  const referenceId = useWatch({ control: form.control, name: "referenceId" })

  // Debounced, server-side uniqueness check across the whole institute.
  const [refStatus, setRefStatus] = useState<RefStatus>("idle")
  useEffect(() => {
    if (rule === "auto") return
    const ref = referenceId.trim()
    let cancelled = false
    const timer = setTimeout(async () => {
      if (!ref) return setRefStatus("idle")
      if (originalRef && ref.toLowerCase() === originalRef.toLowerCase()) return setRefStatus("unchanged")
      if (!REFERENCE_ID_PATTERN.test(ref)) return setRefStatus("invalid")
      setRefStatus("checking")
      const result = await checkReferenceId(ref)
      if (!cancelled) setRefStatus(result.available ? "available" : result.error ? "invalid" : "taken")
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [referenceId, rule, originalRef])

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      if (rule !== "auto" && refStatus === "taken") {
        form.setError("referenceId", { message: "This Reference ID is already in use" })
        return
      }
      const result =
        mode.kind === "create" ? await createFolder(mode.parent.id, values) : await updateFolder(mode.folder.id, values)
      if (!result.ok) {
        Object.entries(result.fieldErrors ?? {}).forEach(([field, message]) =>
          form.setError(field as keyof typeof values, { message })
        )
        toast.error(result.error)
        return
      }
      toast.success(mode.kind === "create" ? `Folder “${values.name}” created` : "Folder updated")
      onClose()
    })
  )

  const kindLabel = depth === 1 ? "folder" : "sub-folder"
  const title = mode.kind === "create" ? `New ${kindLabel} in ${mode.parent.name}` : `Edit ${mode.folder.name}`

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {rule === "required"
            ? "Folders directly in a department need a Reference ID that is unique across the institute."
            : rule === "auto"
              ? "This folder's Reference ID is generated from its parent folder."
              : "A Reference ID is optional at this level. If you add one, it must be unique across the institute."}
        </DialogDescription>
      </DialogHeader>

      <Field id="folder-name" label="Folder name" error={errors.name?.message}>
        {(d) => (
          <Input
            id="folder-name"
            placeholder={depth === 1 ? "e.g. Academic Programme Guide" : depth === 2 ? "e.g. Diploma In Nautical Science" : "e.g. Course"}
            autoFocus
            aria-describedby={d}
            aria-invalid={!!errors.name || undefined}
            {...form.register("name")}
          />
        )}
      </Field>

      {rule === "auto" ? (
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Reference ID</span>
          <div className="rounded-lg border bg-muted/40 px-2.5 py-1.5 font-mono text-sm">
            {parentRef} ({name.trim() || "…"})
          </div>
        </div>
      ) : (
        <Field
          id="folder-ref"
          label="Reference ID"
          optional={rule === "optional"}
          error={errors.referenceId?.message}
          hint={<RefStatusHint status={refStatus} optional={rule === "optional"} />}
        >
          {(d) => (
            <Input
              id="folder-ref"
              placeholder={rule === "required" ? "e.g. SOMSQP-ADC-1-FL4" : "Leave empty if not needed"}
              className="font-mono"
              autoComplete="off"
              aria-describedby={d}
              aria-invalid={!!errors.referenceId || refStatus === "taken" || undefined}
              {...form.register("referenceId")}
            />
          )}
        </Field>
      )}

      <Field id="folder-description" label="Description" optional error={errors.description?.message}>
        {(d) => <Textarea id="folder-description" rows={2} aria-describedby={d} {...form.register("description")} />}
      </Field>

      {canNest && (
        <label className="flex items-start gap-3 rounded-lg border p-3 has-data-checked:border-primary/40 has-data-checked:bg-primary/5">
          <Controller
            control={form.control}
            name="allowSubfolders"
            render={({ field }) => (
              <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(Boolean(c))} className="mt-0.5" />
            )}
          />
          <span className="grid gap-0.5 text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <FolderTree className="size-3.5" /> Allow sub-folders
            </span>
            <span className="text-xs text-muted-foreground">
              For folders organised per programme, course, subject, student or employee. Files can still be added
              directly to this folder.
            </span>
          </span>
        </label>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || refStatus === "checking"}>
          {pending && <Loader2 className="animate-spin" />}
          {mode.kind === "create" ? `Create ${kindLabel}` : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function RefStatusHint({ status, optional }: { status: RefStatus; optional: boolean }) {
  switch (status) {
    case "checking":
      return (
        <span className="flex items-center gap-1">
          <Loader2 className="size-3 animate-spin" /> Checking…
        </span>
      )
    case "available":
      return (
        <span className="flex items-center gap-1 text-success-text">
          <CircleCheck className="size-3" /> Available
        </span>
      )
    case "taken":
      return (
        <span className="flex items-center gap-1 text-destructive">
          <CircleX className="size-3" /> Already in use somewhere in the institute
        </span>
      )
    case "invalid":
      return <span className="text-destructive">{REFERENCE_ID_HINT}</span>
    case "unchanged":
      return <span>Current Reference ID.</span>
    default:
      return <span>{optional ? "Optional. " : ""}{REFERENCE_ID_HINT}</span>
  }
}
