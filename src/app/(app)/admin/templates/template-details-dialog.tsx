"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/field"
import { templateDetailsSchema, type TemplateDetailsInput } from "@/lib/validation/templates"
import { createTemplate, updateTemplate } from "./actions"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Omit to create a new template. */
  template?: { id: string } & TemplateDetailsInput
  departments: { id: string; name: string }[]
}

export function TemplateDetailsDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {props.open && <DetailsForm key={props.template?.id ?? "new"} {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function DetailsForm({ onOpenChange, template, departments }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const form = useForm({
    resolver: zodResolver(templateDetailsSchema),
    defaultValues: template ?? {
      name: "",
      description: "",
      instanceLabel: "Name",
      departmentIds: [],
      allowExtraFolders: true,
      isActive: true,
    },
  })
  const { errors } = form.formState

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      if (template) {
        const result = await updateTemplate(template.id, values)
        if (!result.ok) return showErrors(result)
        toast.success("Template updated")
        onOpenChange(false)
        return
      }
      const result = await createTemplate(values)
      if (!result.ok) return showErrors(result)
      toast.success(`Template “${values.name}” created — now add its folders and documents`)
      onOpenChange(false)
      router.push(`/admin/templates/${result.data.id}`)
    })
  )

  function showErrors(result: { error: string; fieldErrors?: Record<string, string> }) {
    Object.entries(result.fieldErrors ?? {}).forEach(([field, message]) =>
      form.setError(field as keyof TemplateDetailsInput, { message })
    )
    toast.error(result.error)
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{template ? "Template details" : "New template"}</DialogTitle>
        <DialogDescription>
          A template describes the folders and files every instance gets — e.g. one per program, subject, employee or
          audit.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
        <Field id="tpl-name" label="Template name" error={errors.name?.message}>
          {(d) => (
            <Input id="tpl-name" autoFocus placeholder="e.g. Academic Program" aria-describedby={d} aria-invalid={!!errors.name || undefined} {...form.register("name")} />
          )}
        </Field>
        <Field id="tpl-label" label="Instance name label" error={errors.instanceLabel?.message} hint="Asked when creating one">
          {(d) => <Input id="tpl-label" placeholder="Program name" aria-describedby={d} {...form.register("instanceLabel")} />}
        </Field>
      </div>

      <Field id="tpl-description" label="Description" optional error={errors.description?.message}>
        {(d) => <Textarea id="tpl-description" rows={2} aria-describedby={d} {...form.register("description")} />}
      </Field>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Available to</legend>
        <Controller
          control={form.control}
          name="departmentIds"
          render={({ field }) => {
            const selected = new Set(field.value)
            const toggle = (id: string, on: boolean) => {
              const next = new Set(selected)
              if (on) next.add(id)
              else next.delete(id)
              field.onChange([...next])
            }
            return (
              <div className="grid gap-1.5">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={selected.size === 0} onCheckedChange={(c) => c && field.onChange([])} />
                  Every department
                </label>
                <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border p-2">
                  {departments.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={selected.has(d.id)} onCheckedChange={(c) => toggle(d.id, Boolean(c))} />
                      <span className="truncate">{d.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )
          }}
        />
      </fieldset>

      <div className="grid gap-2">
        <label className="flex items-start gap-2 text-sm">
          <Controller
            control={form.control}
            name="allowExtraFolders"
            render={({ field }) => <Checkbox className="mt-0.5" checked={field.value} onCheckedChange={(c) => field.onChange(Boolean(c))} />}
          />
          <span>
            Allow people to add their own folders inside an instance
            <span className="block text-xs text-muted-foreground">Template folders are always created; this permits extra ones.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => <Checkbox className="mt-0.5" checked={field.value} onCheckedChange={(c) => field.onChange(Boolean(c))} />}
          />
          <span>
            Active
            <span className="block text-xs text-muted-foreground">Inactive templates cannot be used for new instances.</span>
          </span>
        </label>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {template ? "Save" : "Create template"}
        </Button>
      </DialogFooter>
    </form>
  )
}
