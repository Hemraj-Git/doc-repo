"use client"

import { useEffect, useTransition } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/field"
import { OptionSelect } from "@/components/option-select"
import type { DepartmentRow, PersonOption } from "@/lib/data/org"
import { departmentSchema } from "@/lib/validation/org"
import { createDepartment, updateDepartment } from "./actions"

const NO_HEAD = "__none__"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Omit to create a new department. */
  department?: DepartmentRow
  members: PersonOption[]
}

export function DepartmentDialog({ open, onOpenChange, department, members }: Props) {
  const editing = Boolean(department)
  const [pending, startTransition] = useTransition()

  const form = useForm({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: "", code: "", description: "", headUserId: null as string | null },
  })
  const { errors } = form.formState

  useEffect(() => {
    if (!open) return
    form.reset({
      name: department?.name ?? "",
      code: department?.code ?? "",
      description: department?.description ?? "",
      headUserId: department?.head?.id ?? null,
    })
  }, [open, department, form])

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = department ? await updateDepartment(department.id, values) : await createDepartment(values)
      if (!result.ok) {
        Object.entries(result.fieldErrors ?? {}).forEach(([field, message]) =>
          form.setError(field as keyof typeof values, { message })
        )
        toast.error(result.error)
        return
      }
      toast.success(editing ? "Department updated" : `Department “${values.name}” created`)
      onOpenChange(false)
    })
  )

  const headOptions = [
    { value: NO_HEAD, label: "— No head assigned —" },
    ...members.map((m) => ({ value: m.id, label: m.designation ? `${m.fullName} · ${m.designation}` : m.fullName })),
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${department!.name}` : "New department"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Changes are recorded in the audit log."
                : "A root folder for the department is created in the repository automatically."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <Field id="dept-name" label="Name" error={errors.name?.message}>
              {(describedBy) => (
                <Input
                  id="dept-name"
                  placeholder="e.g. Nautical Studies"
                  aria-invalid={Boolean(errors.name) || undefined}
                  aria-describedby={describedBy}
                  {...form.register("name")}
                />
              )}
            </Field>
            <Field id="dept-code" label="Code" error={errors.code?.message}>
              {(describedBy) => (
                <Input
                  id="dept-code"
                  placeholder="NAUT"
                  className="uppercase"
                  aria-invalid={Boolean(errors.code) || undefined}
                  aria-describedby={describedBy}
                  {...form.register("code")}
                />
              )}
            </Field>
          </div>

          <Field id="dept-description" label="Description" optional error={errors.description?.message}>
            {(describedBy) => (
              <Textarea
                id="dept-description"
                rows={2}
                aria-describedby={describedBy}
                {...form.register("description")}
              />
            )}
          </Field>

          {editing && (
            <Field
              id="dept-head"
              label="Department head"
              error={errors.headUserId?.message}
              hint={
                members.length === 0
                  ? "Add users to this department first, then choose its head."
                  : "The head owns the department's documents and gets the Department Head role automatically."
              }
            >
              {(describedBy) => (
                <Controller
                  control={form.control}
                  name="headUserId"
                  render={({ field }) => (
                    <OptionSelect
                      id="dept-head"
                      options={headOptions}
                      value={field.value ?? NO_HEAD}
                      onChange={(v) => field.onChange(v === NO_HEAD ? null : v)}
                      disabled={members.length === 0}
                      aria-describedby={describedBy}
                    />
                  )}
                />
              )}
            </Field>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {editing ? "Save changes" : "Create department"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
