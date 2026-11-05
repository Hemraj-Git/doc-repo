"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleCheck, CircleX, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/field"
import { OptionSelect } from "@/components/option-select"
import { ReviewerList } from "@/components/documents/reviewer-list"
import { PersonCombobox, type PersonItem } from "@/components/person-combobox"
import { createDocument, updateDocument } from "@/app/(app)/documents/actions"
import { checkReferenceId } from "@/app/(app)/repository/actions"
import { documentSchema, type DocumentInput } from "@/lib/validation/documents"
import { REFERENCE_ID_HINT, REFERENCE_ID_PATTERN } from "@/lib/validation/repository"

export type DocumentTypeOption = { id: string; code: string; name: string; isActive: boolean }

export type DocumentDialogMode =
  | { kind: "create"; folder: { id: string; name: string; standalone: boolean } }
  | {
      kind: "edit"
      documentId: string
      standalone: boolean
      locked: boolean // review in progress: uploader & reviewers cannot change
      values: DocumentInput
      originalReferenceId: string | null
    }

type Props = {
  mode: DocumentDialogMode | null
  onClose: () => void
  documentTypes: DocumentTypeOption[]
  people: PersonItem[]
}

export function DocumentDialog({ mode, onClose, documentTypes, people }: Props) {
  return (
    <Dialog open={Boolean(mode)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        {mode && (
          <DocumentForm
            key={mode.kind === "edit" ? mode.documentId : mode.folder.id}
            mode={mode}
            onClose={onClose}
            documentTypes={documentTypes}
            people={people}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

const EMPTY: DocumentInput = {
  name: "",
  documentTypeId: "",
  referenceId: "",
  description: "",
  uploaderId: "",
  requiresReview: false,
  reviewerIds: [],
  dueDate: "",
}

type RefStatus = "idle" | "checking" | "available" | "taken" | "invalid" | "unchanged"

function DocumentForm({ mode, onClose, documentTypes, people }: { mode: DocumentDialogMode } & Omit<Props, "mode">) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const standalone = mode.kind === "create" ? mode.folder.standalone : mode.standalone
  const locked = mode.kind === "edit" && mode.locked

  const form = useForm({
    resolver: zodResolver(documentSchema),
    defaultValues: mode.kind === "edit" ? mode.values : EMPTY,
  })
  const { errors } = form.formState
  const uploaderId = useWatch({ control: form.control, name: "uploaderId" })
  const requiresReview = useWatch({ control: form.control, name: "requiresReview" })
  const reviewerIds = useWatch({ control: form.control, name: "reviewerIds" })
  const referenceId = useWatch({ control: form.control, name: "referenceId" })

  // Live Ref ID check (required for standalone documents, optional inside folders).
  const originalRef = mode.kind === "edit" ? mode.originalReferenceId : null
  const [refStatus, setRefStatus] = useState<RefStatus>("idle")
  useEffect(() => {
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
  }, [referenceId, originalRef])

  const setReviewers = (ids: string[]) => form.setValue("reviewerIds", ids, { shouldValidate: form.formState.isSubmitted })
  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      if (refStatus === "taken") {
        form.setError("referenceId", { message: "This Reference ID is already in use" })
        return
      }
      if (mode.kind === "create") {
        const result = await createDocument(mode.folder.id, values)
        if (!result.ok) return showErrors(result)
        toast.success(`“${values.name}” created — the uploader has been notified`)
        onClose()
        router.push(`/documents/${result.data.id}`)
      } else {
        const result = await updateDocument(mode.documentId, values)
        if (!result.ok) return showErrors(result)
        toast.success("Document updated")
        onClose()
      }
    })
  )

  function showErrors(result: { error: string; fieldErrors?: Record<string, string> }) {
    Object.entries(result.fieldErrors ?? {}).forEach(([field, message]) =>
      form.setError(field as keyof DocumentInput, { message })
    )
    toast.error(result.error)
  }

  const typeOptions = documentTypes
    .filter((t) => t.isActive || t.id === form.getValues("documentTypeId"))
    .map((t) => ({ value: t.id, label: t.name === t.code ? t.code : `${t.code} — ${t.name}` }))

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>
          {mode.kind === "create"
            ? standalone
              ? `New standalone requirement in ${mode.folder.name}`
              : `New requirement in ${mode.folder.name}`
            : "Edit document requirement"}
        </DialogTitle>
        <DialogDescription>
          {mode.kind === "create"
            ? "Define what is needed and who uploads it. The uploader is notified and the document appears in their tasks."
            : "Changes are recorded in the document's history."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Field id="doc-name" label="Document name" error={errors.name?.message}>
          {(d) => (
            <Input id="doc-name" autoFocus aria-describedby={d} aria-invalid={!!errors.name || undefined} {...form.register("name")} />
          )}
        </Field>
        <Field id="doc-type" label="Document type" error={errors.documentTypeId?.message}>
          {(d) => (
            <Controller
              control={form.control}
              name="documentTypeId"
              render={({ field }) => (
                <OptionSelect
                  id="doc-type"
                  options={typeOptions}
                  value={field.value || null}
                  onChange={(v) => field.onChange(v ?? "")}
                  placeholder="Select type"
                  invalid={!!errors.documentTypeId}
                  aria-describedby={d}
                />
              )}
            />
          )}
        </Field>
      </div>

      <Field
        id="doc-ref"
        label="Reference ID"
        optional={!standalone}
        error={errors.referenceId?.message}
        hint={<RefHint status={refStatus} standalone={standalone} />}
      >
        {(d) => (
          <Input
            id="doc-ref"
            className="font-mono"
            autoComplete="off"
            placeholder={standalone ? "e.g. ACD-SYL-2026" : "Leave empty if not needed"}
            aria-describedby={d}
            aria-invalid={!!errors.referenceId || refStatus === "taken" || undefined}
            {...form.register("referenceId")}
          />
        )}
      </Field>

      <Field id="doc-description" label="Instructions / description" optional error={errors.description?.message}>
        {(d) => <Textarea id="doc-description" rows={2} aria-describedby={d} {...form.register("description")} />}
      </Field>

      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Field
          id="doc-uploader"
          label="Who uploads the file"
          error={errors.uploaderId?.message}
          hint={locked ? "Locked while a review is in progress." : "Anyone in the institute, in any department."}
        >
          {(d) => (
            <Controller
              control={form.control}
              name="uploaderId"
              render={({ field }) => (
                <PersonCombobox
                  id="doc-uploader"
                  people={people}
                  value={field.value || null}
                  onChange={(v) => {
                    field.onChange(v ?? "")
                    if (v && reviewerIds.includes(v)) setReviewers(reviewerIds.filter((r) => r !== v))
                  }}
                  disabled={locked}
                  invalid={!!errors.uploaderId}
                  aria-describedby={d}
                />
              )}
            />
          )}
        </Field>
        <Field id="doc-due" label="Due date" optional error={errors.dueDate?.message}>
          {(d) => <Input id="doc-due" type="date" aria-describedby={d} {...form.register("dueDate")} />}
        </Field>
      </div>

      <div className="grid gap-3 rounded-lg border p-3">
        <label className="flex items-start gap-3">
          <Controller
            control={form.control}
            name="requiresReview"
            render={({ field }) => (
              <Checkbox
                className="mt-0.5"
                checked={field.value}
                onCheckedChange={(c) => field.onChange(Boolean(c))}
                disabled={locked}
              />
            )}
          />
          <span className="grid gap-0.5 text-sm">
            <span className="font-medium">Needs review</span>
            <span className="text-xs text-muted-foreground">
              Reviewers approve in the order below. If anyone requests changes, the uploader uploads a new version and the
              review starts again from the first reviewer.
            </span>
          </span>
        </label>

        {requiresReview && (
          <div className="grid gap-2 pl-7">
            <ReviewerList
              id="doc-add-reviewer"
              people={people.filter((p) => p.value !== uploaderId)}
              reviewerIds={reviewerIds}
              onChange={setReviewers}
              locked={locked}
            />
            {errors.reviewerIds && <p className="text-xs text-destructive">{errors.reviewerIds.message}</p>}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || refStatus === "checking"}>
          {pending && <Loader2 className="animate-spin" />}
          {mode.kind === "create" ? "Create requirement" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function RefHint({ status, standalone }: { status: RefStatus; standalone: boolean }) {
  if (status === "checking")
    return (
      <span className="flex items-center gap-1">
        <Loader2 className="size-3 animate-spin" /> Checking…
      </span>
    )
  if (status === "available")
    return (
      <span className="flex items-center gap-1 text-success-text">
        <CircleCheck className="size-3" /> Available
      </span>
    )
  if (status === "taken")
    return (
      <span className="flex items-center gap-1 text-destructive">
        <CircleX className="size-3" /> Already in use somewhere in the institute
      </span>
    )
  if (status === "invalid") return <span className="text-destructive">{REFERENCE_ID_HINT}</span>
  if (status === "unchanged") return <span>Current Reference ID.</span>
  return <span>{standalone ? "Standalone documents need their own Reference ID." : "Optional."} {REFERENCE_ID_HINT}</span>
}
