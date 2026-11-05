"use client"

import { useTransition } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowDown, ArrowUp, Loader2, Plus, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/field"
import { OptionSelect, type Option } from "@/components/option-select"
import { PersonCombobox, type PersonItem } from "@/components/person-combobox"
import {
  DUE_LABELS,
  exampleName,
  RECURRENCE_LABELS,
  REVIEWER_LABELS,
  STORAGE_LABELS,
  UPLOADER_LABELS,
  type ReviewerRule,
  type TemplateNode,
} from "@/lib/templates"
import { nodeSchema, type NodeInput } from "@/lib/validation/templates"
import { updateNode } from "./actions"

type Props = {
  templateId: string
  node: TemplateNode | null
  /** Whether this template is used as a slot somewhere (enables slot-owner rules). */
  usedAsSlot: boolean
  documentTypes: Option[]
  otherTemplates: Option[]
  people: PersonItem[]
  onClose: () => void
}

const options = <K extends string>(labels: Record<K, string>, keys?: K[]): Option[] =>
  (keys ?? (Object.keys(labels) as K[])).map((k) => ({ value: k, label: labels[k] }))

export function NodeEditor(props: Props) {
  return (
    <Sheet open={Boolean(props.node)} onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl">
        {props.node && <NodeForm key={props.node.id} {...props} node={props.node} />}
      </SheetContent>
    </Sheet>
  )
}

function toInput(n: TemplateNode): NodeInput {
  return {
    name: n.name,
    allowSubfolders: n.allowSubfolders,
    documentTypeId: n.documentTypeId ?? "",
    description: n.description ?? "",
    recurrence: n.recurrence,
    storage: n.storage,
    createOffsetDays: n.createOffsetDays,
    dueMode: n.dueMode,
    dueDays: n.dueDays,
    uploaderRule: n.uploaderRule,
    fixedUploaderId: n.fixedUploaderId,
    requiresReview: n.requiresReview,
    reviewers: n.reviewers.map((r) => ({ rule: r.rule, userId: r.userId })),
    slotTemplateId: n.slotTemplateId,
    slotOwnerLabel: n.slotOwnerLabel ?? "",
    slotEntryDates: n.slotEntryDates,
  }
}

function NodeForm({ templateId, node, usedAsSlot, documentTypes, otherTemplates, people, onClose }: Props & { node: TemplateNode }) {
  const [pending, startTransition] = useTransition()
  const form = useForm({ resolver: zodResolver(nodeSchema), defaultValues: toInput(node) })
  const { errors } = form.formState
  const w = useWatch({ control: form.control })
  const recurring = w.recurrence !== "once"
  const reviewers = w.reviewers ?? []

  const uploaderRules = options(UPLOADER_LABELS).filter((o) => usedAsSlot || o.value !== "slot_owner")
  const reviewerRules = options(REVIEWER_LABELS).filter((o) => usedAsSlot || o.value !== "slot_owner_manager")
  const dueModes = options(DUE_LABELS).filter((o) => recurring || o.value !== "period_end")

  const setReviewers = (next: NodeInput["reviewers"]) =>
    form.setValue("reviewers", next, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await updateNode(templateId, node.id, values)
      if (!result.ok) {
        Object.entries(result.fieldErrors ?? {}).forEach(([field, message]) => form.setError(field as keyof NodeInput, { message }))
        toast.error(result.error)
        return
      }
      toast.success("Saved")
      onClose()
    })
  )

  const kindTitle = node.kind === "folder" ? "Folder" : node.kind === "slot" ? "Slot" : "Document item"

  return (
    <form onSubmit={submit} className="flex min-h-full flex-col" noValidate>
      <SheetHeader>
        <SheetTitle>{kindTitle}</SheetTitle>
        <SheetDescription>
          {node.kind === "folder"
            ? "A fixed sub-folder created in every instance."
            : node.kind === "slot"
              ? "Repeats another template once per entry given when an instance is created — e.g. one folder per subject."
              : "A file requirement created in every instance. Recurring items get a new requirement every period."}
        </SheetDescription>
      </SheetHeader>

      <div className="grid gap-4 px-4 pb-4">
        <Field id="node-name" label={node.kind === "slot" ? "Slot label" : "Name"} error={errors.name?.message}>
          {(d) => (
            <Input
              id="node-name"
              placeholder={node.kind === "slot" ? "e.g. Subjects" : node.kind === "folder" ? "e.g. Course" : "e.g. Lesson Plan"}
              aria-describedby={d}
              aria-invalid={!!errors.name || undefined}
              {...form.register("name")}
            />
          )}
        </Field>

        {node.kind === "folder" && (
          <label className="flex items-start gap-2 text-sm">
            <Controller
              control={form.control}
              name="allowSubfolders"
              render={({ field }) => <Checkbox className="mt-0.5" checked={field.value} onCheckedChange={(c) => field.onChange(Boolean(c))} />}
            />
            <span>
              Allow people to add their own sub-folders here
              <span className="block text-xs text-muted-foreground">Template items inside are created either way.</span>
            </span>
          </label>
        )}

        {node.kind === "slot" && (
          <>
            <Field id="node-slot" label="Template to repeat" error={errors.slotTemplateId?.message}>
              {(d) => (
                <Controller
                  control={form.control}
                  name="slotTemplateId"
                  render={({ field }) => (
                    <OptionSelect id="node-slot" options={otherTemplates} value={field.value} onChange={field.onChange} aria-describedby={d} />
                  )}
                />
              )}
            </Field>
            <Field
              id="node-owner"
              label="Owner of each entry"
              optional
              error={errors.slotOwnerLabel?.message}
              hint="e.g. Subject teacher — chosen per entry; items can use them as uploader."
            >
              {(d) => <Input id="node-owner" placeholder="Subject teacher" aria-describedby={d} {...form.register("slotOwnerLabel")} />}
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <Controller
                control={form.control}
                name="slotEntryDates"
                render={({ field }) => <Checkbox className="mt-0.5" checked={field.value} onCheckedChange={(c) => field.onChange(Boolean(c))} />}
              />
              <span>
                Each entry has its own start and end date
                <span className="block text-xs text-muted-foreground">
                  e.g. semesters. Recurring files inside it (including its subjects) run only between these dates. Required for entries at
                  the first level. Entries inside another entry, such as courses in a semester, can leave them blank to use that entry&apos;s dates.
                </span>
              </span>
            </label>
          </>
        )}

        {node.kind === "document" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="node-type" label="Document type" error={errors.documentTypeId?.message}>
                {(d) => (
                  <Controller
                    control={form.control}
                    name="documentTypeId"
                    render={({ field }) => (
                      <OptionSelect id="node-type" options={documentTypes} value={field.value || null} onChange={(v) => field.onChange(v ?? "")} aria-describedby={d} />
                    )}
                  />
                )}
              </Field>
              <Field id="node-recurrence" label="Repeats">
                {(d) => (
                  <Controller
                    control={form.control}
                    name="recurrence"
                    render={({ field }) => (
                      <OptionSelect
                        id="node-recurrence"
                        options={options(RECURRENCE_LABELS)}
                        value={field.value}
                        onChange={(v) => {
                          field.onChange(v)
                          if (v === "once") {
                            form.setValue("storage", "here")
                            if (form.getValues("dueMode") === "period_end") form.setValue("dueMode", "after_creation")
                          } else if (form.getValues("dueMode") === "none") {
                            form.setValue("dueMode", "period_end")
                            form.setValue("dueDays", 3)
                          }
                        }}
                        aria-describedby={d}
                      />
                    )}
                  />
                )}
              </Field>
            </div>

            <p className="-mt-2 text-xs text-muted-foreground">
              Created as: <span className="font-medium text-foreground">{exampleName(w.name || "Name", w.recurrence ?? "once")}</span>
            </p>

            <Field id="node-description" label="Instructions" optional error={errors.description?.message}>
              {(d) => <Textarea id="node-description" rows={2} aria-describedby={d} {...form.register("description")} />}
            </Field>

            {recurring && (
              <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                <Field id="node-storage" label="File each period in">
                  {(d) => (
                    <Controller
                      control={form.control}
                      name="storage"
                      render={({ field }) => (
                        <OptionSelect id="node-storage" options={options(STORAGE_LABELS)} value={field.value} onChange={field.onChange} aria-describedby={d} />
                      )}
                    />
                  )}
                </Field>
                <Field id="node-offset" label="Create early" hint="days before the period" error={errors.createOffsetDays?.message}>
                  {(d) => (
                    <Input id="node-offset" type="number" min={0} max={60} aria-describedby={d} {...form.register("createOffsetDays", { valueAsNumber: true })} />
                  )}
                </Field>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
              <Field id="node-due" label="Due date">
                {(d) => (
                  <Controller
                    control={form.control}
                    name="dueMode"
                    render={({ field }) => (
                      <OptionSelect id="node-due" options={dueModes} value={field.value} onChange={field.onChange} aria-describedby={d} />
                    )}
                  />
                )}
              </Field>
              {w.dueMode !== "none" && (
                <Field id="node-due-days" label="Days" error={errors.dueDays?.message}>
                  {(d) => <Input id="node-due-days" type="number" min={0} max={365} aria-describedby={d} {...form.register("dueDays", { valueAsNumber: true })} />}
                </Field>
              )}
            </div>

            <Field id="node-uploader" label="Who uploads" error={errors.fixedUploaderId?.message}>
              {(d) => (
                <div className="grid gap-2">
                  <Controller
                    control={form.control}
                    name="uploaderRule"
                    render={({ field }) => (
                      <OptionSelect id="node-uploader" options={uploaderRules} value={field.value} onChange={field.onChange} aria-describedby={d} />
                    )}
                  />
                  {w.uploaderRule === "fixed" && (
                    <Controller
                      control={form.control}
                      name="fixedUploaderId"
                      render={({ field }) => <PersonCombobox people={people} value={field.value} onChange={field.onChange} invalid={!!errors.fixedUploaderId} />}
                    />
                  )}
                </div>
              )}
            </Field>

            <div className="grid gap-3 rounded-lg border p-3">
              <label className="flex items-start gap-2 text-sm">
                <Controller
                  control={form.control}
                  name="requiresReview"
                  render={({ field }) => (
                    <Checkbox
                      className="mt-0.5"
                      checked={field.value}
                      onCheckedChange={(c) => {
                        field.onChange(Boolean(c))
                        if (c && reviewers.length === 0) setReviewers([{ rule: "department_head", userId: null }])
                      }}
                    />
                  )}
                />
                <span>
                  <span className="font-medium">Needs review</span>
                  <span className="block text-xs text-muted-foreground">
                    Reviewers decide in this order. Rules are resolved when each requirement is created, so staff changes
                    are picked up automatically.
                  </span>
                </span>
              </label>

              {w.requiresReview && (
                <div className="grid gap-2 pl-6">
                  {reviewers.map((r, i) => (
                    <div key={i} className="grid gap-1.5 rounded-md border bg-muted/30 p-2">
                      <div className="flex items-center gap-2">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <OptionSelect
                            options={reviewerRules}
                            value={r.rule ?? "department_head"}
                            onChange={(v) => {
                              const next = [...reviewers]
                              next[i] = { rule: (v ?? "department_head") as ReviewerRule, userId: null }
                              setReviewers(next as NodeInput["reviewers"])
                            }}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={i === 0}
                          aria-label="Move up"
                          onClick={() => {
                            const next = [...reviewers]
                            ;[next[i - 1], next[i]] = [next[i]!, next[i - 1]!]
                            setReviewers(next as NodeInput["reviewers"])
                          }}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={i === reviewers.length - 1}
                          aria-label="Move down"
                          onClick={() => {
                            const next = [...reviewers]
                            ;[next[i + 1], next[i]] = [next[i]!, next[i + 1]!]
                            setReviewers(next as NodeInput["reviewers"])
                          }}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Remove reviewer"
                          onClick={() => setReviewers(reviewers.filter((_, j) => j !== i) as NodeInput["reviewers"])}
                        >
                          <X />
                        </Button>
                      </div>
                      {r.rule === "fixed" && (
                        <PersonCombobox
                          people={people}
                          value={r.userId ?? null}
                          onChange={(v) => {
                            const next = [...reviewers]
                            next[i] = { rule: "fixed", userId: v }
                            setReviewers(next as NodeInput["reviewers"])
                          }}
                          invalid={Boolean(errors.reviewers?.[i]?.userId)}
                        />
                      )}
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="justify-self-start"
                    onClick={() => setReviewers([...reviewers, { rule: "fixed", userId: null }] as NodeInput["reviewers"])}
                  >
                    <Plus /> Add reviewer
                  </Button>
                  {errors.reviewers?.message && <p className="text-xs text-destructive">{errors.reviewers.message}</p>}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <SheetFooter className="mt-auto border-t">
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      </SheetFooter>
    </form>
  )
}
